import { Injectable } from '@nestjs/common';
import { buildPage, toSkipTake, type Page, type PageQuery } from '../../../common/helpers/pagination.js';
import { TenantScopedRepository } from '../../../core/database/base.repository.js';
import type { CustomerPaymentStatus, Prisma } from '../../../generated/prisma/client.js';

const PAYMENT_DETAIL = {
  contact: { select: { id: true, name: true, nameAr: true } },
  account: { select: { id: true, code: true, name: true, nameAr: true } },
  journalEntry: { select: { id: true, number: true } },
  allocations: {
    include: { invoice: { select: { id: true, number: true, type: true, issueDate: true, total: true } } },
  },
} satisfies Prisma.CustomerPaymentInclude;

export type CustomerPaymentDetail = Prisma.CustomerPaymentGetPayload<{ include: typeof PAYMENT_DETAIL }>;

export interface CustomerPaymentListFilter extends PageQuery {
  contactId?: string;
  status?: CustomerPaymentStatus;
  from?: Date;
  to?: Date;
}

@Injectable()
export class CustomerPaymentsRepository extends TenantScopedRepository {
  findDetail(id: string): Promise<CustomerPaymentDetail | null> {
    return this.client.customerPayment.findFirst({ where: { id, tenantId: this.tenantId }, include: PAYMENT_DETAIL });
  }

  async list(filter: CustomerPaymentListFilter): Promise<Page<CustomerPaymentDetail>> {
    const where: Prisma.CustomerPaymentWhereInput = {
      tenantId: this.tenantId,
      ...(filter.contactId && { contactId: filter.contactId }),
      ...(filter.status && { status: filter.status }),
      ...((filter.from || filter.to) && {
        date: { ...(filter.from && { gte: filter.from }), ...(filter.to && { lte: filter.to }) },
      }),
    };
    const [items, total] = await Promise.all([
      this.client.customerPayment.findMany({
        where,
        include: PAYMENT_DETAIL,
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        ...toSkipTake(filter),
      }),
      this.client.customerPayment.count({ where }),
    ]);
    return buildPage(items, total, filter);
  }

  async create(
    data: Omit<Prisma.CustomerPaymentUncheckedCreateInput, 'tenantId' | 'allocations'>,
    allocations: Array<{ invoiceId: string; amount: string }>,
  ): Promise<{ id: string }> {
    const tenantId = this.tenantId;
    return this.client.customerPayment.create({
      data: {
        ...data,
        tenantId,
        allocations: { createMany: { data: allocations.map((a) => ({ ...a, tenantId })) } },
      },
      select: { id: true },
    });
  }

  async setJournal(id: string, journalEntryId: string): Promise<void> {
    await this.client.customerPayment.updateMany({ where: { id, tenantId: this.tenantId }, data: { journalEntryId } });
  }

  async markVoid(id: string, voidedById: string | null): Promise<boolean> {
    const { count } = await this.client.customerPayment.updateMany({
      where: { id, tenantId: this.tenantId, status: 'POSTED' },
      data: { status: 'VOID', voidedById, voidedAt: new Date() },
    });
    return count === 1;
  }
}
