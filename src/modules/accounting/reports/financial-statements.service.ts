import { Injectable } from '@nestjs/common';
import { addMonths, formatDateOnly, parseDateOnly } from '../../../common/helpers/date.js';
import { Decimal, formatAmount, sumMoney } from '../../../common/helpers/money.js';
import { AppException } from '../../../core/errors/app.exception.js';
import { ErrorCode } from '../../../core/errors/error-codes.js';
import type { Account, AccountSubtype } from '../../../generated/prisma/client.js';
import { AccountingContext } from '../accounting-context.service.js';
import { isProfitAndLoss, SystemAccount } from '../chart-of-accounts/system-accounts.js';
import { fiscalYearContaining } from '../fiscal/fiscal-calendar.js';
import { AccountsRepository } from '../repositories/accounts.repository.js';
import { FiscalRepository } from '../repositories/fiscal.repository.js';
import { LedgerRepository, type AccountTotalsRow, type DimensionFilter } from '../repositories/ledger.repository.js';

const ZERO = new Decimal(0);

export interface StatementLine {
  accountId: string;
  code: string;
  name: string;
  nameAr: string | null;
  amount: string;
  /** Comparison period (income statement with `compare`). */
  previous?: string;
}

export interface StatementSection {
  key: string;
  lines: StatementLine[];
  total: string;
  previousTotal?: string;
}

/** Income-statement layout: sections by account subtype, sign = natural (revenue +, expense +). */
const PL_SECTIONS: Array<{ key: string; subtypes: AccountSubtype[]; sign: 1 | -1 }> = [
  { key: 'revenue', subtypes: ['OPERATING_REVENUE'], sign: -1 },
  { key: 'costOfSales', subtypes: ['COST_OF_SALES'], sign: 1 },
  { key: 'operatingExpenses', subtypes: ['OPERATING_EXPENSE'], sign: 1 },
  { key: 'otherIncome', subtypes: ['OTHER_REVENUE'], sign: -1 },
  { key: 'otherExpenses', subtypes: ['OTHER_EXPENSE'], sign: 1 },
];

const BS_SECTIONS: Array<{ key: string; subtypes: AccountSubtype[]; sign: 1 | -1 }> = [
  { key: 'currentAssets', subtypes: ['CASH', 'BANK', 'ACCOUNTS_RECEIVABLE', 'INVENTORY', 'TAX_RECEIVABLE', 'OTHER_CURRENT_ASSET'], sign: 1 },
  { key: 'nonCurrentAssets', subtypes: ['FIXED_ASSET', 'ACCUMULATED_DEPRECIATION', 'OTHER_NON_CURRENT_ASSET'], sign: 1 },
  { key: 'currentLiabilities', subtypes: ['ACCOUNTS_PAYABLE', 'TAX_PAYABLE', 'OTHER_CURRENT_LIABILITY'], sign: -1 },
  { key: 'nonCurrentLiabilities', subtypes: ['NON_CURRENT_LIABILITY'], sign: -1 },
  { key: 'equity', subtypes: ['EQUITY', 'RETAINED_EARNINGS'], sign: -1 },
];

/**
 * Financial statements straight from the ledger (no closing entries needed):
 *  - income statement for any date range, optionally against the same
 *    range a year earlier;
 *  - balance sheet at a date, with prior years' profit in retained earnings
 *    and the current fiscal year's profit as its own equity line.
 */
@Injectable()
export class FinancialStatementsService {
  constructor(
    private readonly accounting: AccountingContext,
    private readonly accounts: AccountsRepository,
    private readonly fiscal: FiscalRepository,
    private readonly ledger: LedgerRepository,
  ) {}

  async incomeStatement(query: { from?: string; to?: string; compare?: boolean } & DimensionFilter) {
    const { baseCurrency: currency } = await this.accounting.profile();
    const to = query.to ? parseDateOnly(query.to) : await this.accounting.today();
    const from = query.from ? parseDateOnly(query.from) : await this.fiscalYearStart(to);
    if (from > to) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', [{ field: 'from', errors: ['from must be on or before to'] }]);
    }
    const dims = { branchId: query.branchId, costCenterId: query.costCenterId };
    const accounts = (await this.accounts.list({ includeInactive: true })).filter((a) => !a.isGroup && isProfitAndLoss(a.type));
    const movement = (rows: AccountTotalsRow[]) => new Map(rows.map((r) => [r.accountId, r.periodDebit.minus(r.periodCredit)]));
    const current = movement(await this.ledger.accountTotals({ fiscalYearStart: from, from, to, ...dims }));
    const previousRange = query.compare ? { from: addMonths(from, -12), to: addMonths(to, -12) } : null;
    const previous = previousRange
      ? movement(await this.ledger.accountTotals({ fiscalYearStart: previousRange.from, from: previousRange.from, to: previousRange.to, ...dims }))
      : null;

