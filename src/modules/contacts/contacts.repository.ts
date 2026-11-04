import { Injectable } from '@nestjs/common';
import { buildPage, toSkipTake, type Page, type PageQuery } from '../../common/helpers/pagination.js';
import { TenantScopedRepository } from '../../core/database/base.repository.js';
import type { Contact, Prisma } from '../../generated/prisma/client.js';

export interface ContactListFilter extends PageQuery {
  search?: string;
  includeInactive?: boolean;
  customers?: boolean;
}

@Injectable()
export class ContactsRepository extends TenantScopedRepository {
  findById(id: string): Promise<Contact | null> {
    return this.client.contact.findFirst({ where: { id, tenantId: this.tenantId } });
  }

  async list(filter: ContactListFilter): Promise<Page<Contact>> {
    const search = filter.search?.trim();
    const where: Prisma.ContactWhereInput = {
      tenantId: this.tenantId,
      ...(!filter.includeInactive && { isActive: true }),
      ...(filter.customers && { isCustomer: true }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { nameAr: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { taxNumber: { startsWith: search } },
          { phone: { contains: search } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      this.client.contact.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...toSkipTake(filter) }),
      this.client.contact.count({ where }),
    ]);
    return buildPage(items, total, filter);
  }

  create(data: Omit<Prisma.ContactUncheckedCreateInput, 'tenantId'>): Promise<Contact> {
    return this.client.contact.create({ data: { ...data, tenantId: this.tenantId } });
  }

  update(id: string, data: Prisma.ContactUncheckedUpdateInput): Promise<Contact> {
    return this.client.contact.update({ where: { id, tenantId: this.tenantId }, data });
  }

  async hasDocuments(id: string): Promise<boolean> {
    const where = { tenantId: this.tenantId, contactId: id };
    const [invoices, payments] = await Promise.all([
      this.client.salesInvoice.count({ where }),
      this.client.customerPayment.count({ where }),
    ]);
    return invoices + payments > 0;
  }

  async delete(id: string): Promise<void> {
    await this.client.contact.deleteMany({ where: { id, tenantId: this.tenantId } });
  }

  /** Open receivable per contact: issued invoices and debit notes minus settlements, minus unapplied credit. */
  async balance(id: string): Promise<string> {
    const rows = await this.inScope((client) =>
      client.$queryRaw<{ balance: string | null }[]>`
        SELECT SUM(CASE WHEN type = 'CREDIT_NOTE' THEN -(total - amount_paid - amount_credited)
                        ELSE total - amount_paid - amount_credited END)::text AS balance
        FROM sales_invoices
        WHERE tenant_id = ${this.tenantId}::uuid AND contact_id = ${id}::uuid AND status = 'ISSUED'`,
    );
    return rows[0]?.balance ?? '0';
  }
}
