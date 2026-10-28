import { parseDateOnly } from '../../common/helpers/date.js';
import { buyerReadiness } from '../contacts/contacts.service.js';
import { rateOn, taxCodeProblems, taxForAmount } from './tax-engine.js';
import { taxCodeTemplate } from './tax-templates.js';

const date = parseDateOnly;

describe('tax engine', () => {
  const rates = [
    { ratePercent: '5', effectiveFrom: date('2018-01-01'), effectiveTo: date('2020-06-30') },
    { ratePercent: '15', effectiveFrom: date('2020-07-01'), effectiveTo: null },
  ];

  it('uses the rate in force on the document date', () => {
    expect(rateOn(rates, date('2020-06-30'))?.ratePercent).toBe('5');
    expect(rateOn(rates, date('2020-07-01'))?.ratePercent).toBe('15');
    expect(rateOn(rates, date('2017-12-31'))).toBeUndefined();
  });

  it('computes exclusive and inclusive tax exactly (SAR 2dp, JOD 3dp)', () => {
    const ex = taxForAmount('100', '15', 'SAR');
    expect([ex.net.toFixed(2), ex.tax.toFixed(2), ex.gross.toFixed(2)]).toEqual(['100.00', '15.00', '115.00']);
    const inc = taxForAmount('115', '15', 'SAR', true);
    expect([inc.net.toFixed(2), inc.tax.toFixed(2)]).toEqual(['100.00', '15.00']);
    const jo = taxForAmount('10.125', '16', 'JOD');
    expect([jo.tax.toFixed(3), jo.gross.toFixed(3)]).toEqual(['1.620', '11.745']);
  });

  it('rejects inconsistent tax codes', () => {
    const base = { kind: 'SALES' as const, treatment: 'STANDARD' as const, recoverable: true, taxAccountId: 'vat-out', reverseChargeAccountId: null };
    expect(taxCodeProblems(base, true)).toEqual([]);
    expect(taxCodeProblems({ ...base, taxAccountId: null }, true).map((p) => p.field)).toEqual(['taxAccountId']);
    expect(taxCodeProblems({ ...base, treatment: 'ZERO_RATED' }, true).map((p) => p.field)).toEqual(['ratePercent']);
    expect(taxCodeProblems({ ...base, treatment: 'REVERSE_CHARGE' }, true).map((p) => p.field)).toContain('treatment');
    expect(taxCodeProblems({ ...base, kind: 'WITHHOLDING' }, true).map((p) => p.field)).toContain('treatment');
    // Non-recoverable input tax is part of the cost: no tax account needed.
    expect(taxCodeProblems({ ...base, kind: 'PURCHASE', recoverable: false, taxAccountId: null }, true)).toEqual([]);
    expect(
      taxCodeProblems({ ...base, kind: 'PURCHASE', treatment: 'REVERSE_CHARGE', reverseChargeAccountId: null }, true).map((p) => p.field),
    ).toEqual(['reverseChargeAccountId']);
  });
});

describe.each(['SA', 'JO'] as const)('tax code template (%s)', (country) => {
  const template = taxCodeTemplate(country);

  it('has unique codes, Arabic names and consistent definitions', () => {
    expect(new Set(template.map((t) => t.code)).size).toBe(template.length);
    for (const t of template) {
      expect(t.nameAr.length).toBeGreaterThan(0);
      const positive = t.rates.some((r) => Number(r.percent) > 0);
      const problems = taxCodeProblems(
        {
          kind: t.kind,
          treatment: t.treatment,
          recoverable: t.recoverable ?? true,
          taxAccountId: t.taxAccount ?? null,
          reverseChargeAccountId: t.reverseChargeAccount ?? null,
        },
        positive,
      );
      expect({ code: t.code, problems }).toEqual({ code: t.code, problems: [] });
    }
  });

  it('never has overlapping rate periods', () => {
    for (const t of template) {
      const sorted = [...t.rates].sort((a, b) => a.from.localeCompare(b.from));
      sorted.slice(1).forEach((rate, i) => expect(sorted[i]!.to! < rate.from).toBe(true));
      expect(sorted.filter((r) => !r.to)).toHaveLength(1);
    }
  });
});

describe('country tax rules', () => {
  it('KSA: 15% from July 2020, ZATCA reason codes on zero-rated and exempt sales', () => {
    const sa = taxCodeTemplate('SA');
    const standard = sa.find((t) => t.code === 'S')!;
    expect(standard.rates).toEqual([
      { percent: '5', from: '2018-01-01', to: '2020-06-30' },
      { percent: '15', from: '2020-07-01' },
    ]);
    for (const t of sa.filter((c) => c.kind === 'SALES' && (c.treatment === 'ZERO_RATED' || c.treatment === 'EXEMPT'))) {
      expect(t.reasonCode).toMatch(/^VATEX-SA-/);
    }
    expect(sa.find((t) => t.code === 'P-RC')).toMatchObject({ treatment: 'REVERSE_CHARGE', returnBox: '9' });
  });

  it("Jordan: JoFotara letters are the reverse of ZATCA's (Z exempt, O zero-rated)", () => {
    const jo = taxCodeTemplate('JO');
    expect(jo.find((t) => t.code === 'EX')).toMatchObject({ treatment: 'EXEMPT', einvoiceCategory: 'Z' });
    expect(jo.find((t) => t.code === 'Z0')).toMatchObject({ treatment: 'ZERO_RATED', einvoiceCategory: 'O' });
    expect(jo.find((t) => t.code === 'S')?.rates[0]?.percent).toBe('16');
  });
});

describe('buyer e-invoice readiness', () => {
  const contact = {
    type: 'BUSINESS' as const,
    country: 'SA',
    taxNumber: '310000000000003',
    idNumber: null,
    street: null,
    buildingNumber: null,
    postalCode: null,
    district: null,
    city: null,
    isCustomer: true,
  };

  it('KSA business buyers need a full National Address for a standard tax invoice', () => {
    expect(buyerReadiness(contact, 'SA')).toEqual({
      ready: false,
      invoiceType: 'STANDARD',
      missing: ['street', 'city', 'buildingNumber', 'postalCode', 'district'],
    });
    const complete = { ...contact, street: 'King Fahd Rd', city: 'Riyadh', buildingNumber: '1234', postalCode: '12345', district: 'Olaya' };
    expect(buyerReadiness(complete, 'SA').ready).toBe(true);
  });

  it('KSA individuals get simplified invoices; Jordanian buyers need an ID', () => {
    expect(buyerReadiness({ ...contact, type: 'INDIVIDUAL', taxNumber: null }, 'SA')).toMatchObject({ ready: true, invoiceType: 'SIMPLIFIED' });
    expect(buyerReadiness({ ...contact, taxNumber: null, country: 'JO' }, 'JO').missing).toEqual(['taxNumberOrId']);
  });
});
