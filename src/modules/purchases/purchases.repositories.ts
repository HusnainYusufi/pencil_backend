import { Injectable } from '@nestjs/common';
import { buildPage, toSkipTake, type Page, type PageQuery } from '../../common/helpers/pagination.js';
import { TenantScopedRepository } from '../../core/database/base.repository.js';
import type { Prisma, PurchaseDocumentType, PurchaseStatus, SupplierPaymentStatus } from '../../generated/prisma/client.js';

const BILL_DETAIL = {
  lines: {
    orderBy: { lineNo: 'asc' },
    include: {
      account: { select: { id: true, code: true, name: true, nameAr: true } },
      taxRate: { select: { id: true, code: true, name: true, nameAr: true } },
      costCenter: { select: { id: true, code: true, name: true } },
    },
  },
  contact: true,
  paidFrom: { select: { id: true, code: true, name: true, nameAr: true } },
  originalBill: { select: { id: true, number: true, billDate: true, total: true } },
  adjustments: {
    where: { status: { not: 'DRAFT' } },
    select: { id: true, type: true, number: true, billDate: true, total: true, status: true },
  },
  allocations: { where: { payment: { status: 'POSTED' } }, include: { payment: { select: { id: true, number: true, date: true } } } },
  journalEntry: { select: { id: true, number: true } },
} satisfies Prisma.PurchaseBillInclude;
export type PurchaseBillDetail = Prisma.PurchaseBillGetPayload<{ include: typeof BILL_DETAIL }>;

const BILL_SUMMARY = { contact: { select: { id: true, name: true, nameAr: true } } } satisfies Prisma.PurchaseBillInclude;
export type PurchaseBillSummary = Prisma.PurchaseBillGetPayload<{ include: typeof BILL_SUMMARY }>;

export type PurchaseBillHeader = Omit<Prisma.PurchaseBillUncheckedCreateInput, 'tenantId' | 'lines'>;
export type PurchaseBillLineRow = Omit<Prisma.PurchaseBillLineUncheckedCreateWithoutBillInput, 'tenantId'>;

@Injectable()
export class PurchaseBillsRepository extends TenantScopedRepository {
  findDetail(id: string): Promise<PurchaseBillDetail | null> {
    return this.client.purchaseBill.findFirst({ where: { id, tenantId: this.tenantId }, include: BILL_DETAIL });
  }

