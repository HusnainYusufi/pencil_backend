import type { ClsStore } from 'nestjs-cls';
import type { Prisma } from '../../generated/prisma/client.js';
import type { PlatformAdminRole } from '../../generated/prisma/enums.js';

export interface UserActor {
  readonly type: 'user';
  readonly userId: string;
  readonly sessionId: string;
  /** Null when the user has not selected a tenant yet. */
  readonly tenantId: string | null;
  readonly roleKey: string | null;
  readonly permissions: ReadonlySet<string>;
}

export interface PlatformAdminActor {
  readonly type: 'platform_admin';
  readonly adminId: string;
  readonly sessionId: string;
  readonly role: PlatformAdminRole;
  readonly permissions: ReadonlySet<string>;
}

export interface SystemActor {
  readonly type: 'system';
  readonly name: string;
}

export type Actor = UserActor | PlatformAdminActor | SystemActor;

/**
 * Everything that is request/job-scoped lives here (AsyncLocalStorage via
 * nestjs-cls) instead of being threaded through every call signature.
 */
export interface RequestContextStore extends ClsStore {
  requestId: string;
  ip?: string;
  userAgent?: string;
  actor?: Actor;
  /** Tenant whose data this scope may touch; drives row-level security. */
  tenantId?: string | null;
  /** Platform/system scope that may cross tenants. Use sparingly. */
  bypassRls?: boolean;
  /** Active interactive transaction, joined by repositories automatically. */
  tx?: Prisma.TransactionClient;
}
