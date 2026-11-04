import { allocate, Decimal, minorUnits, roundMoney, sumMoney } from '../../../common/helpers/money.js';
import { AppException } from '../../../core/errors/app.exception.js';
import { ErrorCode } from '../../../core/errors/error-codes.js';
import type { FieldError } from '../../../core/http/validation.js';
import type { TaxCategory } from '../../../generated/prisma/enums.js';

/** Price and quantity precision (amounts follow the currency). */
export const QUANTITY_SCALE = 6;
export const PRICE_SCALE = 6;

export interface CalcLineInput {
  quantity: string;
  /** Tax inclusive when `pricesIncludeTax`. */
  unitPrice: string;
  /** Line discount amount, on the same basis as the price (inclusive or not). */
  discount?: string;
  tax: {
    /** Tax account the line's tax is posted to. */
    accountId: string;
    category: TaxCategory;
    /** Percentage, e.g. "15". */
    percent: string;
    exemptionCode: string | null;
    exemptionReason: string | null;
  };
}

export interface CalcLine {
  quantity: Decimal;
  /** Tax-exclusive unit price (what e-invoices carry). */
  unitPriceNet: Decimal;
  /** quantity x net price, rounded. */
  grossAmount: Decimal;
  /** Tax-exclusive discount. */
  discount: Decimal;
  netAmount: Decimal;
  taxAmount: Decimal;
  totalAmount: Decimal;
}

/** One tax breakdown: lines sharing category, rate and reason. */
export interface TaxSubtotal {
  category: TaxCategory;
  percent: Decimal;
  exemptionCode: string | null;
  exemptionReason: string | null;
  taxableAmount: Decimal;
  taxAmount: Decimal;
  /** Tax per output account (sums exactly to taxAmount). */
  byAccount: Array<{ accountId: string; amount: Decimal }>;
}

export interface InvoiceCalculation {
  lines: CalcLine[];
  subtotals: TaxSubtotal[];
  subtotal: Decimal;
  discountTotal: Decimal;
  taxableAmount: Decimal;
  taxTotal: Decimal;
  total: Decimal;
}

const fraction = (percent: string | Decimal) => new Decimal(percent).dividedBy(100);

/**
 * Prices a sales document. Tax is computed per breakdown (category + rate)
 * on the summed taxable amount, as e-invoicing rules require; line tax is
 * informational. In tax-inclusive mode the net is back-calculated per line,
 * so the total may differ from the entered gross by a rounding unit.
 */
export function calculateInvoice(lines: readonly CalcLineInput[], currency: string, pricesIncludeTax: boolean): InvoiceCalculation {
  const scale = minorUnits(currency);
  const errors: FieldError[] = [];
  const check = (cond: boolean, field: string, message: string) => {
    if (!cond) errors.push({ field, errors: [message] });
  };

  if (lines.length === 0) errors.push({ field: 'lines', errors: ['add at least one line'] });

  const calculated = lines.map((line, i): CalcLine => {
    const field = `lines[${i}]`;
    const quantity = new Decimal(line.quantity);
    const price = new Decimal(line.unitPrice);
    const discountIn = new Decimal(line.discount || '0');
    check(quantity.greaterThan(0), `${field}.quantity`, 'quantity must be greater than 0');
    check(quantity.decimalPlaces() <= QUANTITY_SCALE, `${field}.quantity`, `quantity allows at most ${QUANTITY_SCALE} decimals`);
    check(!price.isNegative(), `${field}.unitPrice`, 'unitPrice must not be negative');
    check(price.decimalPlaces() <= PRICE_SCALE, `${field}.unitPrice`, `unitPrice allows at most ${PRICE_SCALE} decimals`);
    check(!discountIn.isNegative(), `${field}.discount`, 'discount must not be negative');
    check(discountIn.decimalPlaces() <= scale, `${field}.discount`, `discount allows at most ${scale} decimals for ${currency}`);

    const rate = fraction(line.tax.percent);
    if (!pricesIncludeTax) {
      const grossAmount = roundMoney(quantity.times(price), currency);
      check(discountIn.lte(grossAmount), `${field}.discount`, 'discount cannot exceed the line amount');
      const netAmount = grossAmount.minus(discountIn);
      const taxAmount = roundMoney(netAmount.times(rate), currency);
      return { quantity, unitPriceNet: price, grossAmount, discount: discountIn, netAmount, taxAmount, totalAmount: netAmount.plus(taxAmount) };
    }

    const unitPriceNet = price.dividedBy(rate.plus(1)).toDecimalPlaces(PRICE_SCALE, Decimal.ROUND_HALF_UP);
    const grossInclusive = roundMoney(quantity.times(price), currency);
    check(discountIn.lte(grossInclusive), `${field}.discount`, 'discount cannot exceed the line amount');
    const netInclusive = grossInclusive.minus(discountIn);
    const netAmount = roundMoney(netInclusive.dividedBy(rate.plus(1)), currency);
    const grossAmount = Decimal.max(roundMoney(quantity.times(unitPriceNet), currency), netAmount);
    return {
      quantity,
      unitPriceNet,
      grossAmount,
      discount: grossAmount.minus(netAmount),
      netAmount,
      taxAmount: netInclusive.minus(netAmount),
      totalAmount: netInclusive,
    };
  });

  // Breakdowns: one per (category, rate); a breakdown carries one exemption reason.
  const groups = new Map<string, { input: CalcLineInput['tax']; lines: Array<{ net: Decimal; accountId: string }> }>();
  lines.forEach((line, i) => {
    const key = `${line.tax.category}|${new Decimal(line.tax.percent).toFixed(4)}`;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { input: line.tax, lines: [{ net: calculated[i]!.netAmount, accountId: line.tax.accountId }] });
      return;
    }
    if ((group.input.exemptionCode ?? null) !== (line.tax.exemptionCode ?? null)) {
      errors.push({ field: `lines[${i}].taxRateId`, errors: ['lines with the same tax category and rate must share one exemption reason'] });
    }
    group.lines.push({ net: calculated[i]!.netAmount, accountId: line.tax.accountId });
  });

  if (errors.length > 0) throw new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', errors);

  const subtotals: TaxSubtotal[] = [...groups.values()].map(({ input, lines: members }) => {
    const taxableAmount = sumMoney(members.map((m) => m.net));
    const taxAmount = roundMoney(taxableAmount.times(fraction(input.percent)), currency);
    const netByAccount = new Map<string, Decimal>();
    for (const m of members) netByAccount.set(m.accountId, (netByAccount.get(m.accountId) ?? new Decimal(0)).plus(m.net));
    const accounts = [...netByAccount.entries()];
    const ratios = accounts.map(([, net]) => net);
    const parts = taxAmount.isZero() || sumMoney(ratios).isZero()
      ? accounts.map(() => new Decimal(0))
      : allocate(taxAmount, ratios, currency);
    return {
      category: input.category,
      percent: new Decimal(input.percent),
      exemptionCode: input.exemptionCode,
      exemptionReason: input.exemptionReason,
      taxableAmount,
      taxAmount,
      byAccount: accounts.map(([accountId], k) => ({ accountId, amount: parts[k]! })),
    };
  });

  const subtotal = sumMoney(calculated.map((l) => l.grossAmount));
  const discountTotal = sumMoney(calculated.map((l) => l.discount));
  const taxableAmount = sumMoney(calculated.map((l) => l.netAmount));
  const taxTotal = sumMoney(subtotals.map((s) => s.taxAmount));
  return { lines: calculated, subtotals, subtotal, discountTotal, taxableAmount, taxTotal, total: taxableAmount.plus(taxTotal) };
}
