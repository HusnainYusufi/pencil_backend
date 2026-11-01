import type { FeatureModule, FeatureStatus, FeatureType } from '../../generated/prisma/enums.js';

/**
 * The product feature catalog. Every capability a plan can sell is listed
 * here, grouped by module (accounting core first). Each one is toggleable per
 * plan and per company (override) from pencil_admin.
 *
 * Keys are permanent ("module.feature"); rows in `features` are synced from
 * this list by the catalog seed. `status` says whether the module is shipped:
 * plans may include COMING_SOON features (roadmap), the tenant app hides them.
 */
export const Feature = {
  // Accounting core
  CHART_OF_ACCOUNTS: 'accounting.chart_of_accounts',
  JOURNALS: 'accounting.journals',
  FISCAL_PERIODS: 'accounting.fiscal_periods',
  COST_CENTERS: 'accounting.cost_centers',
  MULTI_CURRENCY: 'accounting.multi_currency',
  RECURRING_ENTRIES: 'accounting.recurring_entries',
  BUDGETS: 'accounting.budgets',
  FIXED_ASSETS: 'accounting.fixed_assets',
  // Reports
  LEDGER_REPORTS: 'reports.ledger',
  FINANCIAL_STATEMENTS: 'reports.financial_statements',
  CUSTOM_REPORTS: 'reports.custom',
  // Sales
  SALES_INVOICES: 'sales.invoices',
  QUOTATIONS: 'sales.quotes',
  RECURRING_INVOICES: 'sales.recurring',
  // Purchases
  BILLS: 'purchases.bills',
  EXPENSES: 'purchases.expenses',
  PURCHASE_ORDERS: 'purchases.orders',
  // Banking
  BANK_ACCOUNTS: 'banking.accounts',
  BANK_RECONCILIATION: 'banking.reconciliation',
  BANK_FEEDS: 'banking.feeds',
  // Tax
  VAT_RETURNS: 'tax.vat_returns',
  EINVOICING: 'tax.einvoicing',
  // Inventory
  INVENTORY: 'inventory.items',
  WAREHOUSES: 'inventory.warehouses',
  // Platform & limits
  USERS_LIMIT: 'limits.users',
  BRANCHES_LIMIT: 'limits.branches',
  CUSTOM_ROLES: 'platform.custom_roles',
  AUDIT_LOG: 'platform.audit_log',
  API_ACCESS: 'platform.api_access',
} as const;

export type FeatureKey = (typeof Feature)[keyof typeof Feature];

/** Default composition of the seeded plans: `true` = included, number/null = limit (null = unlimited). */
type PlanDefaults = Partial<Record<'starter' | 'professional' | 'business', true | number | null>>;

export interface FeatureDefinition {
  key: FeatureKey;
  name: string;
  description: string;
  type: FeatureType;
  module: FeatureModule;
  status: FeatureStatus;
  /** Grants applied to existing plans when the feature is first introduced. */
  plans: PlanDefaults;
}

const ALL: PlanDefaults = { starter: true, professional: true, business: true };
const PRO_UP: PlanDefaults = { professional: true, business: true };
const BUSINESS: PlanDefaults = { business: true };

