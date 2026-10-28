import { Injectable } from '@nestjs/common';
import { buildPage, toSkipTake, type Page, type PageQuery } from '../../common/helpers/pagination.js';
import { TenantScopedRepository } from '../../core/database/base.repository.js';
import type { ItemType, Prisma } from '../../generated/prisma/client.js';

const ref = { select: { id: true, code: true, name: true, nameAr: true } } as const;
const ITEM_INCLUDE = {
  salesAccount: ref,
  purchaseAccount: ref,
  salesTaxCode: ref,
  purchaseTaxCode: ref,
} satisfies Prisma.ItemInclude;

export type ItemDetail = Prisma.ItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

@Injectable()
export class ItemsRepository extends TenantScopedRepository {
  async list(filter: PageQuery & { type?: ItemType; search?: string; includeInactive?: boolean }): Promise<Page<ItemDetail>> {
    const search = filter.search?.trim();
    const where: Prisma.ItemWhereInput = {
      tenantId: this.tenantId,
      ...(filter.type && { type: filter.type }),
      ...(!filter.includeInactive && { isActive: true }),
      ...(search && {
        OR: [
          { code: { startsWith: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
          { nameAr: { contains: search } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      this.client.item.findMany({ where, include: ITEM_INCLUDE, orderBy: [{ code: 'asc' }], ...toSkipTake(filter) }),
      this.client.item.count({ where }),
    ]);
    return buildPage(items, total, filter);
  }

  findById(id: string): Promise<ItemDetail | null> {
    return this.client.item.findFirst({ where: { id, tenantId: this.tenantId }, include: ITEM_INCLUDE });
  }

  findByCode(code: string) {
    return this.client.item.findFirst({ where: { code, tenantId: this.tenantId }, select: { id: true } });
  }

  create(data: Omit<Prisma.ItemUncheckedCreateInput, 'tenantId'>): Promise<ItemDetail> {
    return this.client.item.create({ data: { ...data, tenantId: this.tenantId }, include: ITEM_INCLUDE });
  }

  update(id: string, data: Prisma.ItemUncheckedUpdateInput): Promise<ItemDetail> {
    return this.client.item.update({ where: { id, tenantId: this.tenantId }, data, include: ITEM_INCLUDE });
  }

  async delete(id: string): Promise<void> {
    await this.client.item.delete({ where: { id, tenantId: this.tenantId } });
  }

  findTaxCode(id: string) {
    return this.client.taxCode.findFirst({ where: { id, tenantId: this.tenantId }, select: { id: true, kind: true, isActive: true } });
  }

  findTaxCodeByCode(code: string) {
    return this.client.taxCode.findFirst({ where: { code, tenantId: this.tenantId, isActive: true }, select: { id: true, kind: true } });
  }

  registration() {
    return this.client.companyTaxProfile.findUnique({ where: { tenantId: this.tenantId }, select: { registration: true } });
  }
}
