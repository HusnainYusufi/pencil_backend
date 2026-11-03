import { Prisma } from '../../generated/prisma/client.js';
import { AppException } from '../errors/app.exception.js';
import { ErrorCode } from '../errors/error-codes.js';

const RETRYABLE_PG_CODES = new Set(['40001', '40P01']); // serialization_failure, deadlock_detected

function pgCode(error: Prisma.PrismaClientKnownRequestError): string | undefined {
  const meta = error.meta as { code?: unknown; driverAdapterError?: { cause?: { originalCode?: unknown } } } | undefined;
  const code = meta?.driverAdapterError?.cause?.originalCode ?? meta?.code;
  return typeof code === 'string' ? code : undefined;
}

interface UniqueViolationMeta {
  target?: unknown;
  driverAdapterError?: { cause?: { constraint?: { fields?: unknown; index?: unknown } } };
}

/** Column names, when the driver reports them (it may only report the index). */
function uniqueFields(error: Prisma.PrismaClientKnownRequestError): string[] | undefined {
  const meta = error.meta as UniqueViolationMeta | undefined;
  const fields = meta?.driverAdapterError?.cause?.constraint?.fields ?? meta?.target;
  return Array.isArray(fields) ? fields.map(String) : undefined;
}

function uniqueIndex(error: Prisma.PrismaClientKnownRequestError): string | undefined {
  const index = (error.meta as UniqueViolationMeta | undefined)?.driverAdapterError?.cause?.constraint?.index;
  return typeof index === 'string' ? index : undefined;
}

export function isRetryableTransactionError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034') return true;
  const code = pgCode(error);
  return code !== undefined && RETRYABLE_PG_CODES.has(code);
}

/**
 * `field` is the database column (snake_case). Matches the reported columns,
 * or the Prisma index name `<table>_<columns>_key` when only that is known.
 */
export function isUniqueViolation(error: unknown, field?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  if (field === undefined) return true;
  const fields = uniqueFields(error);
  if (fields) return fields.includes(field);
  const index = uniqueIndex(error);
  return index !== undefined && new RegExp(`_${field}(_[a-z0-9]+)*_key$`).test(index);
}

/**
 * Ledger guards raised by database triggers (migration ledger_hardening).
 * The application checks the same rules first with friendlier details; these
 * only surface when a concurrent change wins the race.
 */
const LEDGER_GUARDS: Record<string, { code: ErrorCode; message: string }> = {
  PNB01: { code: ErrorCode.BOOKS_LOCKED, message: 'The books are locked for that date' },
  PNB02: { code: ErrorCode.FISCAL_PERIOD_CLOSED, message: 'The fiscal period or year is closed' },
  PNB03: { code: ErrorCode.ENTRY_NOT_EDITABLE, message: 'Posted entries cannot be changed; post a reversing entry instead' },
  PNB04: { code: ErrorCode.ACCOUNT_NOT_POSTABLE, message: 'An account on this entry cannot be posted to' },
};

/** Translates expected Prisma failures into API errors; undefined = unexpected. */
export function mapPrismaError(error: unknown): AppException | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  const guard = LEDGER_GUARDS[pgCode(error) ?? ''];
  if (guard) return new AppException(guard.code, guard.message, undefined, { cause: error });
  switch (error.code) {
    case 'P2002':
      return new AppException(
        ErrorCode.CONFLICT,
        'A record with the same unique value already exists',
        { fields: uniqueFields(error) },
        { cause: error },
      );
    case 'P2025':
      return new AppException(ErrorCode.NOT_FOUND, 'Record not found', undefined, { cause: error });
    case 'P2003':
      return new AppException(
        ErrorCode.CONFLICT,
        'The operation conflicts with related records',
        undefined,
        { cause: error },
      );
    case 'P2034':
      return new AppException(
        ErrorCode.CONCURRENT_MODIFICATION,
        'The data was modified concurrently; please retry',
        undefined,
        { cause: error },
      );
    default:
      return isRetryableTransactionError(error)
        ? new AppException(
            ErrorCode.CONCURRENT_MODIFICATION,
            'The data was modified concurrently; please retry',
            undefined,
            { cause: error },
          )
        : undefined;
  }
}
