import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../core/context/request-context.service.js';
import { Db } from '../../core/database/db.service.js';
import { AppException } from '../../core/errors/app.exception.js';
import { ErrorCode } from '../../core/errors/error-codes.js';
import { AccessCache } from '../../core/security/access-cache.js';
import type { PlatformAdminRole, SubscriptionStatus, TenantStatus } from '../../generated/prisma/client.js';
import { PLATFORM_ROLE_PERMISSIONS } from '../access/platform-permissions.js';
import { systemRolePermissions } from '../access/system-roles.js';
import { UserSessionsRepository } from '../identity/user-sessions.repository.js';
import { MembershipsRepository } from '../tenancy/repositories/memberships.repository.js';
import { PlatformAdminsRepository } from './platform/platform-admins.repository.js';
import type { PlatformAccessClaims, TenantAccessClaims } from './token.service.js';

export interface UserAccess {
  userId: string;
  sessionId: string;
  tenantId: string | null;
  roleKey: string | null;
  permissions: ReadonlySet<string>;
  tenantStatus: TenantStatus | null;
  /** False when the subscription lapsed: the tenant becomes read-only. */
  subscriptionWritable: boolean;
}

export interface PlatformAccess {
  adminId: string;
  sessionId: string;
  role: PlatformAdminRole;
  permissions: ReadonlySet<string>;
}

const NO_PERMISSIONS: ReadonlySet<string> = new Set();

export function isSubscriptionWritable(
  subscription: { status: SubscriptionStatus; trialEndsAt: Date | null } | null,
  now: Date = new Date(),
): boolean {
  if (!subscription) return false;
  switch (subscription.status) {
    case 'TRIALING':
      return subscription.trialEndsAt === null || subscription.trialEndsAt > now;
    case 'ACTIVE':
    case 'PAST_DUE': // grace period: dunning is handled by billing
      return true;
    default:
      return false;
  }
}

/**
 * Turns verified token claims into a full access context (session validity,
 * membership, effective permissions, tenant & subscription state), cached
 * briefly in AccessCache.
 */
@Injectable()
export class AccessContextService {
  constructor(
    private readonly db: Db,
    private readonly ctx: RequestContext,
    private readonly cache: AccessCache,
    private readonly sessions: UserSessionsRepository,
    private readonly memberships: MembershipsRepository,
    private readonly platformAdmins: PlatformAdminsRepository,
  ) {}

  async resolveUser(claims: TenantAccessClaims): Promise<UserAccess> {
    const key = AccessCache.userKey(claims.sid, claims.sub, claims.tid);
    const cached = this.cache.get<UserAccess>(key);
    if (cached) return cached;

    const now = new Date();
    const session = await this.sessions.findById(claims.sid);
    if (!session || session.userId !== claims.sub || session.revokedAt || session.expiresAt <= now) {
      throw new AppException(ErrorCode.SESSION_REVOKED, 'Session is no longer valid; please sign in again');
    }
    if (session.user.status !== 'ACTIVE') {
      throw new AppException(ErrorCode.ACCOUNT_DISABLED, 'This account is disabled');
    }

    let access: UserAccess = {
      userId: claims.sub,
      sessionId: claims.sid,
      tenantId: null,
      roleKey: null,
      permissions: NO_PERMISSIONS,
      tenantStatus: null,
      subscriptionWritable: false,
    };

    if (claims.tid) {
      const tenantId = claims.tid;
      const membership = await this.withTenantScope(tenantId, () =>
        this.memberships.findAccess(tenantId, claims.sub),
      );
      if (!membership || membership.status !== 'ACTIVE') {
        throw new AppException(ErrorCode.TENANT_ACCESS_DENIED, 'You are not a member of this company');
      }
      const permissions = membership.role.isSystem
        ? (systemRolePermissions(membership.role.key) ?? membership.role.permissions)
        : membership.role.permissions;
      access = {
        ...access,
        tenantId,
        roleKey: membership.role.key,
        permissions: new Set(permissions),
        tenantStatus: membership.tenant.status,
        subscriptionWritable: isSubscriptionWritable(membership.tenant.subscription, now),
      };
    }

    this.cache.set(key, access);
    return access;
  }

  async resolvePlatformAdmin(claims: PlatformAccessClaims): Promise<PlatformAccess> {
    const key = AccessCache.platformKey(claims.sid, claims.sub);
    const cached = this.cache.get<PlatformAccess>(key);
    if (cached) return cached;

    const session = await this.platformAdmins.findSession(claims.sid);
    if (!session || session.adminId !== claims.sub || session.revokedAt || session.expiresAt <= new Date()) {
      throw new AppException(ErrorCode.SESSION_REVOKED, 'Session is no longer valid; please sign in again');
    }
    if (!session.admin.isActive) {
      throw new AppException(ErrorCode.ACCOUNT_DISABLED, 'This account is disabled');
    }

    const access: PlatformAccess = {
      adminId: claims.sub,
      sessionId: claims.sid,
      role: session.admin.role,
      permissions: new Set(PLATFORM_ROLE_PERMISSIONS[session.admin.role]),
    };
    this.cache.set(key, access);
    return access;
  }

  /** Membership lookup includes the RLS-protected role, so it needs the tenant scope. */
  private withTenantScope<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return this.ctx.tenantId === tenantId && !this.db.inTransaction ? fn() : this.db.withTenant(tenantId, fn);
  }
}
