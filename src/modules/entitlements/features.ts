import type { FeatureType } from '../../generated/prisma/enums.js';

/**
 * Feature (entitlement) keys checked in code. Plans grant them; platform
 * staff can override per tenant from pencil_admin. Rows in the `features`
 * table are seeded from FEATURE_DEFINITIONS.
 */
export const Feature = {
  USERS_MAX: 'users.max',
  BRANCHES_MAX: 'branches.max',
  ROLES_CUSTOM: 'roles.custom',
  AUDIT_LOG: 'audit.log',
  /** ZATCA (KSA) or JoFotara (JO) clearance, chosen by the tenant's country. */
  EINVOICING: 'einvoicing',
  INVENTORY: 'inventory',
  MULTI_CURRENCY: 'multi_currency',
  API_ACCESS: 'api.access',
} as const;

export type FeatureKey = (typeof Feature)[keyof typeof Feature];

export const FEATURE_DEFINITIONS: ReadonlyArray<{
  key: FeatureKey;
  name: string;
  description: string;
  type: FeatureType;
}> = [
  { key: Feature.USERS_MAX, name: 'Users', description: 'Maximum active members per company', type: 'LIMIT' },
  { key: Feature.BRANCHES_MAX, name: 'Branches', description: 'Maximum branches per company', type: 'LIMIT' },
  { key: Feature.ROLES_CUSTOM, name: 'Custom roles', description: 'Create roles with tailored permissions', type: 'BOOLEAN' },
  { key: Feature.AUDIT_LOG, name: 'Audit log', description: 'Searchable audit trail of all changes', type: 'BOOLEAN' },
  { key: Feature.EINVOICING, name: 'E-invoicing', description: 'ZATCA Fatoora / JoFotara clearance & reporting', type: 'BOOLEAN' },
  { key: Feature.INVENTORY, name: 'Inventory', description: 'Stock items, warehouses and valuation', type: 'BOOLEAN' },
  { key: Feature.MULTI_CURRENCY, name: 'Multi-currency', description: 'Foreign-currency transactions and revaluation', type: 'BOOLEAN' },
  { key: Feature.API_ACCESS, name: 'API access', description: 'Public API and webhooks', type: 'BOOLEAN' },
];
