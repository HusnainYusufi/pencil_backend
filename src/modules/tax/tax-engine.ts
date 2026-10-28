import { computeTax, Decimal, type DecimalValue, type TaxBreakdown } from '../../common/helpers/money.js';
import type { TaxCodeKind, TaxTreatment } from '../../generated/prisma/enums.js';

export interface RateRow {
  ratePercent: { toString(): string } | string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

/** The rate in force on `date` (date-only, inclusive bounds), if any. */
export function rateOn<T extends RateRow>(rates: readonly T[], date: Date): T | undefined {
  return rates.find((r) => r.effectiveFrom <= date && (r.effectiveTo === null || date <= r.effectiveTo));
}

/**
 * Tax on one amount at the rate in force on the document date.
 * `inclusive` back-calculates tax from a gross price (B2C shelf prices).
 */
export function taxForAmount(amount: DecimalValue, ratePercent: DecimalValue, currency: string, inclusive = false): TaxBreakdown {
  return computeTax(amount, new Decimal(ratePercent).dividedBy(100), currency, inclusive ? 'inclusive' : 'exclusive');
}

export interface TaxCodeShape {
  kind: TaxCodeKind;
  treatment: TaxTreatment;
  recoverable: boolean;
  taxAccountId: string | null;
  reverseChargeAccountId: string | null;
}

/**
 * Consistency rules for a tax code, as an accountant would review them.
 * Returns field errors (empty = valid). `positiveRate` says whether any rate
 * of the code is above zero (then it needs somewhere to post the tax).
 */
export function taxCodeProblems(code: TaxCodeShape, positiveRate: boolean): Array<{ field: string; errors: string[] }> {
  const problems: Array<{ field: string; errors: string[] }> = [];
  const add = (field: string, error: string) => problems.push({ field, errors: [error] });

  if ((code.kind === 'WITHHOLDING') !== (code.treatment === 'WITHHOLDING')) {
    add('treatment', 'withholding codes use the WITHHOLDING treatment, and only they do');
  }
  if ((code.treatment === 'REVERSE_CHARGE' || code.treatment === 'IMPORT') && code.kind !== 'PURCHASE') {
    add('treatment', 'reverse charge and import treatments apply to purchases only');
  }
  if (code.kind === 'SALES' && !code.recoverable) add('recoverable', 'recoverability applies to purchase codes only');

  // Zero, exempt and out-of-scope codes carry no tax; nothing may be charged on them.
  const taxFree = code.treatment === 'ZERO_RATED' || code.treatment === 'EXEMPT' || code.treatment === 'OUT_OF_SCOPE';
  if (taxFree && positiveRate) add('ratePercent', 'zero-rated, exempt and out-of-scope codes have a 0% rate');

  // Non-recoverable input tax is part of the cost; everything else posts to a tax account.
  const needsTaxAccount = positiveRate && !(code.kind === 'PURCHASE' && !code.recoverable);
  if (needsTaxAccount && !code.taxAccountId) add('taxAccountId', 'choose the account the tax posts to');
  if (code.treatment === 'REVERSE_CHARGE' && !code.reverseChargeAccountId) {
    add('reverseChargeAccountId', 'reverse charge needs the self-assessed output tax account');
  }
  if (code.treatment !== 'REVERSE_CHARGE' && code.reverseChargeAccountId) {
    add('reverseChargeAccountId', 'only reverse-charge codes have a self-assessed output account');
  }
  return problems;
}
