import { formatDateOnly, parseDateOnly } from '../../common/helpers/date.js';
import { Decimal } from '../../common/helpers/money.js';
import { AppException } from '../../core/errors/app.exception.js';
import { Permission } from '../access/permissions.js';
import { systemRolePermissions } from '../access/system-roles.js';
import { CONTROL_ACCOUNTS, SUBTYPE_TYPE, SystemAccount } from './chart-of-accounts/system-accounts.js';
import { chartOfAccountsTemplate, templateLevels, typeOfTemplate } from './chart-of-accounts/templates.js';
import { fiscalYearContaining, fiscalYearName, monthlyPeriods, nextFiscalYear } from './fiscal/fiscal-calendar.js';
import { buildClosingEntry, mirrorLines } from './fiscal/year-end.js';
import { normalizeJournalLines } from './journals/journal-rules.js';
import { formatJournalNumber } from './journals/posting.service.js';

const fmt = formatDateOnly;

describe.each(['SA', 'JO'] as const)('chart of accounts template (%s)', (country) => {
  const template = chartOfAccountsTemplate(country);
  const byCode = new Map(template.map((t) => [t.code, t]));

  it('has unique codes and Arabic names', () => {
    expect(byCode.size).toBe(template.length);
    expect(template.every((t) => t.nameAr.length > 0)).toBe(true);
  });

  it('only nests under existing groups of the same type', () => {
    for (const t of template.filter((x) => x.parent)) {
      const parent = byCode.get(t.parent!);
      expect(parent, t.code).toBeDefined();
      expect(parent!.isGroup, t.code).toBe(true);
      expect(typeOfTemplate(parent!), t.code).toBe(typeOfTemplate(t));
    }
  });

  it('maps every system role to exactly one postable account', () => {
    for (const key of Object.values(SystemAccount)) {
      const matches = template.filter((t) => t.systemKey === key);
      expect(matches, key).toHaveLength(1);
      expect(matches[0]!.isGroup ?? false, key).toBe(false);
    }
  });

  it('orders levels parents-first', () => {
    const seen = new Set<string>();
    for (const level of templateLevels(template)) {
      for (const t of level) {
        if (t.parent) expect(seen.has(t.parent), t.code).toBe(true);
      }
      level.forEach((t) => seen.add(t.code));
    }
    expect(seen.size).toBe(template.length);
  });

  it('every subtype maps to a type', () => {
    for (const t of template) expect(SUBTYPE_TYPE[t.subtype]).toBeDefined();
  });
});

describe('country specifics', () => {
  it('names tax accounts per jurisdiction', () => {
    const sa = chartOfAccountsTemplate('SA').find((t) => t.systemKey === SystemAccount.VAT_OUTPUT)!;
    const jo = chartOfAccountsTemplate('JO').find((t) => t.systemKey === SystemAccount.VAT_OUTPUT)!;
    expect(sa.nameAr).toContain('ضريبة القيمة المضافة');
    expect(jo.nameAr).toContain('ضريبة المبيعات');
  });
});

describe('fiscal calendar', () => {
  it('derives calendar and non-calendar fiscal years', () => {
    const calendar = fiscalYearContaining(parseDateOnly('2026-10-27'), 1);
    expect([fmt(calendar.start), fmt(calendar.end)]).toEqual(['2026-01-01', '2026-12-31']);
    expect(fiscalYearName(calendar)).toBe('FY 2026');

    const april = fiscalYearContaining(parseDateOnly('2026-02-10'), 4);
    expect([fmt(april.start), fmt(april.end)]).toEqual(['2025-04-01', '2026-03-31']);
    expect(fiscalYearName(april)).toBe('FY 2025/26');
  });

  it('splits a year into 12 contiguous monthly periods (leap-year aware)', () => {
    const periods = monthlyPeriods(fiscalYearContaining(parseDateOnly('2028-06-01'), 1));
    expect(periods).toHaveLength(12);
    expect(fmt(periods[1]!.end)).toBe('2028-02-29');
    for (let i = 1; i < periods.length; i++) {
      expect(periods[i]!.start.getTime() - periods[i - 1]!.end.getTime()).toBe(86_400_000);
    }
  });

  it('computes the following year', () => {
    const next = nextFiscalYear(fiscalYearContaining(parseDateOnly('2026-05-01'), 7));
    expect([fmt(next.start), fmt(next.end)]).toEqual(['2026-07-01', '2027-06-30']);
  });

  it('rejects impossible dates', () => {
    expect(() => parseDateOnly('2026-02-30')).toThrow();
    expect(() => parseDateOnly('26-1-1')).toThrow();
  });
});

describe('double-entry rules', () => {
  const A = '00000000-0000-7000-8000-000000000001';
  const B = '00000000-0000-7000-8000-000000000002';

  const codeOf = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      return (error as AppException).code;
    }
    return 'OK';
  };

  it('accepts a balanced entry and totals it', () => {
    const result = normalizeJournalLines(
      [
        { accountId: A, debit: '100.50' },
        { accountId: B, credit: '100.5' },
      ],
      'SAR',
    );
    expect(result.total.toFixed(2)).toBe('100.50');
    expect(result.lines.map((l) => l.lineNo)).toEqual([1, 2]);
  });

  it('rejects unbalanced entries with the difference', () => {
    try {
      normalizeJournalLines([{ accountId: A, debit: '100' }, { accountId: B, credit: '99.99' }], 'SAR');
      expect.unreachable();
    } catch (error) {
      expect((error as AppException).code).toBe('UNBALANCED_ENTRY');
      expect((error as AppException).details).toMatchObject({ difference: '0.01' });
    }
  });

  it('requires exactly one side per line and at least two lines', () => {
    expect(codeOf(() => normalizeJournalLines([{ accountId: A, debit: '5', credit: '5' }, { accountId: B }], 'SAR'))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => normalizeJournalLines([{ accountId: A, debit: '5' }], 'SAR'))).toBe('VALIDATION_FAILED');
  });

  it('enforces currency precision without silent rounding', () => {
    expect(codeOf(() => normalizeJournalLines([{ accountId: A, debit: '1.005' }, { accountId: B, credit: '1.005' }], 'SAR'))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => normalizeJournalLines([{ accountId: A, debit: '1.005' }, { accountId: B, credit: '1.005' }], 'JOD'))).toBe('OK');
  });

  it('formats gapless journal numbers', () => {
    expect(formatJournalNumber(2026, 42)).toBe('JV-2026-000042');
  });
});

