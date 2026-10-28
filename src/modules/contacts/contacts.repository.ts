import { Injectable } from '@nestjs/common';
import { formatDateOnly } from '../../common/helpers/date.js';
import { Decimal } from '../../common/helpers/money.js';
import { buildPage, toSkipTake, type Page, type PageQuery } from '../../common/helpers/pagination.js';
import { TenantScopedRepository } from '../../core/database/base.repository.js';
import type { Contact, Prisma } from '../../generated/prisma/client.js';

const dec = (value: unknown) => new Decimal(value === null || value === undefined ? 0 : String(value));

export interface ContactBalances {
  /** Owed to us (receivable accounts, debit - credit). */
  receivable: Decimal;
  /** Owed by us (payable accounts, credit - debit). */
  payable: Decimal;
}

const CONTACT_INCLUDE = {
  withholdingTaxCode: { select: { id: true, code: true, name: true, nameAr: true } },
} satisfies Prisma.ContactInclude;

export type ContactWithTax = Prisma.ContactGetPayload<{ include: typeof CONTACT_INCLUDE }>;

/** Sub-ledger queries read the ledger only (receivable / payable control accounts). */
const SUBLEDGER_KEYS = ['accounts_receivable', 'accounts_payable'];

@Injectable()
export class ContactsRepository extends TenantScopedRepository {
  async list(filter: PageQuery & { role?: 'customer' | 'supplier'; search?: string; includeInactive?: boolean }): Promise<Page<ContactWithTax>> {
    const search = filter.search?.trim();
    const where: Prisma.ContactWhereInput = {
      tenantId: this.tenantId,
      ...(filter.role === 'customer' && { isCustomer: true }),
      ...(filter.role === 'supplier' && { isSupplier: true }),
      ...(!filter.includeInactive && { isActive: true }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { nameAr: { contains: search } },
          { code: { startsWith: search, mode: 'insensitive' } },
          { taxNumber: { startsWith: search } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      this.client.contact.findMany({ where, include: CONTACT_INCLUDE, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...toSkipTake(filter) }),
      this.client.contact.count({ where }),
    ]);
    return buildPage(items, total, filter);
  }

  findById(id: string): Promise<ContactWithTax | null> {
    return this.client.contact.findFirst({ where: { id, tenantId: this.tenantId }, include: CONTACT_INCLUDE });
  }

  findByCode(code: string): Promise<Contact | null> {
    return this.client.contact.findFirst({ where: { code, tenantId: this.tenantId } });
  }

  create(data: Omit<Prisma.ContactUncheckedCreateInput, 'tenantId'>): Promise<ContactWithTax> {
    return this.client.contact.create({ data: { ...data, tenantId: this.tenantId }, include: CONTACT_INCLUDE });
  }

  update(id: string, data: Prisma.ContactUncheckedUpdateInput): Promise<ContactWithTax> {
    return this.client.contact.update({ where: { id, tenantId: this.tenantId }, data, include: CONTACT_INCLUDE });
  }

  async delete(id: string): Promise<void> {
    await this.client.contact.delete({ where: { id, tenantId: this.tenantId } });
  }

  /** Referenced by any journal line (draft or posted). */
  async isUsed(id: string): Promise<boolean> {
    return (await this.client.journalLine.count({ where: { tenantId: this.tenantId, contactId: id } })) > 0;
  }

  async balances(ids: readonly string[]): Promise<Map<string, ContactBalances>> {
    if (ids.length === 0) return new Map();
    const tenantId = this.tenantId;
    const rows = await this.inScope(
      (client) => client.$queryRaw<Array<{ contact_id: string; receivable: unknown; payable: unknown }>>`
        SELECT l.contact_id,
               SUM(l.debit - l.credit) FILTER (WHERE a.system_key = 'accounts_receivable') AS receivable,
               SUM(l.credit - l.debit) FILTER (WHERE a.system_key = 'accounts_payable')    AS payable
        FROM ledger_entries l
        JOIN accounts a ON a.id = l.account_id
        WHERE l.tenant_id = ${tenantId}::uuid
          AND l.contact_id = ANY (${[...ids]}::uuid[])
          AND a.system_key = ANY (${SUBLEDGER_KEYS})
        GROUP BY l.contact_id`,
    );
    return new Map(rows.map((r) => [r.contact_id, { receivable: dec(r.receivable), payable: dec(r.payable) }]));
  }

  /** Net sub-ledger balance (receivable - payable) before `date`. */
  async netBefore(contactId: string, date: Date): Promise<Decimal> {
    const tenantId = this.tenantId;
    const [row] = await this.inScope(
      (client) => client.$queryRaw<Array<{ net: unknown }>>`
        SELECT SUM(l.debit - l.credit) AS net
        FROM ledger_entries l JOIN accounts a ON a.id = l.account_id
        WHERE l.tenant_id = ${tenantId}::uuid AND l.contact_id = ${contactId}::uuid
          AND a.system_key = ANY (${SUBLEDGER_KEYS}) AND l.date < ${formatDateOnly(date)}::date`,
    );
    return dec(row?.net);
  }

  /** Receivable / payable postings of one contact in [from, to], oldest first. */
  statementRows(contactId: string, from: Date, to: Date) {
    return this.client.ledgerEntry.findMany({
      where: {
        tenantId: this.tenantId,
        contactId,
        date: { gte: from, lte: to },
        account: { systemKey: { in: SUBLEDGER_KEYS } },
      },
      include: {
        account: { select: { code: true, name: true, nameAr: true, systemKey: true } },
        journalEntry: { select: { id: true, number: true, source: true, reference: true, memo: true } },
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      take: 2000,
    });
  }

  /**
   * Control account vs sub-ledger: every receivable / payable posting should
   * name a contact. `unassigned` is what an auditor would ask about.
   */
  async reconciliation(): Promise<Array<{ systemKey: string; control: Decimal; subledger: Decimal }>> {
    const tenantId = this.tenantId;
    const rows = await this.inScope(
      (client) => client.$queryRaw<Array<{ system_key: string; control: unknown; subledger: unknown }>>`
        SELECT a.system_key,
               SUM(l.debit - l.credit) AS control,
               SUM(l.debit - l.credit) FILTER (WHERE l.contact_id IS NOT NULL) AS subledger
        FROM ledger_entries l JOIN accounts a ON a.id = l.account_id
        WHERE l.tenant_id = ${tenantId}::uuid AND a.system_key = ANY (${SUBLEDGER_KEYS})
        GROUP BY a.system_key`,
    );
    return SUBLEDGER_KEYS.map((key) => {
      const row = rows.find((r) => r.system_key === key);
      return { systemKey: key, control: dec(row?.control), subledger: dec(row?.subledger) };
    });
  }

  findWithholdingCode(id: string) {
    return this.client.taxCode.findFirst({ where: { id, tenantId: this.tenantId }, select: { id: true, kind: true, isActive: true } });
  }
}
