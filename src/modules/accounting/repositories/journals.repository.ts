import { Injectable } from '@nestjs/common';
import { buildPage, toSkipTake, type Page, type PageQuery } from '../../../common/helpers/pagination.js';
import { TenantScopedRepository } from '../../../core/database/base.repository.js';
import type { JournalEntry, JournalSource, JournalStatus, Prisma } from '../../../generated/prisma/client.js';
import type { NormalizedJournalLine } from '../journals/journal-rules.js';

const ENTRY_DETAIL = {
  lines: {
    orderBy: { lineNo: 'asc' },
    include: {
      account: { select: { id: true, code: true, name: true, nameAr: true } },
      branch: { select: { id: true, code: true, name: true } },
      costCenter: { select: { id: true, code: true, name: true } },
    },
  },
  reversedBy: { select: { id: true, number: true, date: true } },
  reversalOf: { select: { id: true, number: true, date: true } },
} satisfies Prisma.JournalEntryInclude;

export type JournalEntryDetail = Prisma.JournalEntryGetPayload<{ include: typeof ENTRY_DETAIL }>;

export interface JournalListFilter extends PageQuery {
  status?: JournalStatus;
  source?: JournalSource;
  from?: Date;
  to?: Date;
  accountId?: string;
  search?: string;
}

export interface JournalHeader {
  date: Date;
  source: JournalSource;
  sourceId?: string | null;
  reference?: string | null;
  memo?: string | null;
  currency: string;
  totalAmount: string;
  reversalOfId?: string | null;
  createdById: string | null;
}

const lineRows = (tenantId: string, lines: NormalizedJournalLine[]) =>
  lines.map((l) => ({
    tenantId,
    lineNo: l.lineNo,
    accountId: l.accountId,
    description: l.description,
    debit: l.debit.toFixed(4),
    credit: l.credit.toFixed(4),
    branchId: l.branchId,
    costCenterId: l.costCenterId,
  }));

@Injectable()
export class JournalsRepository extends TenantScopedRepository {
  findDetail(id: string): Promise<JournalEntryDetail | null> {
    return this.client.journalEntry.findFirst({ where: { id, tenantId: this.tenantId }, include: ENTRY_DETAIL });
  }

  async list(filter: JournalListFilter): Promise<Page<JournalEntry>> {
    const search = filter.search?.trim();
    const where: Prisma.JournalEntryWhereInput = {
      tenantId: this.tenantId,
      ...(filter.status && { status: filter.status }),
      ...(filter.source && { source: filter.source }),
      ...((filter.from || filter.to) && {
        date: { ...(filter.from && { gte: filter.from }), ...(filter.to && { lte: filter.to }) },
      }),
      ...(filter.accountId && { lines: { some: { accountId: filter.accountId } } }),
      ...(search && {
        OR: [
          { number: { contains: search, mode: 'insensitive' } },
          { reference: { contains: search, mode: 'insensitive' } },
          { memo: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      this.client.journalEntry.findMany({
        where,
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        ...toSkipTake(filter),
      }),
      this.client.journalEntry.count({ where }),
    ]);
    return buildPage(items, total, filter);
  }

  createDraft(header: JournalHeader, lines: NormalizedJournalLine[]): Promise<JournalEntry> {
    const tenantId = this.tenantId;
    return this.client.journalEntry.create({
      data: { ...header, tenantId, status: 'DRAFT', lines: { createMany: { data: lineRows(tenantId, lines) } } },
    });
  }

  /** Replaces header + lines of a draft. Returns false if it is no longer a draft. */
  async replaceDraft(id: string, header: Partial<JournalHeader>, lines: NormalizedJournalLine[]): Promise<boolean> {
    const tenantId = this.tenantId;
    const { count } = await this.client.journalEntry.updateMany({
      where: { id, tenantId, status: 'DRAFT' },
      data: header,
    });
    if (count === 0) return false;
    await this.client.journalLine.deleteMany({ where: { journalEntryId: id, tenantId } });
    await this.client.journalLine.createMany({ data: lineRows(tenantId, lines).map((l) => ({ ...l, journalEntryId: id })) });
    return true;
  }

  async deleteDraft(id: string): Promise<boolean> {
    const { count } = await this.client.journalEntry.deleteMany({ where: { id, tenantId: this.tenantId, status: 'DRAFT' } });
    return count === 1;
  }

  /**
   * Compare-and-set DRAFT -> POSTED: only one concurrent poster can win; the
   * loser's transaction rolls back (including its consumed number).
   */
  async markPosted(
    id: string,
    data: { number: string; fiscalPeriodId: string; postedById: string | null },
  ): Promise<boolean> {
    const { count } = await this.client.journalEntry.updateMany({
      where: { id, tenantId: this.tenantId, status: 'DRAFT' },
      data: { ...data, status: 'POSTED', postedAt: new Date() },
    });
    return count === 1;
  }
}