const DEFINITIONS: Array<Omit<FeatureDefinition, 'type'> & { type?: FeatureType }> = [
  // ── Accounting core ──────────────────────────────────────────────────
  { key: Feature.CHART_OF_ACCOUNTS, module: 'ACCOUNTING', status: 'AVAILABLE', plans: ALL, name: 'Chart of accounts', description: 'Country templates (KSA / Jordan), account tree and system accounts' },
  { key: Feature.JOURNALS, module: 'ACCOUNTING', status: 'AVAILABLE', plans: ALL, name: 'Journal entries', description: 'Manual and opening-balance journals: draft, post, reverse' },
  { key: Feature.FISCAL_PERIODS, module: 'ACCOUNTING', status: 'AVAILABLE', plans: ALL, name: 'Fiscal periods & close', description: 'Fiscal years, monthly periods, period close and reopen' },
  { key: Feature.COST_CENTERS, module: 'ACCOUNTING', status: 'AVAILABLE', plans: PRO_UP, name: 'Cost centers', description: 'Analyse postings and reports by cost center' },
  { key: Feature.MULTI_CURRENCY, module: 'ACCOUNTING', status: 'COMING_SOON', plans: PRO_UP, name: 'Multi-currency', description: 'Foreign-currency transactions, rates and revaluation' },
  { key: Feature.RECURRING_ENTRIES, module: 'ACCOUNTING', status: 'COMING_SOON', plans: PRO_UP, name: 'Recurring entries', description: 'Scheduled journals for accruals, depreciation and payroll' },
  { key: Feature.BUDGETS, module: 'ACCOUNTING', status: 'COMING_SOON', plans: BUSINESS, name: 'Budgets', description: 'Budgets per account with variance reporting' },
  { key: Feature.FIXED_ASSETS, module: 'ACCOUNTING', status: 'COMING_SOON', plans: BUSINESS, name: 'Fixed assets', description: 'Asset register, depreciation schedules, disposals' },
  // ── Reports ──────────────────────────────────────────────────────────
  { key: Feature.LEDGER_REPORTS, module: 'REPORTS', status: 'AVAILABLE', plans: ALL, name: 'Trial balance & statements', description: 'Trial balance and account statements from the ledger' },
  { key: Feature.FINANCIAL_STATEMENTS, module: 'REPORTS', status: 'COMING_SOON', plans: ALL, name: 'Financial statements', description: 'Income statement, balance sheet and cash flow' },
  { key: Feature.CUSTOM_REPORTS, module: 'REPORTS', status: 'COMING_SOON', plans: BUSINESS, name: 'Custom reports', description: 'Saved, configurable report templates' },
  // ── Sales ────────────────────────────────────────────────────────────
  { key: Feature.SALES_INVOICES, module: 'SALES', status: 'COMING_SOON', plans: ALL, name: 'Sales invoices', description: 'Tax and simplified invoices, credit and debit notes, receipts' },
  { key: Feature.QUOTATIONS, module: 'SALES', status: 'COMING_SOON', plans: PRO_UP, name: 'Quotations', description: 'Quotes that convert into invoices' },
  { key: Feature.RECURRING_INVOICES, module: 'SALES', status: 'COMING_SOON', plans: PRO_UP, name: 'Recurring invoices', description: 'Subscription and contract billing on a schedule' },
  // ── Purchases ────────────────────────────────────────────────────────
  { key: Feature.BILLS, module: 'PURCHASES', status: 'COMING_SOON', plans: ALL, name: 'Supplier bills', description: 'Bills, debit notes and supplier payments' },
  { key: Feature.EXPENSES, module: 'PURCHASES', status: 'COMING_SOON', plans: ALL, name: 'Expenses', description: 'Expenses with receipt capture' },
  { key: Feature.PURCHASE_ORDERS, module: 'PURCHASES', status: 'COMING_SOON', plans: BUSINESS, name: 'Purchase orders', description: 'Orders, goods receipts and landed cost' },
  // ── Banking ──────────────────────────────────────────────────────────
  { key: Feature.BANK_ACCOUNTS, module: 'BANKING', status: 'COMING_SOON', plans: ALL, name: 'Bank & cash', description: 'Bank and cash accounts, transfers and cheques' },
  { key: Feature.BANK_RECONCILIATION, module: 'BANKING', status: 'COMING_SOON', plans: PRO_UP, name: 'Bank reconciliation', description: 'Statement import and matching' },
  { key: Feature.BANK_FEEDS, module: 'BANKING', status: 'COMING_SOON', plans: BUSINESS, name: 'Live bank feeds', description: 'Automatic transactions via open banking' },
  // ── Tax ──────────────────────────────────────────────────────────────
  { key: Feature.VAT_RETURNS, module: 'TAX', status: 'COMING_SOON', plans: ALL, name: 'VAT / sales-tax returns', description: 'ZATCA VAT and Jordan GST return preparation' },
  { key: Feature.EINVOICING, module: 'TAX', status: 'COMING_SOON', plans: ALL, name: 'E-invoicing', description: 'ZATCA Fatoora (Phase 2) and JoFotara clearance' },
  // ── Inventory ────────────────────────────────────────────────────────
  { key: Feature.INVENTORY, module: 'INVENTORY', status: 'COMING_SOON', plans: PRO_UP, name: 'Products & stock', description: 'Items, stock levels and weighted-average costing' },
  { key: Feature.WAREHOUSES, module: 'INVENTORY', status: 'COMING_SOON', plans: BUSINESS, name: 'Multiple warehouses', description: 'Warehouses, transfers and stock counts' },
  // ── Platform & limits ────────────────────────────────────────────────
  { key: Feature.USERS_LIMIT, module: 'PLATFORM', status: 'AVAILABLE', type: 'LIMIT', plans: { starter: 3, professional: 10, business: null }, name: 'Users', description: 'Maximum active members per company' },
  { key: Feature.BRANCHES_LIMIT, module: 'PLATFORM', status: 'AVAILABLE', type: 'LIMIT', plans: { starter: 1, professional: 3, business: null }, name: 'Branches', description: 'Maximum active branches per company' },
  { key: Feature.CUSTOM_ROLES, module: 'PLATFORM', status: 'AVAILABLE', plans: PRO_UP, name: 'Custom roles', description: 'Roles with tailored permissions' },
  { key: Feature.AUDIT_LOG, module: 'PLATFORM', status: 'AVAILABLE', plans: PRO_UP, name: 'Audit log', description: 'Searchable trail of every change' },
  { key: Feature.API_ACCESS, module: 'PLATFORM', status: 'COMING_SOON', plans: BUSINESS, name: 'API & webhooks', description: 'Public API and webhooks' },
];

/** Catalog in display order (module order, then the order above). */
export const FEATURE_DEFINITIONS: ReadonlyArray<FeatureDefinition & { sortOrder: number }> = DEFINITIONS.map((d, i) => ({
  ...d,
  type: d.type ?? 'BOOLEAN',
  sortOrder: (i + 1) * 10,
}));
