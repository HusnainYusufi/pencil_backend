import { Injectable } from '@nestjs/common';
import { buildPage, toSkipTake, type Page, type PageQuery } from '../../../common/helpers/pagination.js';
import { TenantScopedRepository } from '../../../core/database/base.repository.js';
import type { Prisma, SalesDocumentType, SalesInvoiceStatus } from '../../../generated/prisma/client.js';

const DOCUMENT_DETAIL = {
  lines: {
    orderBy: { lineNo: 'asc' },
    include: {
      account: { select: { id: true, code: true, name: true, nameAr: true } },
      taxRate: { select: { id: true, code: true, name: true, nameAr: true, accountId: true } },
      costCenter: { select: { id: true, code: true, name: true } },
    },
  },
  contact: true,
  branch: { select: { id: true, code: true, name: true } },
  originalInvoice: { select: { id: true, number: true, issueDate: true, total: true, kind: true } },
  adjustments: {
    where: { status: { not: 'DRAFT' } },
    orderBy: { issueDate: 'asc' },
    select: { id: true, type: true, number: true, issueDate: true, total: true, status: true },
  },
  allocations: {
    where: { payment: { status: 'POSTED' } },
    include: { payment: { select: { id: true, number: true, date: true } } },
  },
  journalEntry: { select: { id: true, number: true } },
  einvoice: {
    select: {
      id: true,
      provider: true,
      submissionType: true,
      status: true,
      icv: true,
      invoiceHash: true,
      qr: true,
      warnings: true,
      errors: true,
      attempts: true,
      lastAttemptAt: true,
      nextAttemptAt: true,
      acceptedAt: true,
    },
  },
} satisfies Prisma.SalesInvoiceInclude;

export type SalesInvoiceDetail = Prisma.SalesInvoiceGetPayload<{ include: typeof DOCUMENT_DETAIL }>;

const DOCUMENT_SUMMARY = {
  contact: { select: { id: true, name: true, nameAr: true } },
  einvoice: { select: { status: true } },
} satisfies Prisma.SalesInvoiceInclude;

export type SalesInvoiceSummary = Prisma.SalesInvoiceGetPayload<{ include: typeof DOCUMENT_SUMMARY }>;

export interface SalesInvoiceListFilter extends PageQuery {
  type?: SalesDocumentType;
  status?: SalesInvoiceStatus;
  contactId?: string;
  from?: Date;
  to?: Date;
  open?: boolean;
  search?: string;
}

export type SalesInvoiceHeader = Omit<Prisma.SalesInvoiceUncheckedCreateInput, 'tenantId' | 'lines'>;
export type SalesInvoiceLineRow = Omit<Prisma.SalesInvoiceLineUncheckedCreateWithoutInvoiceInput, 'tenantId'>;

@Injectable()
export class SalesInvoicesRepository extends TenantScopedRepository {
  findDetail(id: string): Promise<SalesInvoiceDetail | null> {
    return this.client.salesInvoice.findFirst({ where: { id, tenantId: this.tenantId }, include: DOCUMENT_DETAIL });
  }

