import { AppException } from '../../../core/errors/app.exception.js';
import { calculateInvoice, type CalcLineInput } from './invoice-calc.js';

const VAT15: CalcLineInput['tax'] = { accountId: 'vat', category: 'STANDARD', percent: '15', exemptionCode: null, exemptionReason: null };
const ZERO_EDU: CalcLineInput['tax'] = { accountId: 'vat', category: 'ZERO_RATED', percent: '0', exemptionCode: 'VATEX-SA-EDU', exemptionReason: 'Private education to citizen' };
const line = (quantity: string, unitPrice: string, tax = VAT15, discount?: string): CalcLineInput => ({ quantity, unitPrice, discount, tax });

describe('calculateInvoice', () => {
  it('prices tax-exclusive lines and taxes the breakdown, not each line', () => {
    const calc = calculateInvoice([line('3', '33.33'), line('1', '0.05')], 'SAR', false);
    expect(calc.lines.map((l) => l.netAmount.toFixed(2))).toEqual(['99.99', '0.05']);
    // Per line: 15.00 + 0.01 = 15.01; per breakdown: 100.04 x 15% = 15.006 -> 15.01.
    expect(calc.subtotals).toHaveLength(1);
    expect(calc.taxTotal.toFixed(2)).toBe('15.01');
    expect(calc.total.toFixed(2)).toBe('115.05');
  });

  it('applies line discounts before tax', () => {
    const calc = calculateInvoice([line('2', '50', VAT15, '10')], 'SAR', false);
    expect(calc.subtotal.toFixed(2)).toBe('100.00');
    expect(calc.discountTotal.toFixed(2)).toBe('10.00');
    expect(calc.taxableAmount.toFixed(2)).toBe('90.00');
    expect(calc.taxTotal.toFixed(2)).toBe('13.50');
    expect(calc.total.toFixed(2)).toBe('103.50');
  });

  it('back-calculates net from tax-inclusive prices', () => {
    const calc = calculateInvoice([line('1', '115')], 'SAR', true);
    expect(calc.lines[0]!.netAmount.toFixed(2)).toBe('100.00');
    expect(calc.lines[0]!.unitPriceNet.toFixed()).toBe('100');
    expect(calc.taxTotal.toFixed(2)).toBe('15.00');
    expect(calc.total.toFixed(2)).toBe('115.00');
  });

  it('keeps one breakdown per category and rate, with exemption reasons', () => {
    const calc = calculateInvoice([line('1', '1000', ZERO_EDU), line('1', '200')], 'SAR', false);
    expect(calc.subtotals.map((s) => [s.category, s.taxableAmount.toFixed(2), s.taxAmount.toFixed(2), s.exemptionCode])).toEqual([
      ['ZERO_RATED', '1000.00', '0.00', 'VATEX-SA-EDU'],
      ['STANDARD', '200.00', '30.00', null],
    ]);
    expect(calc.total.toFixed(2)).toBe('1230.00');
  });

  it('uses three decimals for JOD', () => {
    const calc = calculateInvoice([line('1', '10.555', { ...VAT15, percent: '16' })], 'JOD', false);
    expect(calc.taxTotal.toFixed(3)).toBe('1.689');
    expect(calc.total.toFixed(3)).toBe('12.244');
  });

  it('splits a breakdown across tax accounts penny-exactly', () => {
    const calc = calculateInvoice(
      [line('1', '0.10', { ...VAT15, accountId: 'a' }), line('1', '0.10', { ...VAT15, accountId: 'b' })],
      'SAR',
      false,
    );
    const parts = calc.subtotals[0]!.byAccount.map((p) => p.amount.toFixed(2));
    expect(calc.taxTotal.toFixed(2)).toBe('0.03');
    expect(parts.sort()).toEqual(['0.01', '0.02']);
  });

  it('rejects bad quantities, discounts above the line and mixed exemption reasons', () => {
    const errorsOf = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return ((error as AppException).getResponse() as { details: Array<{ field: string }> }).details.map((d) => d.field);
      }
      return [];
    };
    expect(errorsOf(() => calculateInvoice([line('0', '10')], 'SAR', false))).toContain('lines[0].quantity');
    expect(errorsOf(() => calculateInvoice([line('1', '10', VAT15, '11')], 'SAR', false))).toContain('lines[0].discount');
    expect(
      errorsOf(() => calculateInvoice([line('1', '10', ZERO_EDU), line('1', '10', { ...ZERO_EDU, exemptionCode: 'VATEX-SA-32' })], 'SAR', false)),
    ).toContain('lines[1].taxRateId');
  });
});
