import { ALL_PERMISSIONS, Permission } from './permissions.js';

export interface SystemRoleDefinition {
  key: string;
  name: string;
  description: string;
  permissions: readonly string[];
}

export const OWNER_ROLE_KEY = 'owner';

/**
 * Seeded into every tenant (isSystem = true, immutable). Their effective
 * permissions are always resolved from THIS file, not from the stored
 * snapshot, so adding a permission upgrades every tenant without a data
 * migration. The frontend localises names by `key`.
 */
export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  {
    key: OWNER_ROLE_KEY,
    name: 'Owner',
    description: 'Full access, including billing and ownership transfer.',
    permissions: ['*'],
  },
  {
    key: 'admin',
    name: 'Administrator',
    description: 'Manages company settings, users and all accounting data.',
    permissions: ALL_PERMISSIONS,
  },
  {
    key: 'accountant',
    name: 'Accountant',
    description: 'Day-to-day bookkeeping, invoicing and reporting.',
    permissions: [
      Permission.TENANT_READ,
      'accounts.*',
      'journals.*',
      Permission.PERIODS_MANAGE,
      'contacts.*',
      'items.*',
      Permission.TAXES_READ,
      'invoices.*',
      'bills.*',
      Permission.REPORTS_READ,
    ],
  },
  {
    key: 'viewer',
    name: 'Viewer',
    description: 'Read-only access to accounting data and reports.',
    permissions: ALL_PERMISSIONS.filter((p) => p.endsWith('.read') && p !== Permission.AUDIT_READ),
  },
];

const BY_KEY = new Map(SYSTEM_ROLES.map((r) => [r.key, r]));

export const systemRolePermissions = (key: string): readonly string[] | undefined => BY_KEY.get(key)?.permissions;
