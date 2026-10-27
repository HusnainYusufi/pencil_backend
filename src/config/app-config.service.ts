import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema.js';

/**
 * Typed, read-only view over the validated environment. Inject this instead
 * of ConfigService so keys are checked at compile time.
 */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }

  get isTest(): boolean {
    return this.get('NODE_ENV') === 'test';
  }

  get jwt() {
    return {
      issuer: this.get('JWT_ISSUER'),
      accessSecret: this.get('JWT_ACCESS_SECRET'),
      platformSecret: this.get('JWT_PLATFORM_SECRET'),
      accessTtlSeconds: this.get('JWT_ACCESS_TTL_SECONDS'),
      refreshTtlMs: this.get('REFRESH_TOKEN_TTL_DAYS') * 86_400_000,
      platformRefreshTtlMs: this.get('PLATFORM_REFRESH_TOKEN_TTL_HOURS') * 3_600_000,
    };
  }

  get authLockout() {
    return {
      maxFailedAttempts: this.get('AUTH_MAX_FAILED_LOGINS'),
      lockoutMs: this.get('AUTH_LOCKOUT_MINUTES') * 60_000,
    };
  }
}
