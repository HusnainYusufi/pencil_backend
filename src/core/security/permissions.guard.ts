import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequestContext } from '../context/request-context.service.js';
import { AppException } from '../errors/app.exception.js';
import { ErrorCode } from '../errors/error-codes.js';
import { PERMISSIONS_KEY } from './decorators.js';
import { missingPermissions } from './permissions.js';

/** Enforces @RequirePermissions(). Runs after AuthGuard populated the actor. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly ctx: RequestContext,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndMerge<string[]>(PERMISSIONS_KEY, [
      context.getClass(),
      context.getHandler(),
    ]);
    if (!required || required.length === 0) return true;

    const actor = this.ctx.actor;
    if (!actor || actor.type === 'system') {
      throw new AppException(ErrorCode.UNAUTHENTICATED, 'Authentication required');
    }
    const missing = missingPermissions(actor.permissions, required);
    if (missing.length > 0) {
      throw new AppException(
        ErrorCode.PERMISSION_DENIED,
        'You do not have permission to perform this action',
        { missing },
      );
    }
    return true;
  }
}