    const sections = PL_SECTIONS.map((section) => this.section(section, accounts, current, previous, currency));
    const total = (key: string, map: 'total' | 'previousTotal') => new Decimal(sections.find((s) => s.key === key)![map] ?? '0');
    const figures = (map: 'total' | 'previousTotal') => {
      const grossProfit = total('revenue', map).minus(total('costOfSales', map));
      const operatingProfit = grossProfit.minus(total('operatingExpenses', map));
      const netProfit = operatingProfit.plus(total('otherIncome', map)).minus(total('otherExpenses', map));
      return {
        grossProfit: formatAmount(grossProfit, currency),
        operatingProfit: formatAmount(operatingProfit, currency),
        netProfit: formatAmount(netProfit, currency),
      };
    };

    return {
      from: formatDateOnly(from),
      to: formatDateOnly(to),
      currency,
      sections,
      ...figures('total'),
      ...(previousRange && {
        previous: { from: formatDateOnly(previousRange.from), to: formatDateOnly(previousRange.to), ...figures('previousTotal') },
      }),
    };
  }

  async balanceSheet(query: { asOf?: string } & DimensionFilter) {
    const { baseCurrency: currency } = await this.accounting.profile();
    const asOf = query.asOf ? parseDateOnly(query.asOf) : await this.accounting.today();
    const fyStart = await this.fiscalYearStart(asOf);
    const accounts = (await this.accounts.list({ includeInactive: true })).filter((a) => !a.isGroup);
    const totals = await this.ledger.accountTotals({
      fiscalYearStart: fyStart,
      from: fyStart,
      to: asOf,
      branchId: query.branchId,
      costCenterId: query.costCenterId,
    });
    const byId = new Map(totals.map((t) => [t.accountId, t]));
    const all = (t: AccountTotalsRow | undefined) => (t ? t.beforeYear.plus(t.yearToFrom).plus(t.periodDebit).minus(t.periodCredit) : ZERO);
    const thisYear = (t: AccountTotalsRow | undefined) => (t ? t.yearToFrom.plus(t.periodDebit).minus(t.periodCredit) : ZERO);

    const pl = accounts.filter((a) => isProfitAndLoss(a.type));
    const priorYearsProfit = sumMoney(pl.map((a) => byId.get(a.id)?.beforeYear ?? ZERO)); // debit - credit
    const currentYearProfit = sumMoney(pl.map((a) => thisYear(byId.get(a.id)))).negated(); // credit-positive

    const balances = new Map<string, Decimal>();
    for (const account of accounts.filter((a) => !isProfitAndLoss(a.type))) {
      let net = all(byId.get(account.id));
      if (account.systemKey === SystemAccount.RETAINED_EARNINGS) net = net.plus(priorYearsProfit);
      balances.set(account.id, net);
    }

    const sections = BS_SECTIONS.map((section) => this.section(section, accounts, balances, null, currency));
    const equity = sections.find((s) => s.key === 'equity')!;
    equity.lines.push({
      accountId: 'current-year-profit',
      code: '',
      name: 'Current year profit',
      nameAr: 'أرباح السنة الحالية',
      amount: formatAmount(currentYearProfit, currency),
    });
    equity.total = formatAmount(new Decimal(equity.total).plus(currentYearProfit), currency);

    const sum = (keys: string[]) => sumMoney(sections.filter((s) => keys.includes(s.key)).map((s) => s.total));
    const totalAssets = sum(['currentAssets', 'nonCurrentAssets']);
    const totalLiabilities = sum(['currentLiabilities', 'nonCurrentLiabilities']);
    const totalEquity = new Decimal(equity.total);
    return {
      asOf: formatDateOnly(asOf),
      currency,
      sections,
      totalAssets: formatAmount(totalAssets, currency),
      totalLiabilities: formatAmount(totalLiabilities, currency),
      totalEquity: formatAmount(totalEquity, currency),
      totalLiabilitiesAndEquity: formatAmount(totalLiabilities.plus(totalEquity), currency),
      balanced: totalAssets.equals(totalLiabilities.plus(totalEquity)),
    };
  }

  /** Rows of one section: accounts with a balance (or comparison), in code order. */
  private section(
    def: { key: string; subtypes: AccountSubtype[]; sign: 1 | -1 },
    accounts: Account[],
    current: Map<string, Decimal>,
    previous: Map<string, Decimal> | null,
    currency: string,
  ): StatementSection {
    const members = accounts.filter((a) => def.subtypes.includes(a.subtype));
    const value = (map: Map<string, Decimal> | null, id: string) => (map?.get(id) ?? ZERO).times(def.sign);
    const lines = members
      .filter((a) => !value(current, a.id).isZero() || (previous && !value(previous, a.id).isZero()))
      .map((a) => ({
        accountId: a.id,
        code: a.code,
        name: a.name,
        nameAr: a.nameAr,
        amount: formatAmount(value(current, a.id), currency),
        ...(previous && { previous: formatAmount(value(previous, a.id), currency) }),
      }));
    return {
      key: def.key,
      lines,
      total: formatAmount(sumMoney(members.map((a) => value(current, a.id))), currency),
      ...(previous && { previousTotal: formatAmount(sumMoney(members.map((a) => value(previous, a.id))), currency) }),
    };
  }

  private async fiscalYearStart(date: Date): Promise<Date> {
    const year = await this.fiscal.findYearForDate(date);
    if (year) return year.startDate;
    const { fiscalYearStartMonth } = await this.accounting.profile();
    return fiscalYearContaining(date, fiscalYearStartMonth).start;
  }
}
