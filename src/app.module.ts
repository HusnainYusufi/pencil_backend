import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfig } from './config/app-config.service.js';
import { AppConfigModule } from './config/config.module.js';
import { ContextModule } from './core/context/context.module.js';
import { DatabaseModule } from './core/database/database.module.js';
import { HealthModule } from './core/health/health.module.js';
import { AllExceptionsFilter } from './core/http/all-exceptions.filter.js';
import { createValidationPipe } from './core/http/validation.js';
import { IdempotencyModule } from './core/idempotency/idempotency.module.js';
import { LoggingModule } from './core/logging/logging.module.js';
import { PermissionsGuard } from './core/security/permissions.guard.js';
import { SecurityModule } from './core/security/security.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthGuard } from './modules/auth/auth.guard.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { EntitlementsModule } from './modules/entitlements/entitlements.module.js';
import { FeatureGuard } from './modules/entitlements/feature.guard.js';
import { PlatformModule } from './modules/platform/platform.module.js';
import { TenancyModule } from './modules/tenancy/tenancy.module.js';

@Module({
  imports: [
    // Core infrastructure
    AppConfigModule,
    ContextModule,
    LoggingModule,
    DatabaseModule,
    SecurityModule,
    IdempotencyModule,
    HealthModule,
    ThrottlerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        throttlers: [{ ttl: config.get('THROTTLE_TTL_SECONDS') * 1000, limit: config.get('THROTTLE_LIMIT') }],
        skipIf: () => config.isTest,
      }),
    }),

    // Domain
    AuditModule,
    EntitlementsModule,
    TenancyModule,
    AuthModule,
    PlatformModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
    // Guards run in this order: rate limit -> authenticate -> authorize -> plan entitlement.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_GUARD, useExisting: PermissionsGuard },
    { provide: APP_GUARD, useExisting: FeatureGuard },
  ],
})
export class AppModule {}
