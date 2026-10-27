import type { AccountSubtype, AccountType } from '../../../generated/prisma/enums.js';

/**
 * Stable roles that posting rules target (an invoice credits `sales` and
 * `vat_output`, debits `accounts_receivable`, ...). Users may rename or
 * renumber these accounts, but never delete them or change their type.
 */
export const SystemAccount = {
  CASH: 'cash',
  BANK: 'bank',
  ACCOUNTS_RECEIVABLE: 'accounts_receivable',
  INVENTORY: 'inventory',
  VAT_INPUT: 'vat_input',
  ACCUMULATED_DEPRECIATION: 'accumulated_depreciation',
  ACCOUNTS_PAYABLE: 'accounts_payable',
  VAT_OUTPUT: 'vat_output',
  VAT_SETTLEMENT: 'vat_settlement',
  UNEARNED_REVENUE: 'unearned_revenue',
  CUSTOMER_ADVANCES: 'customer_advances',
  RETAINED_EARNINGS: 'retained_earnings',
  OPENING_BALANCE_EQUITY: 'opening_balance_equity',
  SALES: 'sales',
  SERVICE_REVENUE: 'service_revenue',
  SALES_RETURNS: 'sales_returns',
  FX_GAIN: 'fx_gain',
  COGS: 'cogs',
  DEPRECIATION_EXPENSE: 'depreciation_expense',
  BANK_CHARGES: 'bank_charges',
  FX_LOSS: 'fx_loss',
  ROUNDING: 'rounding',
} as const;

export type SystemAccountKey = (typeof SystemAccount)[keyof typeof SystemAccount];

/** Which account type each subtype belongs to (subtype must agree with type). */
export const SUBTYPE_TYPE: Readonly<Record<AccountSubtype, AccountType>> = {
  CASH: 'ASSET',
  BANK: 'ASSET',
  ACCOUNTS_RECEIVABLE: 'ASSET',
  INVENTORY: 'ASSET',
  TAX_RECEIVABLE: 'ASSET',
  OTHER_CURRENT_ASSET: 'ASSET',
  FIXED_ASSET: 'ASSET',
  ACCUMULATED_DEPRECIATION: 'ASSET',
  OTHER_NON_CURRENT_ASSET: 'ASSET',
  ACCOUNTS_PAYABLE: 'LIABILITY',
  TAX_PAYABLE: 'LIABILITY',
  OTHER_CURRENT_LIABILITY: 'LIABILITY',
  NON_CURRENT_LIABILITY: 'LIABILITY',
  EQUITY: 'EQUITY',
  RETAINED_EARNINGS: 'EQUITY',
  OPERATING_REVENUE: 'REVENUE',
  OTHER_REVENUE: 'REVENUE',
  COST_OF_SALES: 'EXPENSE',
  OPERATING_EXPENSE: 'EXPENSE',
  OTHER_EXPENSE: 'EXPENSE',
};

/** Debit-normal types increase with debits; the rest with credits. */
export const isDebitNormal = (type: AccountType): boolean => type === 'ASSET' || type === 'EXPENSE';

/** Income-statement accounts reset each fiscal year (rolled into retained earnings). */
export const isProfitAndLoss = (type: AccountType): boolean => type === 'REVENUE' || type === 'EXPENSE';
