import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AppException } from '../errors/app.exception.js';
import { ErrorCode } from '../errors/error-codes.js';
import type {
  Actor,
  PlatformAdminActor,
  RequestContextStore,
  UserActor,
} from './request-context.js';

/** Typed accessors over the current async context. */
@Injectable()
export class RequestContext {
  constructor(private readonly cls: ClsService<RequestContextStore>) {}

  get requestId(): string | undefined {
    return this.cls.isActive() ? this.cls.getId() : undefined;
  }

  get ip(): string | undefined {
    return this.get('ip');
  }

  get userAgent(): string | undefined {
    return this.get('userAgent');
  }

  get actor(): Actor | undefined {
    return this.get('actor');
  }

  get tenantId(): string | null | undefined {
    return this.get('tenantId');
  }

  get bypassRls(): boolean {
    return this.get('bypassRls') === true;
  }

  requireTenantId(): string {
    const tenantId = this.get('tenantId');
    if (!tenantId) {
      throw new AppException(ErrorCode.TENANT_REQUIRED, 'Select a tenant to continue');
    }
    return tenantId;
  }

  requireUser(): UserActor {
    const actor = this.get('actor');
    if (actor?.type !== 'user') {
      throw new AppException(ErrorCode.UNAUTHENTICATED, 'Authentication required');
    }
    return actor;
  }

  requirePlatformAdmin(): PlatformAdminActor {
    const actor = this.get('actor');
    if (actor?.type !== 'platform_admin') {
      throw new AppException(ErrorCode.UNAUTHENTICATED, 'Authentication required');
    }
    return actor;
  }

  /** Low-level access for infrastructure code (guards, db layer). */
  get<K extends keyof RequestContextStore>(key: K): RequestContextStore[K] | undefined {
    return this.cls.isActive() ? this.cls.get(key) : undefined;
  }

  set<K extends keyof RequestContextStore>(key: K, value: RequestContextStore[K]): void {
    this.cls.set(key, value);
  }

  /** Runs `fn` in a child context that inherits current values. */
  run<T>(fn: () => T): T {
    return this.cls.run({ ifNested: 'inherit' }, fn);
  }
}