  async list(filter: SalesInvoiceListFilter): Promise<Page<SalesInvoiceSummary>> {
    const search = filter.search?.trim();
    const where: Prisma.SalesInvoiceWhereInput = {
      tenantId: this.tenantId,
      ...(filter.type && { type: filter.type }),
      ...(filter.status && { status: filter.status }),
      ...(filter.contactId && { contactId: filter.contactId }),
      ...((filter.from || filter.to) && {
        issueDate: { ...(filter.from && { gte: filter.from }), ...(filter.to && { lte: filter.to }) },
      }),
      ...(search && {
        OR: [
          { number: { contains: search, mode: 'insensitive' } },
          { reference: { contains: search, mode: 'insensitive' } },
          { contact: { name: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };
    if (filter.open) {
      const openIds = await this.openDocumentIds();
      where.id = { in: openIds };
    }
    const [items, total] = await Promise.all([
      this.client.salesInvoice.findMany({
        where,
        include: DOCUMENT_SUMMARY,
        orderBy: [{ issueDate: 'desc' }, { id: 'desc' }],
        ...toSkipTake(filter),
      }),
      this.client.salesInvoice.count({ where }),
    ]);
    return buildPage(items, total, filter);
  }

  private async openDocumentIds(): Promise<string[]> {
    const rows = await this.inScope((client) =>
      client.$queryRaw<{ id: string }[]>`
        SELECT id FROM sales_invoices
        WHERE tenant_id = ${this.tenantId}::uuid AND status = 'ISSUED' AND total > amount_paid + amount_credited`,
    );
    return rows.map((r) => r.id);
  }

  async createDraft(header: SalesInvoiceHeader, lines: SalesInvoiceLineRow[]): Promise<{ id: string }> {
    const tenantId = this.tenantId;
    return this.client.salesInvoice.create({
      data: {
        ...header,
        tenantId,
        status: 'DRAFT',
        lines: { createMany: { data: lines.map((l) => ({ ...l, tenantId })) } },
      },
      select: { id: true },
    });
  }

  /** Replaces header + lines of a draft. False when it is no longer a draft. */
  async replaceDraft(id: string, header: Partial<SalesInvoiceHeader>, lines: SalesInvoiceLineRow[]): Promise<boolean> {
    const tenantId = this.tenantId;
    const { count } = await this.client.salesInvoice.updateMany({ where: { id, tenantId, status: 'DRAFT' }, data: header });
    if (count === 0) return false;
    await this.client.salesInvoiceLine.deleteMany({ where: { invoiceId: id, tenantId } });
    await this.client.salesInvoiceLine.createMany({ data: lines.map((l) => ({ ...l, tenantId, invoiceId: id })) });
    return true;
  }

  async deleteDraft(id: string): Promise<boolean> {
    const { count } = await this.client.salesInvoice.deleteMany({ where: { id, tenantId: this.tenantId, status: 'DRAFT' } });
    return count === 1;
  }

  /** Compare-and-set DRAFT -> ISSUED: one concurrent issuer wins. */
  async markIssued(id: string, data: Prisma.SalesInvoiceUncheckedUpdateManyInput): Promise<boolean> {
    const { count } = await this.client.salesInvoice.updateMany({
      where: { id, tenantId: this.tenantId, status: 'DRAFT' },
      data: { ...data, status: 'ISSUED' },
    });
    return count === 1;
  }

  async markVoid(id: string, data: { voidedById: string | null; voidReason: string }): Promise<boolean> {
    const { count } = await this.client.salesInvoice.updateMany({
      where: { id, tenantId: this.tenantId, status: 'ISSUED' },
      data: { ...data, status: 'VOID', voidedAt: new Date() },
    });
    return count === 1;
  }

  /**
   * Moves a settlement column by `delta` (negative to release), refusing to
   * push the document past its total or below zero. Atomic, so concurrent
   * payments cannot over-settle a document.
   */
  async adjustSettlement(id: string, column: 'amount_paid' | 'amount_credited', delta: string): Promise<boolean> {
    const rows = await this.inScope((client) =>
      column === 'amount_paid'
        ? client.$queryRaw<{ id: string }[]>`
            UPDATE sales_invoices SET amount_paid = amount_paid + ${delta}::numeric, updated_at = now()
            WHERE id = ${id}::uuid AND tenant_id = ${this.tenantId}::uuid AND status = 'ISSUED'
              AND amount_paid + ${delta}::numeric >= 0
              AND amount_paid + ${delta}::numeric + amount_credited <= total
            RETURNING id`
        : client.$queryRaw<{ id: string }[]>`
            UPDATE sales_invoices SET amount_credited = amount_credited + ${delta}::numeric, updated_at = now()
            WHERE id = ${id}::uuid AND tenant_id = ${this.tenantId}::uuid AND status = 'ISSUED'
              AND amount_credited + ${delta}::numeric >= 0
              AND amount_paid + amount_credited + ${delta}::numeric <= total
            RETURNING id`,
    );
    return rows.length === 1;
  }

  /** Sum of issued credit notes against an invoice (caps further credit). */
  async creditedTotal(originalInvoiceId: string, excludeId?: string): Promise<string> {
    const result = await this.client.salesInvoice.aggregate({
      where: {
        tenantId: this.tenantId,
        originalInvoiceId,
        type: 'CREDIT_NOTE',
        status: 'ISSUED',
        ...(excludeId && { id: { not: excludeId } }),
      },
      _sum: { total: true },
    });
    return result._sum.total?.toString() ?? '0';
  }
}
