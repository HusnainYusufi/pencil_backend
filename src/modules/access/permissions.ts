/**
 * Tenant permission catalog: `<resource>.<action>`. Add new permissions here
 * as modules ship; system roles pick them up automatically (see
 * system-roles.ts). Never rename a shipped permission: custom roles store it.
 */
export const Permission = {
  TENANT_READ: 'tenant.read',
  TENANT_MANAGE: 'tenant.manage',
  MEMBERS_READ: 'members.read',
  MEMBERS_MANAGE: 'members.manage',
  ROLES_READ: 'roles.read',
  ROLES_MANAGE: 'roles.manage',
  AUDIT_READ: 'audit.read',

  // Accounting core (reserved for upcoming modules; listed so roles can be designed now).
  ACCOUNTS_READ: 'accounts.read',
  ACCOUNTS_MANAGE: 'accounts.manage',
  JOURNALS_READ: 'journals.read',
  JOURNALS_POST: 'journals.post',
  /** Close / reopen fiscal periods and create fiscal years. */
  PERIODS_MANAGE: 'periods.manage',
  CONTACTS_READ: 'contacts.read',
  CONTACTS_MANAGE: 'contacts.manage',
  INVOICES_READ: 'invoices.read',
  INVOICES_MANAGE: 'invoices.manage',
  INVOICES_ISSUE: 'invoices.issue',
  BILLS_READ: 'bills.read',
  BILLS_MANAGE: 'bills.manage',
  REPORTS_READ: 'reports.read',
  /** Payments received from customers (allocated to invoices). */
  PAYMENTS_READ: 'payments.read',
  PAYMENTS_MANAGE: 'payments.manage',
  /** Tax rates of the company. */
  TAXES_MANAGE: 'taxes.manage',
  /** Onboard / manage government e-invoicing devices (ZATCA, JoFotara). */
  EINVOICING_MANAGE: 'einvoicing.manage',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(Permission);

const RESOURCES = new Set(ALL_PERMISSIONS.map((p) => p.split('.')[0]));

/**
 * What a custom role may contain: catalog permissions or `<resource>.*`.
 * The global `*` is reserved for the system owner role.
 */
export function isGrantablePermission(value: string): boolean {
  if ((ALL_PERMISSIONS as readonly string[]).includes(value)) return true;
  const match = /^([a-z_]+)\.\*$/.exec(value);
  return match !== null && RESOURCES.has(match[1]);
}
