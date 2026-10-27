import { COUNTRY_PROFILES } from '../../common/constants/countries.js';
import { AppException } from '../../core/errors/app.exception.js';
import { ErrorCode } from '../../core/errors/error-codes.js';
import type { CountryCode } from '../../generated/prisma/enums.js';

/** Validates a tax registration number against the country's format. */
export function assertValidTaxNumber(country: CountryCode, taxNumber: string | undefined, field = 'taxNumber'): void {
  if (taxNumber === undefined) return;
  if (!COUNTRY_PROFILES[country].taxNumberPattern.test(taxNumber)) {
    throw new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', [
      { field, errors: [`${field} is not a valid ${country} tax registration number`] },
    ]);
  }
}
