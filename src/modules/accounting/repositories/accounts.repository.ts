import { Injectable } from '@nestjs/common';
import { TenantScopedRepository } from '../../../core/database/base.repository.js';
import type { Account, AccountType, Prisma } from '../../../generated/prisma/client.js';

export interface AccountListFilter {
  type?: AccountType;
  includeInactive?: boolean;
  postableOnly?: boolean;
  search?: string;
}

export type PostingAccount = Pick<Account, 'id' | 'code' | 'type' | 'isGroup' | 'isActive' | 'allowManualPosting' | 'systemKey'>;

@Injectable()
export class AccountsRepository extends TenantScopedRepository {
  /** Charts are small (hundreds of rows): returned whole, ordered by code. */
  list(filter: AccountListFilter = {}): Promise<Account[]> {
    const search = filter.search?.trim();
    return this.client.account.findMany({
      where: {
        tenantId: this.tenantId,
        ...(filter.type && { type: filter.type }),
        ...(!filter.includeInactive && { isActive: true }),
        ...(filter.postableOnly && { isGroup: false }),
        ...(search && {
          OR: [
            { code: { startsWith: search } },
            { name: { contains: search, mode: 'insensitive' } },
            { nameAr: { contains: search } },
          ],
        }),
      },
      orderBy: { code: 'asc' },
    });
  }

  findById(id: string): Promise<Account | null> {
    return this.client.account.findFirst({ where: { id, tenantId: this.tenantId } });
  }

  findByCode(code: string): Promise<Account | null> {
    return this.client.account.findUnique({ where: { tenantId_code: { tenantId: this.tenantId, code } } });
  }

  findBySystemKey(systemKey: string): Promise<Account | null> {
    return this.client.account.findUnique({ where: { tenantId_systemKey: { tenantId: this.tenantId, systemKey } } });
  }

  findPostingInfo(ids: readonly string[]): Promise<PostingAccount[]> {
    return this.client.account.findMany({
      where: { tenantId: this.tenantId, id: { in: [...new Set(ids)] } },
      select: { id: true, code: true, type: true, isGroup: true, isActive: true, allowManualPosting: true, systemKey: true },
    });
  }

  create(data: Omit<Prisma.AccountUncheckedCreateInput, 'tenantId'>): Promise<Account> {
    return this.client.account.create({ data: { ...data, tenantId: this.tenantId } });
  }

  update(id: string, data: Prisma.AccountUncheckedUpdateInput): Promise<Account> {
    return this.client.account.update({ where: { id, tenantId: this.tenantId }, data });
  }

  async delete(id: string): Promise<void> {
    await this.client.account.delete({ where: { id, tenantId: this.tenantId } });
  }

  async hasChildren(id: string): Promise<boolean> {
    return (await this.client.account.count({ where: { tenantId: this.tenantId, parentId: id } })) > 0;
  }

  /** Referenced by any journal line (draft or posted) or ledger posting. */
  async hasActivity(id: string): Promise<boolean> {
    const [lines, ledger] = await Promise.all([
      this.client.journalLine.count({ where: { tenantId: this.tenantId, accountId: id } }),
      this.client.ledgerEntry.count({ where: { tenantId: this.tenantId, accountId: id } }),
    ]);
    return lines + ledger > 0;
  }

}
