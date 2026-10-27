import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { PinoLogger } from 'nestjs-pino';
import { RequestContext } from '../../core/context/request-context.service.js';
import { AppException } from '../../core/errors/app.exception.js';
import { ErrorCode } from '../../core/errors/error-codes.js';
import { AUTH_SCOPE_KEY, type AuthScope } from '../../core/security/decorators.js';
import { AccessContextService } from './access-context.service.js';
import { TokenService } from './token.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global authentication guard (secure by default: every route requires a
 * tenant user unless decorated otherwise). Populates the request context
 * that row-level security, auditing and logging rely on.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly ctx: RequestContext,
    private readonly tokens: TokenService,
    private readonly access: AccessContextService,
    private readonly logger: PinoLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    this.ctx.set('ip', request.ip);
    this.ctx.set('userAgent', request.headers['user-agent']?.slice(0, 512));

    const scope =
      this.reflector.getAllAndOverride<AuthScope>(AUTH_SCOPE_KEY, [context.getHandler(), context.getClass()]) ??
      'tenant';
    if (scope === 'public') return true;

    const token = this.bearerToken(request);
    if (scope === 'platform') {
      await this.authenticatePlatformAdmin(token);
    } else {
      await this.authenticateUser(token, scope, request.method);
    }
    return true;
  }

  private async authenticateUser(token: string, scope: AuthScope, method: string): Promise<void> {
    const claims = await this.tokens.verifyTenantAccess(token);
    const access = await this.access.resolveUser(claims);

    if (scope === 'tenant') {
      if (!access.tenantId) {
        throw new AppException(ErrorCode.TENANT_REQUIRED, 'Select a company to continue');
      }
      if (access.tenantStatus !== 'ACTIVE') {
        throw new AppException(ErrorCode.TENANT_SUSPENDED, 'This company account is suspended');
      }
      if (!access.subscriptionWritable && !SAFE_METHODS.has(method)) {
        throw new AppException(
          ErrorCode.SUBSCRIPTION_INACTIVE,
          'The subscription is inactive; the company is read-only until it is renewed',
        );
      }
    }

    this.ctx.set('actor', {
      type: 'user',
      userId: access.userId,
      sessionId: access.sessionId,
      tenantId: access.tenantId,
      roleKey: access.roleKey,
      permissions: access.permissions,
    });
    this.ctx.set('tenantId', access.tenantId);
    this.logger.assign({ userId: access.userId, tenantId: access.tenantId ?? undefined });
  }

  private async authenticatePlatformAdmin(token: string): Promise<void> {
    const claims = await this.tokens.verifyPlatformAccess(token);
    const access = await this.access.resolvePlatformAdmin(claims);
    this.ctx.set('actor', {
      type: 'platform_admin',
      adminId: access.adminId,
      sessionId: access.sessionId,
      role: access.role,
      permissions: access.permissions,
    });
    // The platform surface is cross-tenant by nature (support, onboarding,
    // billing). Platform routes therefore run with RLS bypass; every action
    // there is permission-checked and audited.
    this.ctx.set('bypassRls', true);
    this.logger.assign({ adminId: access.adminId });
  }

  private bearerToken(request: FastifyRequest): string {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      const token = header.slice(7).trim();
      if (token) return token;
    }
    throw new AppException(ErrorCode.UNAUTHENTICATED, 'Authentication required');
  }
}
