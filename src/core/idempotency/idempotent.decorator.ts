import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';

export const IDEMPOTENCY_OPTIONS = 'pencil:idempotency';

export interface IdempotencyOptions {
  /** Reject requests without an Idempotency-Key header. */
  required?: boolean;
}

/** Enables Idempotency-Key handling on an endpoint (see IdempotencyInterceptor). */
export const Idempotent = (options: IdempotencyOptions = {}) =>
  applyDecorators(
    SetMetadata(IDEMPOTENCY_OPTIONS, options),
    UseInterceptors(IdempotencyInterceptor),
    ApiHeader({
      name: 'Idempotency-Key',
      required: options.required ?? false,
      description: 'Unique key (8-255 chars) per logical operation; safe to retry with the same key.',
    }),
  );
