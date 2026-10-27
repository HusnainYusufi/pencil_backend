import { Transform } from 'class-transformer';
import { registerDecorator, type ValidationOptions } from 'class-validator';
import { isDateOnly } from '../helpers/date.js';

/** Calendar date `YYYY-MM-DD` (business dates: no time, no zone). */
export function IsDateOnly(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'isDateOnly',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: `${String(propertyName)} must be a date in YYYY-MM-DD format`, ...options },
      validator: { validate: (value: unknown) => isDateOnly(value) },
    });
}

/** Non-negative decimal money amount sent as a string, e.g. "1250.500". */
export const MONEY_PATTERN = /^\d{1,15}(\.\d{1,4})?$/;

/** Query-string booleans: "true"/"1" -> true, "false"/"0" -> false. */
export const ToBoolean = () =>
  Transform(({ value }: { value: unknown }) => {
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
  });
