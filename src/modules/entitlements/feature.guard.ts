import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequestContext } from '../../core/context/request-context.service.js';
import { AppException } from '../../core/errors/app.exception.js';
import { ErrorCode } from '../../core/errors/error-codes.js';
import { FEATURE_KEY } from '../../core/security/decorators.js';
import { EntitlementsService } from './entitlements.service.js';

/** Enforces @RequireFeature() against the current tenant's entitlements. */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly ctx: RequestContext,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<string>(FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!feature) return true;

    const tenantId = this.ctx.requireTenantId();
    const entitlements = await this.entitlements.getForTenant(tenantId);
    if (!entitlements.has(feature)) {
      throw new AppException(ErrorCode.FEATURE_NOT_AVAILABLE, 'Your plan does not include this feature', {
        feature,
      });
    }
    return true;
  }
}
