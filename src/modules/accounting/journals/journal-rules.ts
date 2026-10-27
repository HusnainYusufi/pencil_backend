import { Decimal, minorUnits, sumMoney } from '../../../common/helpers/money.js';
import { AppException } from '../../../core/errors/app.exception.js';
import { ErrorCode } from '../../../core/errors/error-codes.js';
import type { FieldError } from '../../../core/http/validation.js';

export interface JournalLineInput {
  accountId: string;
  debit?: string;
  credit?: string;
  description?: string;
  branchId?: string;
  costCenterId?: string;
}

export interface NormalizedJournalLine {
  lineNo: number;
  accountId: string;
  debit: Decimal;
  credit: Decimal;
  description: string | null;
  branchId: string | null;
  costCenterId: string | null;
}

export interface NormalizedJournal {
  lines: NormalizedJournalLine[];
  /** Sum of debits (= sum of credits). */
  total: Decimal;
}

/**
 * Pure double-entry validation, shared by manual journals and every future
 * posting source. Amounts must already respect the currency's precision
 * (2 decimals SAR, 3 JOD): we never round silently on behalf of the user.
 */
export function normalizeJournalLines(lines: readonly JournalLineInput[], currency: string): NormalizedJournal {
  const scale = minorUnits(currency);
  const errors: FieldError[] = [];

  if (lines.length < 2) {
    errors.push({ field: 'lines', errors: ['a journal entry needs at least two lines'] });
  }

  const normalized = lines.map((line, index): NormalizedJournalLine => {
    const field = `lines[${index}]`;
    const debit = new Decimal(line.debit || '0');
    const credit = new Decimal(line.credit || '0');
    for (const [name, value] of [['debit', debit], ['credit', credit]] as const) {
      if (value.isNegative()) errors.push({ field: `${field}.${name}`, errors: [`${name} must not be negative`] });
      if (value.decimalPlaces() > scale) {
        errors.push({ field: `${field}.${name}`, errors: [`${name} allows at most ${scale} decimal places for ${currency}`] });
      }
    }
    if (debit.isZero() === credit.isZero()) {
      errors.push({ field, errors: ['enter either a debit or a credit amount (not both, not neither)'] });
    }
    return {
      lineNo: index + 1,
      accountId: line.accountId,
      debit,
      credit,
      description: line.description?.trim() || null,
      branchId: line.branchId ?? null,
      costCenterId: line.costCenterId ?? null,
    };
  });

  if (errors.length > 0) {
    throw new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', errors);
  }

  const totalDebit = sumMoney(normalized.map((l) => l.debit));
  const totalCredit = sumMoney(normalized.map((l) => l.credit));
  if (!totalDebit.equals(totalCredit)) {
    throw new AppException(ErrorCode.UNBALANCED_ENTRY, 'Total debits must equal total credits', {
      debit: totalDebit.toFixed(scale),
      credit: totalCredit.toFixed(scale),
      difference: totalDebit.minus(totalCredit).toFixed(scale),
    });
  }
  return { lines: normalized, total: totalDebit };
}
