import { Injectable } from '@nestjs/common';
import { formatDateOnly, parseDateOnly } from '../../common/helpers/date.js';
import { Decimal, formatAmount, minorUnits, sumMoney } from '../../common/helpers/money.js';
import { TenantScopedRepository } from '../../core/database/base.repository.js';
import { AppException } from '../../core/errors/app.exception.js';
import { ErrorCode } from '../../core/errors/error-codes.js';
import type { TaxCategory } from '../../generated/prisma/enums.js';
import { AccountingContext } from '../accounting/accounting-context.service.js';

/** One tax breakdown of one document, signed (credit notes negative). */
interface BreakdownRow {
  side: 'SALES' | 'PURCHASES';
  isAdjustment: boolean;
  category: TaxCategory;
  percent: string;
  exemptionCode: string | null;
  net: string;
  tax: string;
}

/**
 * Tax per document breakdown (category + rate + reason), computed the way
 * the documents themselves do: tax = round(sum of line nets x rate), then
 * signed by document type. Only issued (sales) / posted (purchases)
 * documents; voided ones drop out.
 */
@Injectable()
export class VatReturnRepository extends TenantScopedRepository {
  breakdowns(from: Date, to: Date, scale: number): Promise<BreakdownRow[]> {
    const tenantId = this.tenantId;
    const f = formatDateOnly(from);
    const t = formatDateOnly(to);
    return this.inScope((client) =>
      client.$queryRaw<BreakdownRow[]>`
        WITH groups AS (
          SELECT 'SALES' AS side, d.type::text AS doc_type, l.tax_category AS category, l.tax_percent AS percent,
                 l.exemption_code, d.id AS doc_id, SUM(l.net_amount) AS net
          FROM sales_invoices d JOIN sales_invoice_lines l ON l.invoice_id = d.id
          WHERE d.tenant_id = ${tenantId}::uuid AND d.status = 'ISSUED' AND d.issue_date BETWEEN ${f}::date AND ${t}::date
          GROUP BY d.id, d.type, l.tax_category, l.tax_percent, l.exemption_code
          UNION ALL
          SELECT 'PURCHASES', d.type::text, l.tax_category, l.tax_percent, l.exemption_code, d.id, SUM(l.net_amount)
          FROM purchase_bills d JOIN purchase_bill_lines l ON l.bill_id = d.id
          WHERE d.tenant_id = ${tenantId}::uuid AND d.status = 'POSTED' AND d.bill_date BETWEEN ${f}::date AND ${t}::date
          GROUP BY d.id, d.type, l.tax_category, l.tax_percent, l.exemption_code
        )
        SELECT side,
               (doc_type = 'CREDIT_NOTE') AS "isAdjustment",
               category,
               percent::text AS percent,
               exemption_code AS "exemptionCode",
               SUM(CASE WHEN doc_type = 'CREDIT_NOTE' THEN -net ELSE net END)::text AS net,
               SUM(CASE WHEN doc_type = 'CREDIT_NOTE' THEN -1 ELSE 1 END * ROUND(net * percent / 100, ${scale}::int))::text AS tax
        FROM groups
        GROUP BY side, (doc_type = 'CREDIT_NOTE'), category, percent, exemption_code`,
    );
  }
}

interface Box {
  box: string;
  key: string;
  amount: string;
  adjustment: string;
  vat: string;
}

const EDU_HEA = new Set(['VATEX-SA-EDU', 'VATEX-SA-HEA']);
const isExport = (code: string | null) => !!code && (code === 'VATEX-SA-32' || code === 'VATEX-SA-33' || code.startsWith('VATEX-SA-34'));

/**
 * VAT / sales-tax return for a period. KSA follows ZATCA's return form
 * (boxes 1-16); other countries get output and input tax by rate. Figures
 * come from documents (sales and purchases), not from journals, as the
 * authority expects; imports and prior-period corrections are entered on the
 * portal (boxes 8, 9 and 14 are left at zero).
 */
@Injectable()
export class VatReturnService {
  constructor(
    private readonly accounting: AccountingContext,
    private readonly repository: VatReturnRepository,
  ) {}

