import { Injectable } from '@nestjs/common';
import { Decimal, roundMoney } from '../../../common/helpers/money.js';
import { RequestContext } from '../../../core/context/request-context.service.js';
import { Db } from '../../../core/database/db.service.js';
import { AppException } from '../../../core/errors/app.exception.js';
import { ErrorCode } from '../../../core/errors/error-codes.js';
import { AuditService } from '../../audit/audit.service.js';
import { AccountingContext } from '../accounting-context.service.js';
import { FiscalCalendarService } from '../fiscal/fiscal-calendar.service.js';
import { AccountsRepository } from '../repositories/accounts.repository.js';
import { DimensionsRepository } from '../repositories/dimensions.repository.js';
import { JournalsRepository } from '../repositories/journals.repository.js';
import { LedgerRepository } from '../repositories/ledger.repository.js';
import { NumberSeriesRepository } from '../repositories/number-series.repository.js';
import type { NormalizedJournalLine } from './journal-rules.js';

export const JOURNAL_NUMBER_PREFIX = 'JV';

export const formatJournalNumber = (year: number, sequence: number): string =>
  `${JOURNAL_NUMBER_PREFIX}-${year}-${String(sequence).padStart(6, '0')}`;

/**
 * The only way anything reaches the general ledger. Manual journals today;
 * invoices, payments and bank transactions will call the same engine.
 *
 * In one transaction: re-validate lines -> resolve the open fiscal period ->
 * take the next gapless number -> flip DRAFT to POSTED (compare-and-set) ->
 * write ledger rows. The database re-checks balance and postability at commit.
 */
@Injectable()
export class PostingService {
  constructor(
    private readonly db: Db,
    private readonly ctx: RequestContext,
    private readonly accounting: AccountingContext,
    private readonly fiscal: FiscalCalendarService,
    private readonly journals: JournalsRepository,
    private readonly ledger: LedgerRepository,
    private readonly numbers: NumberSeriesRepository,
    private readonly accounts: AccountsRepository,
    private readonly dimensions: DimensionsRepository,
    private readonly audit: AuditService,
  ) {}

  async postDraft(entryId: string): Promise<void> {
    await this.db.transaction(async () => {
      const entry = await this.journals.findDetail(entryId);
      if (!entry) throw AppException.notFound('Journal entry', entryId);
      if (entry.status !== 'DRAFT') {
        throw new AppException(ErrorCode.ENTRY_NOT_EDITABLE, `Journal entry ${entry.number} is already posted`);
      }

      const lines: NormalizedJournalLine[] = entry.lines.map((l) => ({
        lineNo: l.lineNo,
        accountId: l.accountId,
        debit: new Decimal(l.debit.toString()),
        credit: new Decimal(l.credit.toString()),
        description: l.description,
        branchId: l.branchId,
        costCenterId: l.costCenterId,
      }));
      await this.assertPostable(lines);

      const period = await this.fiscal.resolveOpenPeriod(entry.date);
      const year = entry.date.getUTCFullYear();
      const number = formatJournalNumber(year, await this.numbers.next(JOURNAL_NUMBER_PREFIX, year));

      const posted = await this.journals.markPosted(entry.id, {
        number,
        fiscalPeriodId: period.id,
        postedById: this.ctx.actor?.type === 'user' ? this.ctx.actor.userId : null,
      });
      if (!posted) {
        throw new AppException(ErrorCode.CONCURRENT_MODIFICATION, 'The entry was posted or changed concurrently');
      }

      const { baseCurrency } = await this.accounting.profile();
      const rate = new Decimal(entry.exchangeRate.toString());
      await this.ledger.insert(
        entry.lines.map((line, i) => {
          const normalized = lines[i]!;
          return {
            journalEntryId: entry.id,
            journalLineId: line.id,
            accountId: line.accountId,
            fiscalPeriodId: period.id,
            date: entry.date,
            debit: roundMoney(normalized.debit.times(rate), baseCurrency),
            credit: roundMoney(normalized.credit.times(rate), baseCurrency),
            currency: entry.currency,
            txnDebit: normalized.debit,
            txnCredit: normalized.credit,
            branchId: line.branchId,
            costCenterId: line.costCenterId,
            description: line.description ?? entry.memo,
          };
        }),
      );

      await this.audit.record({
        action: 'journal.posted',
        entityType: 'journal_entry',
        entityId: entry.id,
        metadata: { number, date: entry.date.toISOString().slice(0, 10), total: entry.totalAmount.toString() },
      });
    });
  }

  /**
   * Accounts must belong to this tenant, be postable (not a group) and
   * active; dimensions must exist and be active. Errors point at the line.
   */
  async assertPostable(lines: readonly NormalizedJournalLine[]): Promise<void> {
    const accountIds = lines.map((l) => l.accountId);
    const [accounts, invalidDims] = await Promise.all([
      this.accounts.findPostingInfo(accountIds),
      this.dimensions.findInvalidDimensions(
        [...new Set(lines.flatMap((l) => (l.branchId ? [l.branchId] : [])))],
        [...new Set(lines.flatMap((l) => (l.costCenterId ? [l.costCenterId] : [])))],
      ),
    ]);
    const byId = new Map(accounts.map((a) => [a.id, a]));

    const missing: Array<{ field: string; errors: string[] }> = [];
    const notPostable: Array<{ line: number; account: string; reason: string }> = [];
    lines.forEach((line, i) => {
      const account = byId.get(line.accountId);
      if (!account) missing.push({ field: `lines[${i}].accountId`, errors: ['account not found'] });
      else if (account.isGroup) notPostable.push({ line: i + 1, account: account.code, reason: 'group account' });
      else if (!account.isActive) notPostable.push({ line: i + 1, account: account.code, reason: 'inactive account' });
      if (line.branchId && invalidDims.branches.includes(line.branchId)) {
        missing.push({ field: `lines[${i}].branchId`, errors: ['branch not found or inactive'] });
      }
      if (line.costCenterId && invalidDims.costCenters.includes(line.costCenterId)) {
        missing.push({ field: `lines[${i}].costCenterId`, errors: ['cost center not found or inactive'] });
      }
    });

    if (missing.length > 0) throw new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', missing);
    if (notPostable.length > 0) {
      throw new AppException(ErrorCode.ACCOUNT_NOT_POSTABLE, 'Some lines use accounts that cannot be posted to', notPostable);
    }
  }
}
