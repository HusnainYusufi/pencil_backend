import { HttpException } from '@nestjs/common';
import { ERROR_HTTP_STATUS, ErrorCode } from './error-codes.js';

/**
 * The only exception type domain code should throw. Carries a stable code,
 * a developer-facing message and optional structured details.
 */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    options?: { cause?: unknown },
  ) {
    super({ code, message, details }, ERROR_HTTP_STATUS[code], { cause: options?.cause });
  }

  static notFound(entity: string, id?: string): AppException {
    return new AppException(
      ErrorCode.NOT_FOUND,
      id ? `${entity} '${id}' not found` : `${entity} not found`,
    );
  }

  static forbidden(message = 'You do not have permission to perform this action'): AppException {
    return new AppException(ErrorCode.PERMISSION_DENIED, message);
  }
}
