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
  /**
   * Year-end close / reopen, lock dates and the opening balance date.
   * Kept away from day-to-day bookkeepers (segregation of duties).
   */
  BOOKS_CLOSE: 'books.close',
  CONTACTS_READ: 'contacts.read',
  CONTACTS_MANAGE: 'contacts.manage',
  ITEMS_READ: 'items.read',
  ITEMS_MANAGE: 'items.manage',
  TAXES_READ: 'taxes.read',
  /** Tax codes and the company tax profile: compliance settings (owners / admins). */
  TAXES_MANAGE: 'taxes.manage',
  INVOICES_READ: 'invoices.read',
  INVOICES_MANAGE: 'invoices.manage',
  INVOICES_ISSUE: 'invoices.issue',
  BILLS_READ: 'bills.read',
  BILLS_MANAGE: 'bills.manage',
  REPORTS_READ: 'reports.read',
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