describe('year-end closing entry', () => {
  const RE = 'retained-earnings';
  const bal = (accountId: string, net: string, branchId: string | null = null) => ({
    accountId,
    branchId,
    costCenterId: null,
    net: new Decimal(net),
  });
  const sum = (lines: Array<{ debit: Decimal; credit: Decimal }>, side: 'debit' | 'credit') =>
    lines.reduce((total, l) => total.plus(l[side]), new Decimal(0)).toFixed(2);

  it('zeroes revenue and expenses into retained earnings', () => {
    // Sales Cr 1,000 (net -1000), Rent Dr 400 (net +400): profit 600.
    const plan = buildClosingEntry([bal('sales', '-1000'), bal('rent', '400')], RE, 'close');
    expect(plan.profit.toFixed(2)).toBe('600.00');
    const byAccount = Object.fromEntries(plan.lines.map((l) => [l.accountId, `${l.debit.toFixed(2)}/${l.credit.toFixed(2)}`]));
    expect(byAccount).toEqual({ sales: '1000.00/0.00', rent: '0.00/400.00', [RE]: '0.00/600.00' });
    expect(sum(plan.lines, 'debit')).toBe(sum(plan.lines, 'credit'));
    expect(plan.total.toFixed(2)).toBe('1000.00');
  });

  it('debits retained earnings for a loss', () => {
    const plan = buildClosingEntry([bal('sales', '-100'), bal('rent', '250')], RE, 'close');
    expect(plan.profit.toFixed(2)).toBe('-150.00');
    const re = plan.lines.find((l) => l.accountId === RE)!;
    expect([re.debit.toFixed(2), re.credit.toFixed(2)]).toEqual(['150.00', '0.00']);
  });

  it('keeps the result per branch so branch equity stays right', () => {
    const plan = buildClosingEntry([bal('sales', '-500', 'riyadh'), bal('sales', '-300', 'jeddah'), bal('rent', '100', 'jeddah')], RE, 'close');
    const reLines = plan.lines.filter((l) => l.accountId === RE).map((l) => `${l.branchId}:${l.credit.toFixed(2)}`);
    expect(reLines.sort()).toEqual(['jeddah:200.00', 'riyadh:500.00']);
    expect(sum(plan.lines, 'debit')).toBe(sum(plan.lines, 'credit'));
  });

  it('produces no lines when nothing was booked, and mirrors lines for a reopen', () => {
    expect(buildClosingEntry([], RE, 'close').lines).toHaveLength(0);
    const plan = buildClosingEntry([bal('sales', '-75.125')], RE, 'close');
    const mirrored = mirrorLines(plan.lines);
    expect(mirrored.map((l) => [l.debit.toFixed(3), l.credit.toFixed(3)])).toEqual(plan.lines.map((l) => [l.credit.toFixed(3), l.debit.toFixed(3)]));
  });
});

describe('control accounts and new categories', () => {
  it.each(['SA', 'JO'] as const)('marks receivables, payables and VAT as control accounts (%s)', (country) => {
    const keys = chartOfAccountsTemplate(country).filter((t) => t.systemKey && CONTROL_ACCOUNTS.has(t.systemKey)).map((t) => t.systemKey);
    expect(keys.sort()).toEqual(['accounts_payable', 'accounts_receivable', 'vat_input', 'vat_output']);
  });

  it('presents zakat / income tax and finance costs separately', () => {
    expect(SUBTYPE_TYPE.ZAKAT_AND_INCOME_TAX).toBe('EXPENSE');
    expect(SUBTYPE_TYPE.FINANCE_COST).toBe('EXPENSE');
    expect(SUBTYPE_TYPE.CURRENT_BORROWINGS).toBe('LIABILITY');
    expect(SUBTYPE_TYPE.ALLOWANCE_FOR_CREDIT_LOSSES).toBe('ASSET');
    expect(chartOfAccountsTemplate('SA').find((t) => t.code === '5303')?.subtype).toBe('ZAKAT_AND_INCOME_TAX');
  });

  it('adds Jordanian practice accounts only for Jordan', () => {
    const jo = new Set(chartOfAccountsTemplate('JO').map((t) => t.code));
    const sa = new Set(chartOfAccountsTemplate('SA').map((t) => t.code));
    for (const code of ['1110', '2114', '2203']) {
      expect(jo.has(code)).toBe(true);
      expect(sa.has(code)).toBe(false);
    }
  });
});

describe('segregation of duties', () => {
  const permissionsOf = (key: string) => systemRolePermissions(key) ?? [];

  it('lets owners and admins close the books, but not bookkeepers', () => {
    expect(permissionsOf('owner')).toContain('*');
    expect(permissionsOf('admin')).toContain(Permission.BOOKS_CLOSE);
    expect(permissionsOf('accountant')).not.toContain(Permission.BOOKS_CLOSE);
    expect(permissionsOf('accountant')).not.toContain('books.*');
    expect(permissionsOf('viewer')).not.toContain(Permission.BOOKS_CLOSE);
  });
});
