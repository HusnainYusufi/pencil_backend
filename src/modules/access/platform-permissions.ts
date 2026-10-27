import type { PlatformAdminRole } from '../../generated/prisma/enums.js';

/** Permissions of Pencil staff using pencil_admin. */
export const PlatformPermission = {
  TENANTS_READ: 'platform.tenants.read',
  TENANTS_MANAGE: 'platform.tenants.manage',
  SUBSCRIPTIONS_MANAGE: 'platform.subscriptions.manage',
  CATALOG_READ: 'platform.catalog.read',
  CATALOG_MANAGE: 'platform.catalog.manage',
  AUDIT_READ: 'platform.audit.read',
} as const;

export type PlatformPermission = (typeof PlatformPermission)[keyof typeof PlatformPermission];

export const PLATFORM_ROLE_PERMISSIONS: Readonly<Record<PlatformAdminRole, readonly string[]>> = {
  SUPER_ADMIN: ['*'],
  OPERATIONS: [
    PlatformPermission.TENANTS_READ,
    PlatformPermission.TENANTS_MANAGE,
    PlatformPermission.CATALOG_READ,
    PlatformPermission.AUDIT_READ,
  ],
  SUPPORT: [PlatformPermission.TENANTS_READ, PlatformPermission.CATALOG_READ, PlatformPermission.AUDIT_READ],
  BILLING: [
    PlatformPermission.TENANTS_READ,
    PlatformPermission.SUBSCRIPTIONS_MANAGE,
    PlatformPermission.CATALOG_READ,
    PlatformPermission.CATALOG_MANAGE,
  ],
};
