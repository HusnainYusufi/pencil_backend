import { Injectable } from '@nestjs/common';
import { buildPage, toSkipTake, type Page, type PageQuery } from '../../../common/helpers/pagination.js';
import { BaseRepository } from '../../../core/database/base.repository.js';
import type { CountryCode, Prisma, Tenant, TenantStatus } from '../../../generated/prisma/client.js';

const TENANT_ADMIN_VIEW = {
  subscription: { include: { plan: { select: { id: true, code: true, name: true } } } },
  _count: { select: { memberships: true } },
} satisfies Prisma.TenantInclude;

export type TenantAdminView = Prisma.TenantGetPayload<{ include: typeof TENANT_ADMIN_VIEW }>;

export interface TenantListFilter extends PageQuery {
  search?: string;
  status?: TenantStatus;
  country?: CountryCode;
}

/** `tenants` is the tenancy root (global table, not RLS-scoped). */
@Injectable()
export class TenantsRepository extends BaseRepository {
  findById(id: string): Promise<Tenant | null> {
    return this.client.tenant.findUnique({ where: { id } });
  }

  findAdminView(id: string): Promise<TenantAdminView | null> {
    return this.client.tenant.findUnique({ where: { id }, include: TENANT_ADMIN_VIEW });
  }

  create(data: Prisma.TenantCreateInput): Promise<Tenant> {
    return this.client.tenant.create({ data });
  }

  update(id: string, data: Prisma.TenantUpdateInput): Promise<Tenant> {
    return this.client.tenant.update({ where: { id }, data });
  }

  async list(filter: TenantListFilter): Promise<Page<TenantAdminView>> {
    const search = filter.search?.trim();
    const where: Prisma.TenantWhereInput = {
      ...(filter.status && { status: filter.status }),
      ...(filter.country && { country: filter.country }),
      ...(search && {
        OR: [
          { legalName: { contains: search, mode: 'insensitive' } },
          { tradeName: { contains: search, mode: 'insensitive' } },
          { slug: { contains: search.toLowerCase() } },
          { taxNumber: { startsWith: search } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      this.client.tenant.findMany({
        where,
        include: TENANT_ADMIN_VIEW,
        orderBy: { id: 'desc' },
        ...toSkipTake(filter),
      }),
      this.client.tenant.count({ where }),
    ]);
    return buildPage(items, total, filter);
  }
}
