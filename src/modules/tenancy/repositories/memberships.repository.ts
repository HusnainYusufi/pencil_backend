import { Injectable } from '@nestjs/common';
import { buildPage, toSkipTake, type Page, type PageQuery } from '../../../common/helpers/pagination.js';
import { BaseRepository } from '../../../core/database/base.repository.js';
import type { Membership, MembershipStatus, Prisma } from '../../../generated/prisma/client.js';

const ACCESS_VIEW = {
  role: { select: { id: true, key: true, isSystem: true, permissions: true } },
  tenant: {
    select: {
      id: true,
      status: true,
      subscription: { select: { status: true, trialEndsAt: true, currentPeriodEnd: true } },
    },
  },
} satisfies Prisma.MembershipInclude;

export type MembershipAccessView = Prisma.MembershipGetPayload<{ include: typeof ACCESS_VIEW }>;

const USER_TENANTS_VIEW = {
  role: { select: { key: true, name: true } },
  tenant: {
    select: { id: true, slug: true, legalName: true, tradeName: true, country: true, baseCurrency: true, status: true },
  },
} satisfies Prisma.MembershipInclude;

export type UserTenantView = Prisma.MembershipGetPayload<{ include: typeof USER_TENANTS_VIEW }>;

const MEMBER_VIEW = {
  user: { select: { id: true, email: true, fullName: true, status: true, lastLoginAt: true } },
  role: { select: { id: true, key: true, name: true } },
} satisfies Prisma.MembershipInclude;

export type MemberView = Prisma.MembershipGetPayload<{ include: typeof MEMBER_VIEW }>;

/**
 * Memberships bridge global users and tenants, so the table is not RLS
 * scoped (login must list a user's tenants). Every tenant-facing query
 * filters by tenantId explicitly; included roles are still RLS-protected.
 */
@Injectable()
export class MembershipsRepository extends BaseRepository {
  /** Requires the tenant's scope (role is RLS-protected). */
  findAccess(tenantId: string, userId: string): Promise<MembershipAccessView | null> {
    return this.client.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      include: ACCESS_VIEW,
    });
  }

  /** Spans tenants: call under system scope, for the user's own memberships only. */
  listForUser(userId: string): Promise<UserTenantView[]> {
    return this.client.membership.findMany({
      where: { userId, status: 'ACTIVE', tenant: { status: { not: 'ARCHIVED' } } },
      include: USER_TENANTS_VIEW,
      orderBy: { createdAt: 'asc' },
    });
  }

  findMember(tenantId: string, membershipId: string): Promise<MemberView | null> {
    return this.client.membership.findFirst({ where: { id: membershipId, tenantId }, include: MEMBER_VIEW });
  }

  async listForTenant(tenantId: string, query: PageQuery & { search?: string }): Promise<Page<MemberView>> {
    const search = query.search?.trim();
    const where: Prisma.MembershipWhereInput = {
      tenantId,
      ...(search && {
        user: {
          OR: [
            { email: { contains: search.toLowerCase() } },
            { fullName: { contains: search, mode: 'insensitive' } },
          ],
        },
      }),
    };
    const [items, total] = await Promise.all([
      this.client.membership.findMany({ where, include: MEMBER_VIEW, orderBy: { createdAt: 'asc' }, ...toSkipTake(query) }),
      this.client.membership.count({ where }),
    ]);
    return buildPage(items, total, query);
  }

  create(data: { tenantId: string; userId: string; roleId: string; status?: MembershipStatus }): Promise<Membership> {
    return this.client.membership.create({ data });
  }

  updateRole(tenantId: string, membershipId: string, roleId: string): Promise<MemberView> {
    return this.client.membership.update({
      where: { id: membershipId, tenantId },
      data: { roleId },
      include: MEMBER_VIEW,
    });
  }

  countActive(tenantId: string): Promise<number> {
    return this.client.membership.count({ where: { tenantId, status: 'ACTIVE' } });
  }

  countByRole(tenantId: string, roleId: string): Promise<number> {
    return this.client.membership.count({ where: { tenantId, roleId } });
  }
}
