import { Injectable } from '@nestjs/common';
import { formatDateOnly, parseDateOnly } from '../../../common/helpers/date.js';
import { formatAmount } from '../../../common/helpers/money.js';
import { Db } from '../../../core/database/db.service.js';
import { AppException } from '../../../core/errors/app.exception.js';
import { ErrorCode } from '../../../core/errors/error-codes.js';
import type { JournalSource } from '../../../generated/prisma/client.js';
import { AuditService } from '../../audit/audit.service.js';
import { AccountingContext } from '../accounting-context.service.js';
import { SystemAccount } from '../chart-of-accounts/system-accounts.js';
import type { UpdateBooksSettingsDto } from '../dto/books.dto.js';
import { AccountsRepository } from '../repositories/accounts.repository.js';
import { BooksRepository, type BooksSettings } from '../repositories/books.repository.js';
import { FiscalRepository } from '../repositories/fiscal.repository.js';
import { JournalsRepository } from '../repositories/journals.repository.js';
import { LedgerRepository } from '../repositories/ledger.repository.js';

const toDate = (value: string | null | undefined): Date | null | undefined =>
  value === undefined ? undefined : value === null ? null : parseDateOnly(value);

const dateOrNull = (value: Date | null) => (value ? formatDateOnly(value) : null);

/**
 * Book-keeping controls an auditor relies on:
 *  - lock date / tax lock date: nothing is posted on or before them (a filed
 *    VAT return or audited month can no longer change);
 *  - opening balance date (cut-over): opening balances are dated on it,
 *    always reported as opening figures, and nothing is posted before it.
 * Enforced here with clear messages and again by the ledger trigger.
 */
@Injectable()
export class BooksService {
  constructor(
    private readonly db: Db,
    private readonly books: BooksRepository,
    private readonly accounting: AccountingContext,
    private readonly accounts: AccountsRepository,
    private readonly journals: JournalsRepository,
    private readonly fiscal: FiscalRepository,
    private readonly ledger: LedgerRepository,
    private readonly audit: AuditService,
  ) {}

  settings(): Promise<BooksSettings> {
    return this.books.get();
  }

  /** Settings plus the health checks the books page shows. */
  async overview() {
    const [settings, { baseCurrency }, obe] = await Promise.all([
      this.books.get(),
      this.accounting.profile(),
      this.accounts.findBySystemKey(SystemAccount.OPENING_BALANCE_EQUITY),
    ]);
    const obeBalance = obe ? await this.ledger.balance(obe.id) : null;
    return {
      lockDate: dateOrNull(settings.lockDate),
      taxLockDate: dateOrNull(settings.taxLockDate),
      openingBalanceDate: dateOrNull(settings.openingBalanceDate),
      currency: baseCurrency,
      /**
       * Opening-balance equity should be zero once the migration is finished
       * (every plug reclassified to capital / retained earnings).
       */
      openingBalanceEquity: obe && obeBalance
        ? { accountId: obe.id, code: obe.code, balance: formatAmount(obeBalance.negated(), baseCurrency), cleared: obeBalance.isZero() }
        : null,
    };
  }

  async update(dto: UpdateBooksSettingsDto) {
    await this.db.transaction(async () => {
      const current = await this.books.get();
      const today = await this.accounting.today();
      const next = {
        lockDate: toDate(dto.lockDate),
        taxLockDate: toDate(dto.taxLockDate),
        openingBalanceDate: toDate(dto.openingBalanceDate),
      };
      const errors: Array<{ field: string; errors: string[] }> = [];

      // Lock dates close the past only, and loosening one needs a recorded reason.
      let loosened = false;
      for (const key of ['lockDate', 'taxLockDate'] as const) {
        const value = next[key];
        if (value === undefined) continue;
        if (value && value > today) errors.push({ field: key, errors: ['a lock date cannot be in the future'] });
        const before = current[key];
        if (before && (!value || value < before)) loosened = true;
      }
      if (loosened && !dto.reason?.trim()) {
        errors.push({ field: 'reason', errors: ['give a reason for moving a lock date back or removing it'] });
      }

      const opening = next.openingBalanceDate;
      if (opening !== undefined && opening?.getTime() !== current.openingBalanceDate?.getTime()) {
        if (await this.journals.countActiveOpeningBalances()) {
          errors.push({ field: 'openingBalanceDate', errors: ['opening balances are already posted; reverse them before moving the date'] });
        } else if (opening) {
          if (!(await this.fiscal.findPeriodForDate(opening))) {
            errors.push({ field: 'openingBalanceDate', errors: ['no fiscal year covers this date'] });
          }
          if (await this.journals.countPostedBefore(opening)) {
            errors.push({ field: 'openingBalanceDate', errors: ['entries are already posted before this date'] });
          }
        }
      }
      if (errors.length > 0) throw new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', errors);

      const changes = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as Partial<BooksSettings>;
      if (Object.keys(changes).length === 0) return;
      await this.books.update(changes);
      await this.audit.record({
        action: 'books.settings_updated',
        entityType: 'tenant',
        entityId: (await this.accounting.profile()).tenantId,
        metadata: {
          before: { lockDate: dateOrNull(current.lockDate), taxLockDate: dateOrNull(current.taxLockDate), openingBalanceDate: dateOrNull(current.openingBalanceDate) },
          after: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, dateOrNull(v ?? null)])),
          reason: dto.reason?.trim() || undefined,
        },
      });
    });
    return this.overview();
  }

  /**
   * Whether an entry of `source` may be posted on `date`. Year-end closing
   * entries are exempt from the lock dates: they are generated by the close
   * itself, which has its own controls.
   */
  async assertPostingAllowed(date: Date, source: JournalSource): Promise<void> {
    const settings = await this.books.get();
    const lockedThrough = [settings.lockDate, settings.taxLockDate].filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime())[0];
    if (source !== 'CLOSING' && lockedThrough && date <= lockedThrough) {
      throw new AppException(ErrorCode.BOOKS_LOCKED, `The books are locked through ${formatDateOnly(lockedThrough)}`, {
        lockedThrough: formatDateOnly(lockedThrough),
      });
    }
    const opening = settings.openingBalanceDate;
    if (source === 'OPENING_BALANCE') {
      if (!opening) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', [
          { field: 'date', errors: ['set the opening balance date in the books settings first'] },
        ]);
      }
      if (date.getTime() !== opening.getTime()) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', [
          { field: 'date', errors: [`opening balances are dated on the opening balance date ${formatDateOnly(opening)}`] },
        ]);
      }
    } else if (opening && date < opening) {
      throw new AppException(ErrorCode.BOOKS_LOCKED, `Nothing can be posted before the opening balance date ${formatDateOnly(opening)}`, {
        openingBalanceDate: formatDateOnly(opening),
      });
    }
  }
}
