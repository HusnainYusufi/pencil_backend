import { allocate, computeTax, formatAmount, minorUnits, roundMoney, sumMoney } from './money.js';

describe('money helpers', () => {
  it('knows currency minor units (JOD has 3 decimals)', () => {
    expect(minorUnits('SAR')).toBe(2);
    expect(minorUnits('jod')).toBe(3);
    expect(() => minorUnits('XXX')).toThrow(/Unsupported currency/);
  });

  it('rounds half-up to the currency scale', () => {
    expect(roundMoney('1.005', 'SAR').toFixed(2)).toBe('1.01');
    expect(roundMoney('1.0005', 'JOD').toFixed(3)).toBe('1.001');
    expect(formatAmount('10.5', 'JOD')).toBe('10.500');
  });

  it('avoids binary floating point errors', () => {
    expect(sumMoney(['0.1', '0.2']).toString()).toBe('0.3');
  });

  it('allocates without losing or creating a fils/halala', () => {
    const parts = allocate('100.00', [1, 1, 1], 'SAR');
    expect(parts.map((p) => p.toFixed(2))).toEqual(['33.34', '33.33', '33.33']);
    expect(sumMoney(parts).toFixed(2)).toBe('100.00');

    const jod = allocate('10.000', [3, 7], 'JOD');
    expect(sumMoney(jod).toFixed(3)).toBe('10.000');
  });

  it('computes exclusive and inclusive VAT exactly', () => {
    const exclusive = computeTax('100', '0.15', 'SAR');
    expect([exclusive.net, exclusive.tax, exclusive.gross].map((d) => d.toFixed(2))).toEqual(['100.00', '15.00', '115.00']);

    const inclusive = computeTax('115', '0.15', 'SAR', 'inclusive');
    expect([inclusive.net, inclusive.tax, inclusive.gross].map((d) => d.toFixed(2))).toEqual(['100.00', '15.00', '115.00']);

    const jo = computeTax('9.999', '0.16', 'JOD', 'inclusive');
    expect(jo.net.plus(jo.tax).equals(jo.gross)).toBe(true);
  });
});