  async vatReturn(query: { from: string; to: string }) {
    const profile = await this.accounting.profile();
    const currency = profile.baseCurrency;
    const scale = minorUnits(currency);
    const from = parseDateOnly(query.from);
    const to = parseDateOnly(query.to);
    if (from > to) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', [{ field: 'from', errors: ['from must be on or before to'] }]);
    }
    const rows = await this.repository.breakdowns(from, to, scale);
    const fmt = (d: Decimal) => formatAmount(d, currency);
    const pick = (predicate: (r: BreakdownRow) => boolean) => {
      const match = rows.filter(predicate);
      const base = match.filter((r) => !r.isAdjustment);
      const adj = match.filter((r) => r.isAdjustment);
      return {
        amount: sumMoney(base.map((r) => r.net)),
        adjustment: sumMoney(adj.map((r) => r.net)),
        vat: sumMoney(match.map((r) => r.tax)),
      };
    };
    const box = (n: string, key: string, v: { amount: Decimal; adjustment: Decimal; vat: Decimal }): Box => ({
      box: n,
      key,
      amount: fmt(v.amount),
      adjustment: fmt(v.adjustment),
      vat: fmt(v.vat),
    });
    const zero = { amount: new Decimal(0), adjustment: new Decimal(0), vat: new Decimal(0) };
    const add = (...parts: Array<{ amount: Decimal; adjustment: Decimal; vat: Decimal }>) => ({
      amount: sumMoney(parts.map((p) => p.amount)),
      adjustment: sumMoney(parts.map((p) => p.adjustment)),
      vat: sumMoney(parts.map((p) => p.vat)),
    });

    const sales = (r: BreakdownRow) => r.side === 'SALES';
    const purchases = (r: BreakdownRow) => r.side === 'PURCHASES';
    const outputTax = pick(sales).vat;
    const inputTax = pick(purchases).vat;
    const base = {
      from: formatDateOnly(from),
      to: formatDateOnly(to),
      currency,
      country: profile.country,
      outputTax: fmt(outputTax),
      inputTax: fmt(inputTax),
      netVatDue: fmt(outputTax.minus(inputTax)),
    };

    if (profile.country === 'SA') {
      const b1 = pick((r) => sales(r) && r.category === 'STANDARD');
      const b2 = pick((r) => sales(r) && r.category === 'ZERO_RATED' && EDU_HEA.has(r.exemptionCode ?? ''));
      const b4 = pick((r) => sales(r) && r.category === 'ZERO_RATED' && isExport(r.exemptionCode));
      const b3 = pick((r) => sales(r) && r.category === 'ZERO_RATED' && !EDU_HEA.has(r.exemptionCode ?? '') && !isExport(r.exemptionCode));
      const b5 = pick((r) => sales(r) && r.category === 'EXEMPT');
      const b7 = pick((r) => purchases(r) && r.category === 'STANDARD');
      const b10 = pick((r) => purchases(r) && r.category === 'ZERO_RATED');
      const b11 = pick((r) => purchases(r) && r.category === 'EXEMPT');
      const totalSales = add(b1, b2, b3, b4, b5);
      const totalPurchases = add(b7, zero, zero, b10, b11);
      const due = totalSales.vat.minus(totalPurchases.vat);
      return {
        ...base,
        format: 'ZATCA',
        boxes: [
          box('1', 'standardRatedSales', b1),
          box('2', 'citizenHealthEducationSales', b2),
          box('3', 'zeroRatedDomesticSales', b3),
          box('4', 'exports', b4),
          box('5', 'exemptSales', b5),
          box('6', 'totalSales', totalSales),
          box('7', 'standardRatedPurchases', b7),
          box('8', 'importsPaidAtCustoms', zero),
          box('9', 'importsReverseCharge', zero),
          box('10', 'zeroRatedPurchases', b10),
          box('11', 'exemptPurchases', b11),
          box('12', 'totalPurchases', totalPurchases),
          box('13', 'totalVatDue', { ...zero, vat: due }),
          box('14', 'previousCorrections', zero),
          box('15', 'creditCarriedForward', zero),
          box('16', 'netVatDue', { ...zero, vat: due }),
        ],
      };
    }

    // Generic: output and input tax per category and rate.
    const keyOf = (r: BreakdownRow) => `${r.side}|${r.category}|${new Decimal(r.percent).toFixed(2)}`;
    const groups = new Map<string, BreakdownRow[]>();
    for (const r of rows.filter((x) => x.category !== 'OUT_OF_SCOPE')) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
    return {
      ...base,
      format: 'GENERIC',
      lines: [...groups.entries()]
        .sort(([a], [b]) => (a < b ? 1 : -1))
        .map(([key, members]) => {
          const [side, category, percent] = key.split('|');
          const net = sumMoney(members.filter((m) => !m.isAdjustment).map((m) => m.net));
          const adjustment = sumMoney(members.filter((m) => m.isAdjustment).map((m) => m.net));
          return { side, category, percent, amount: fmt(net), adjustment: fmt(adjustment), tax: fmt(sumMoney(members.map((m) => m.tax))) };
        }),
    };
  }
}
