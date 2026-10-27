import { Global, Module } from '@nestjs/common';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';
import { IdempotencyRepository } from './idempotency.repository.js';

@Global()
@Module({
  providers: [IdempotencyRepository, IdempotencyInterceptor],
  exports: [IdempotencyRepository, IdempotencyInterceptor],
})
export class IdempotencyModule {}
