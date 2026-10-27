import { Decimal } from 'decimal.js';

/**
 * Money is ALWAYS a Decimal (never a JS number) and is rounded only at
 * well-defined points, half-up, to the currency's minor units. JOD and other
 * dinar currencies have 3 decimals; SAR has 2.
 */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export { D as Decimal };
export type DecimalValue = Decimal.Value;

const MINOR_UNITS: Readonly<Record<string, number>> = {
  SAR: 2,
  JOD: 3,
  USD: 2,
  EUR: 2,
  AED: 2,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  QAR: 2,
  EGP: 2,
};

export function minorUnits(currency: string): number {
  const units = MINOR_UNITS[currency.toUpperCase()];
  if (units === undefined) throw new Error(`Unsupported currency: ${currency}`);
  return units;
}

export function toDecimal(value: DecimalValue): Decimal {
  return new D(value);
}

/** Rounds half-up to the currency's minor units. */
export function roundMoney(value: DecimalValue, currency: string): Decimal {
  return new D(value).toDecimalPlaces(minorUnits(currency), D.ROUND_HALF_UP);
}

export function sumMoney(values: readonly DecimalValue[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(v), new D(0));
}

/** Fixed-scale string for APIs / e-invoice XML, e.g. "10.500" for JOD. */
export function formatAmount(value: DecimalValue, currency: string): string {
  return roundMoney(value, currency).toFixed(minorUnits(currency));
}

/**
 * Splits `total` across `ratios` so the parts always sum exactly to the
 * rounded total (largest-remainder method). Use for discounts/charges spread
 * over invoice lines.
 */
export function allocate(total: DecimalValue, ratios: readonly DecimalValue[], currency: string): Decimal[] {
  if (ratios.length === 0) throw new Error('allocate() needs at least one ratio');
  const scale = minorUnits(currency);
  const unit = new D(10).pow(-scale);
  const rounded = roundMoney(total, currency);
  const ratioSum = sumMoney(ratios);
  if (ratioSum.isZero()) throw new Error('allocate() ratios must not sum to zero');

  const exact = ratios.map((r) => rounded.times(r).dividedBy(ratioSum));
  const parts = exact.map((e) => e.toDecimalPlaces(scale, D.ROUND_DOWN));
  let remainder = rounded.minus(sumMoney(parts));
  const order = exact
    .map((e, i) => ({ i, frac: e.minus(parts[i]!) }))
    .sort((a, b) => b.frac.comparedTo(a.frac));
  for (let k = 0; remainder.greaterThan(0) && k < order.length; k++) {
    const idx = order[k]!.i;
    parts[idx] = parts[idx]!.plus(unit);
    remainder = remainder.minus(unit);
  }
  return parts;
}

export interface TaxBreakdown {
  net: Decimal;
  tax: Decimal;
  gross: Decimal;
}

/**
 * VAT / sales-tax split. `rate` is a fraction (0.15 KSA VAT, 0.16 JO GST).
 * Inclusive amounts are back-calculated; tax is rounded once and net absorbs
 * the rounding so net + tax === gross exactly.
 */
export function computeTax(
  amount: DecimalValue,
  rate: DecimalValue,
  currency: string,
  mode: 'exclusive' | 'inclusive' = 'exclusive',
): TaxBreakdown {
  const r = new D(rate);
  if (r.isNegative()) throw new Error('Tax rate must not be negative');
  if (mode === 'exclusive') {
    const net = roundMoney(amount, currency);
    const tax = roundMoney(net.times(r), currency);
    return { net, tax, gross: net.plus(tax) };
  }
  const gross = roundMoney(amount, currency);
  const tax = roundMoney(gross.times(r).dividedBy(r.plus(1)), currency);
  return { net: gross.minus(tax), tax, gross };
}
