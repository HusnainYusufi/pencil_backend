import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { RequestContext } from '../context/request-context.service.js';
import { mapPrismaError } from '../database/prisma-errors.js';
import { AppException } from '../errors/app.exception.js';
import { ErrorCode } from '../errors/error-codes.js';
import type { ErrorResponse } from '../errors/error-response.js';

const STATUS_CODES: Partial<Record<number, ErrorCode>> = {
  400: ErrorCode.BAD_REQUEST,
  401: ErrorCode.UNAUTHENTICATED,
  403: ErrorCode.PERMISSION_DENIED,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  413: ErrorCode.PAYLOAD_TOO_LARGE,
  415: ErrorCode.BAD_REQUEST,
  429: ErrorCode.RATE_LIMITED,
  503: ErrorCode.SERVICE_UNAVAILABLE,
};

interface NormalizedError {
  status: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
}

/**
 * Converts every error into `{ error: { code, message, details, requestId } }`.
 * Internal details (stack traces, SQL, Prisma messages) never reach clients;
 * they are logged with the request id instead.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly ctx: RequestContext) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;

    const error = this.normalize(exception);
    if (error.status >= 500) {
      this.logger.error({ err: exception, code: error.code }, 'Unhandled error');
    }

    const body: ErrorResponse = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined && { details: error.details }),
        requestId: this.ctx.requestId,
      },
    };
    host.switchToHttp().getResponse<FastifyReply>().status(error.status).send(body);
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    const mapped = mapPrismaError(exception);
    if (mapped) return this.normalize(mapped);

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        code: STATUS_CODES[status] ?? (status >= 500 ? ErrorCode.INTERNAL : ErrorCode.BAD_REQUEST),
        message: status >= 500 ? 'Internal server error' : this.httpMessage(exception),
      };
    }

    // Fastify-level errors (malformed JSON, body too large, bad content type).
    const fastifyStatus = (exception as { statusCode?: unknown })?.statusCode;
    if (typeof fastifyStatus === 'number' && fastifyStatus >= 400 && fastifyStatus < 500) {
      return {
        status: fastifyStatus,
        code: STATUS_CODES[fastifyStatus] ?? ErrorCode.BAD_REQUEST,
        message: (exception as Error).message,
      };
    }

    return { status: HttpStatus.INTERNAL_SERVER_ERROR, code: ErrorCode.INTERNAL, message: 'Internal server error' };
  }

  private httpMessage(exception: HttpException): string {
    const response = exception.getResponse();
    if (typeof response === 'string') return response;
    const message = (response as { message?: unknown }).message;
    if (Array.isArray(message)) return message.join('; ');
    return typeof message === 'string' ? message : exception.message;
  }
}