  async list(
    filter: PageQuery & { type?: PurchaseDocumentType; status?: PurchaseStatus; contactId?: string; from?: Date; to?: Date; open?: boolean; search?: string },
  ): Promise<Page<PurchaseBillSummary>> {
    const search = filter.search?.trim();
    const where: Prisma.PurchaseBillWhereInput = {
      tenantId: this.tenantId,
      ...(filter.type && { type: filter.type }),
      ...(filter.status && { status: filter.status }),
      ...(filter.contactId && { contactId: filter.contactId }),
      ...((filter.from || filter.to) && { billDate: { ...(filter.from && { gte: filter.from }), ...(filter.to && { lte: filter.to }) } }),
      ...(search && {
        OR: [
          { number: { contains: search, mode: 'insensitive' } },
          { supplierReference: { contains: search, mode: 'insensitive' } },
          { contact: { name: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };
    if (filter.open) {
      const rows = await this.inScope((client) =>
        client.$queryRaw<{ id: string }[]>`
          SELECT id FROM purchase_bills
          WHERE tenant_id = ${this.tenantId}::uuid AND status = 'POSTED' AND type = 'BILL' AND total > amount_paid + amount_credited`,
      );
      where.id = { in: rows.map((r) => r.id) };
    }
    const [items, total] = await Promise.all([
      this.client.purchaseBill.findMany({ where, include: BILL_SUMMARY, orderBy: [{ billDate: 'desc' }, { id: 'desc' }], ...toSkipTake(filter) }),
      this.client.purchaseBill.count({ where }),
    ]);
    return buildPage(items, total, filter);
  }

  createDraft(header: PurchaseBillHeader, lines: PurchaseBillLineRow[]): Promise<{ id: string }> {
    const tenantId = this.tenantId;
    return this.client.purchaseBill.create({
      data: { ...header, tenantId, status: 'DRAFT', lines: { createMany: { data: lines.map((l) => ({ ...l, tenantId })) } } },
      select: { id: true },
    });
  }

  async replaceDraft(id: string, header: Partial<PurchaseBillHeader>, lines: PurchaseBillLineRow[]): Promise<boolean> {
    const tenantId = this.tenantId;
    const { count } = await this.client.purchaseBill.updateMany({ where: { id, tenantId, status: 'DRAFT' }, data: header });
    if (count === 0) return false;
    await this.client.purchaseBillLine.deleteMany({ where: { billId: id, tenantId } });
    await this.client.purchaseBillLine.createMany({ data: lines.map((l) => ({ ...l, tenantId, billId: id })) });
    return true;
  }

  async deleteDraft(id: string): Promise<boolean> {
    const { count } = await this.client.purchaseBill.deleteMany({ where: { id, tenantId: this.tenantId, status: 'DRAFT' } });
    return count === 1;
  }

  async markPosted(id: string, data: Prisma.PurchaseBillUncheckedUpdateManyInput): Promise<boolean> {
    const { count } = await this.client.purchaseBill.updateMany({ where: { id, tenantId: this.tenantId, status: 'DRAFT' }, data: { ...data, status: 'POSTED' } });
    return count === 1;
  }

  async markVoid(id: string, data: { voidedById: string | null; voidReason: string }): Promise<boolean> {
    const { count } = await this.client.purchaseBill.updateMany({
      where: { id, tenantId: this.tenantId, status: 'POSTED' },
      data: { ...data, status: 'VOID', voidedAt: new Date() },
    });
    return count === 1;
  }

  /** Moves amount_paid / amount_credited by `delta`, never past the total or below zero. */
  async adjustSettlement(id: string, column: 'amount_paid' | 'amount_credited', delta: string): Promise<boolean> {
    const rows = await this.inScope((client) =>
      column === 'amount_paid'
        ? client.$queryRaw<{ id: string }[]>`
            UPDATE purchase_bills SET amount_paid = amount_paid + ${delta}::numeric, updated_at = now()
            WHERE id = ${id}::uuid AND tenant_id = ${this.tenantId}::uuid AND status = 'POSTED'
              AND amount_paid + ${delta}::numeric >= 0 AND amount_paid + ${delta}::numeric + amount_credited <= total
            RETURNING id`
        : client.$queryRaw<{ id: string }[]>`
            UPDATE purchase_bills SET amount_credited = amount_credited + ${delta}::numeric, updated_at = now()
            WHERE id = ${id}::uuid AND tenant_id = ${this.tenantId}::uuid AND status = 'POSTED'
              AND amount_credited + ${delta}::numeric >= 0 AND amount_paid + amount_credited + ${delta}::numeric <= total
            RETURNING id`,
    );
    return rows.length === 1;
  }

  async creditedTotal(originalBillId: string, excludeId?: string): Promise<string> {
    const result = await this.client.purchaseBill.aggregate({
      where: { tenantId: this.tenantId, originalBillId, type: 'CREDIT_NOTE', status: 'POSTED', ...(excludeId && { id: { not: excludeId } }) },
      _sum: { total: true },
    });
    return result._sum.total?.toString() ?? '0';
  }
}

const PAYMENT_DETAIL = {
  contact: { select: { id: true, name: true, nameAr: true } },
  account: { select: { id: true, code: true, name: true, nameAr: true } },
  journalEntry: { select: { id: true, number: true } },
  allocations: { include: { bill: { select: { id: true, number: true, supplierReference: true, billDate: true, total: true } } } },
} satisfies Prisma.SupplierPaymentInclude;
export type SupplierPaymentDetail = Prisma.SupplierPaymentGetPayload<{ include: typeof PAYMENT_DETAIL }>;

@Injectable()
export class SupplierPaymentsRepository extends TenantScopedRepository {
  findDetail(id: string): Promise<SupplierPaymentDetail | null> {
    return this.client.supplierPayment.findFirst({ where: { id, tenantId: this.tenantId }, include: PAYMENT_DETAIL });
  }

  async list(filter: PageQuery & { contactId?: string; status?: SupplierPaymentStatus }): Promise<Page<SupplierPaymentDetail>> {
    const where: Prisma.SupplierPaymentWhereInput = {
      tenantId: this.tenantId,
      ...(filter.contactId && { contactId: filter.contactId }),
      ...(filter.status && { status: filter.status }),
    };
    const [items, total] = await Promise.all([
      this.client.supplierPayment.findMany({ where, include: PAYMENT_DETAIL, orderBy: [{ date: 'desc' }, { id: 'desc' }], ...toSkipTake(filter) }),
      this.client.supplierPayment.count({ where }),
    ]);
    return buildPage(items, total, filter);
  }

  create(data: Omit<Prisma.SupplierPaymentUncheckedCreateInput, 'tenantId' | 'allocations'>, allocations: Array<{ billId: string; amount: string }>) {
    const tenantId = this.tenantId;
    return this.client.supplierPayment.create({
      data: { ...data, tenantId, allocations: { createMany: { data: allocations.map((a) => ({ ...a, tenantId })) } } },
      select: { id: true },
    });
  }

  async setJournal(id: string, journalEntryId: string): Promise<void> {
    await this.client.supplierPayment.updateMany({ where: { id, tenantId: this.tenantId }, data: { journalEntryId } });
  }

  async markVoid(id: string, voidedById: string | null): Promise<boolean> {
    const { count } = await this.client.supplierPayment.updateMany({
      where: { id, tenantId: this.tenantId, status: 'POSTED' },
      data: { status: 'VOID', voidedById, voidedAt: new Date() },
    });
    return count === 1;
  }
}
