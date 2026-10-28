import { Decimal, sumMoney } from '../../../common/helpers/money.js';
import { UNTAGGED, type NormalizedJournalLine } from '../journals/journal-rules.js';

export interface IncomeStatementBalance {
  accountId: string;
  branchId: string | null;
  costCenterId: string | null;
  /** debit - credit over the fiscal year. */
  net: Decimal;
}

export interface ClosingEntryPlan {
  lines: NormalizedJournalLine[];
  /** Sum of debits (= credits) of the closing entry. */
  total: Decimal;
  /** Net profit for the year (negative = loss). */
  profit: Decimal;
}

const ZERO = new Decimal(0);

/**
 * The year-end closing entry: every income-statement balance is reversed to
 * zero, and the net result of each branch / cost centre goes to retained
 * earnings under the same dimensions, so branch-level equity stays right.
 *
 * Example: Sales Cr 1,000 and Rent Dr 400 (one branch) close as
 *   Dr Sales 1,000 / Cr Rent 400 / Cr Retained earnings 600.
 */
export function buildClosingEntry(balances: readonly IncomeStatementBalance[], retainedEarningsId: string, memo: string): ClosingEntryPlan {
  const lines: NormalizedJournalLine[] = [];
  const resultByDimension = new Map<string, { branchId: string | null; costCenterId: string | null; net: Decimal }>();

  for (const balance of balances) {
    if (balance.net.isZero()) continue;
    lines.push({
      lineNo: lines.length + 1,
      accountId: balance.accountId,
      debit: balance.net.isNegative() ? balance.net.negated() : ZERO,
      credit: balance.net.isPositive() ? balance.net : ZERO,
      description: memo,
      branchId: balance.branchId,
      costCenterId: balance.costCenterId,
      ...UNTAGGED,
    });
    const key = `${balance.branchId ?? ''}|${balance.costCenterId ?? ''}`;
    const current = resultByDimension.get(key) ?? { branchId: balance.branchId, costCenterId: balance.costCenterId, net: ZERO };
    resultByDimension.set(key, { ...current, net: current.net.plus(balance.net) });
  }

  for (const { branchId, costCenterId, net } of resultByDimension.values()) {
    if (net.isZero()) continue;
    // net > 0: expenses exceeded revenue (a loss) -> retained earnings is debited.
    lines.push({
      lineNo: lines.length + 1,
      accountId: retainedEarningsId,
      debit: net.isPositive() ? net : ZERO,
      credit: net.isNegative() ? net.negated() : ZERO,
      description: memo,
      branchId,
      costCenterId,
      ...UNTAGGED,
    });
  }

  const total = sumMoney(lines.map((l) => l.debit));
  const profit = sumMoney(balances.map((b) => b.net)).negated();
  return { lines, total, profit };
}

/** Mirror lines (debits <-> credits) for reversing a closing entry. */
export function mirrorLines(lines: ReadonlyArray<Omit<NormalizedJournalLine, 'lineNo'>>): NormalizedJournalLine[] {
  return lines.map((line, i) => ({ ...line, lineNo: i + 1, debit: line.credit, credit: line.debit }));
}
