import { ValidationError, ValidationPipe } from '@nestjs/common';
import { AppException } from '../errors/app.exception.js';
import { ErrorCode } from '../errors/error-codes.js';

export interface FieldError {
  field: string;
  errors: string[];
}

function flatten(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent
      ? /^\d+$/.test(error.property)
        ? `${parent}[${error.property}]`
        : `${parent}.${error.property}`
      : error.property;
    const own = error.constraints ? [{ field, errors: Object.values(error.constraints) }] : [];
    return [...own, ...flatten(error.children ?? [], field)];
  });
}

/**
 * Strict input handling: unknown properties are rejected (not silently
 * dropped) so client bugs and mass-assignment attempts surface immediately.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    validationError: { target: false, value: false },
    exceptionFactory: (errors) =>
      new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', flatten(errors)),
  });
}
