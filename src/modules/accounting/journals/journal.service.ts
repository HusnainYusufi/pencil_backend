import { Injectable } from '@nestjs/common';
import { formatDateOnly, parseDateOnly } from '../../../common/helpers/date.js';
import { Decimal } from '../../../common/helpers/money.js';
import type { Page } from '../../../common/helpers/pagination.js';
import { RequestContext } from '../../../core/context/request-context.service.js';
import { Db } from '../../../core/database/db.service.js';
import { AppException } from '../../../core/errors/app.exception.js';
import { ErrorCode } from '../../../core/errors/error-codes.js';
import type { JournalEntry } from '../../../generated/prisma/client.js';
import { AuditService } from '../../audit/audit.service.js';
import { AccountingContext } from '../accounting-context.service.js';
import type {
  CreateJournalEntryDto,
  JournalsQueryDto,
  ReverseJournalEntryDto,
  UpdateJournalEntryDto,
} from '../dto/journals.dto.js';
import { JournalsRepository, type JournalEntryDetail } from '../repositories/journals.repository.js';
import { normalizeJournalLines, type NormalizedJournal } from './journal-rules.js';
import { PostingService } from './posting.service.js';

const USER_SOURCES = new Set(['MANUAL', 'OPENING_BALANCE']);

/**
 * Manual journal workflow: DRAFT (editable, deletable) -> POSTED (immutable,
 * numbered, in the ledger) -> optionally REVERSED by a mirror entry.
 */
@Injectable()
export class JournalService {
  constructor(
    private readonly db: Db,
    private readonly ctx: RequestContext,
    private readonly accounting: AccountingContext,
    private readonly journals: JournalsRepository,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
  ) {}

  list(query: JournalsQueryDto): Promise<Page<JournalEntry>> {
    return this.journals.list({
      ...query,
      from: query.from ? parseDateOnly(query.from) : undefined,
      to: query.to ? parseDateOnly(query.to) : undefined,
    });
  }

  async get(id: string): Promise<JournalEntryDetail> {
    const entry = await this.journals.findDetail(id);
    if (!entry) throw AppException.notFound('Journal entry', id);
    return entry;
  }

  async create(dto: CreateJournalEntryDto): Promise<JournalEntryDetail> {
    const { currency, journal } = await this.prepare(dto);
    const id = await this.db.transaction(async () => {
      await this.posting.assertPostable(journal.lines);
      const entry = await this.journals.createDraft(
        {
          date: parseDateOnly(dto.date),
          source: dto.source ?? 'MANUAL',
          reference: dto.reference ?? null,
          memo: dto.memo ?? null,
          currency,
          totalAmount: journal.total.toFixed(4),
          createdById: this.userId(),
        },
        journal.lines,
      );
      await this.audit.record({ action: 'journal.created', entityType: 'journal_entry', entityId: entry.id });
      if (dto.post) await this.posting.postDraft(entry.id);
      return entry.id;
    });
    return this.get(id);
  }

  async update(id: string, dto: UpdateJournalEntryDto): Promise<JournalEntryDetail> {
    const { currency, journal } = await this.prepare(dto);
    await this.db.transaction(async () => {
      await this.posting.assertPostable(journal.lines);
      const replaced = await this.journals.replaceDraft(
        id,
        {
          date: parseDateOnly(dto.date),
          source: dto.source ?? 'MANUAL',
          reference: dto.reference ?? null,
          memo: dto.memo ?? null,
          currency,
          totalAmount: journal.total.toFixed(4),
        },
        journal.lines,
      );
      if (!replaced) await this.throwNotEditable(id);
      await this.audit.record({ action: 'journal.updated', entityType: 'journal_entry', entityId: id });
    });
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    await this.db.transaction(async () => {
      if (!(await this.journals.deleteDraft(id))) await this.throwNotEditable(id);
      await this.audit.record({ action: 'journal.deleted', entityType: 'journal_entry', entityId: id });
    });
  }

  async post(id: string): Promise<JournalEntryDetail> {
    await this.posting.postDraft(id);
    return this.get(id);
  }

  /** Posts a mirror entry (debits <-> credits) linked to the original. */
  async reverse(id: string, dto: ReverseJournalEntryDto): Promise<JournalEntryDetail> {
    const reversalId = await this.db.transaction(async () => {
      const original = await this.get(id);
      if (original.status !== 'POSTED') {
        throw new AppException(ErrorCode.ENTRY_NOT_REVERSIBLE, 'Only posted entries can be reversed; edit or delete the draft instead');
      }
      if (original.reversedBy) {
        throw new AppException(ErrorCode.ENTRY_NOT_REVERSIBLE, `Already reversed by ${original.reversedBy.number}`);
      }
      if (!USER_SOURCES.has(original.source)) {
        throw new AppException(ErrorCode.ENTRY_NOT_REVERSIBLE, 'This entry belongs to a document; cancel or credit the document instead');
      }
      const date = dto.date ? parseDateOnly(dto.date) : await this.accounting.today();
      if (date < original.date) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', [
          { field: 'date', errors: [`reversal date cannot be before the original date ${formatDateOnly(original.date)}`] },
        ]);
      }

      const lines = original.lines.map((l) => ({
        lineNo: l.lineNo,
        accountId: l.accountId,
        debit: new Decimal(l.credit.toString()),
        credit: new Decimal(l.debit.toString()),
        description: l.description,
        branchId: l.branchId,
        costCenterId: l.costCenterId,
      }));
      const reversal = await this.journals.createDraft(
        {
          date,
          source: 'REVERSAL',
          reference: original.number,
          memo: dto.memo ?? `Reversal of ${original.number}`,
          currency: original.currency,
          totalAmount: original.totalAmount.toString(),
          reversalOfId: original.id,
          createdById: this.userId(),
        },
        lines,
      );
      await this.posting.postDraft(reversal.id);
      await this.audit.record({
        action: 'journal.reversed',
        entityType: 'journal_entry',
        entityId: original.id,
        metadata: { reversalId: reversal.id },
      });
      return reversal.id;
    });
    return this.get(reversalId);
  }

  private async prepare(dto: CreateJournalEntryDto | UpdateJournalEntryDto): Promise<{ currency: string; journal: NormalizedJournal }> {
    const { baseCurrency } = await this.accounting.profile();
    const currency = dto.currency ?? baseCurrency;
    if (currency !== baseCurrency) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', [
        { field: 'currency', errors: [`journals are in the base currency (${baseCurrency}); multi-currency is coming`] },
      ]);
    }
    return { currency, journal: normalizeJournalLines(dto.lines, currency) };
  }

  private async throwNotEditable(id: string): Promise<never> {
    const entry = await this.journals.findDetail(id);
    if (!entry) throw AppException.notFound('Journal entry', id);
    throw new AppException(ErrorCode.ENTRY_NOT_EDITABLE, `Journal entry ${entry.number} is posted; reverse it instead`);
  }

  private userId(): string | null {
    return this.ctx.actor?.type === 'user' ? this.ctx.actor.userId : null;
  }
}
