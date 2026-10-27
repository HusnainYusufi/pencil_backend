import { Injectable } from '@nestjs/common';
import { addMs } from '../../../common/helpers/date.js';
import { normalizeEmail } from '../../../common/helpers/string.js';
import { AppConfig } from '../../../config/app-config.service.js';
import { RequestContext } from '../../../core/context/request-context.service.js';
import { AppException } from '../../../core/errors/app.exception.js';
import { ErrorCode } from '../../../core/errors/error-codes.js';
import { AccessCache } from '../../../core/security/access-cache.js';
import { PLATFORM_ROLE_PERMISSIONS } from '../../access/platform-permissions.js';
import { AuditService } from '../../audit/audit.service.js';
import type { PlatformLoginDto } from '../dto/auth.dto.js';
import { PasswordService } from '../password.service.js';
import { evaluateRefresh } from '../refresh-policy.js';
import { TokenService, type IssuedAccessToken } from '../token.service.js';
import { PlatformAdminsRepository } from './platform-admins.repository.js';

export interface PlatformSessionTokens extends IssuedAccessToken {
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

/**
 * Staff authentication for pencil_admin. Separate secret, audience, cookie
 * and session table from tenant users; sessions have an absolute lifetime.
 */
@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly config: AppConfig,
    private readonly ctx: RequestContext,
    private readonly admins: PlatformAdminsRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly accessCache: AccessCache,
  ) {}

  async login(dto: PlatformLoginDto): Promise<PlatformSessionTokens> {
    const admin = await this.admins.findByEmail(normalizeEmail(dto.email));
    if (!admin) {
      await this.passwords.verifyDummy(dto.password);
      throw this.invalidCredentials();
    }
    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      throw new AppException(ErrorCode.ACCOUNT_LOCKED, 'Too many failed attempts; try again later');
    }
    if (!(await this.passwords.verify(admin.passwordHash, dto.password))) {
      const { maxFailedAttempts, lockoutMs } = this.config.authLockout;
      await this.admins.registerFailedLogin(admin.id, maxFailedAttempts, lockoutMs);
      await this.audit.record({
        action: 'platform.auth.login_failed',
        tenantId: null,
        actor: { type: 'PLATFORM_ADMIN', id: admin.id },
      });
      throw this.invalidCredentials();
    }
    if (!admin.isActive) throw new AppException(ErrorCode.ACCOUNT_DISABLED, 'This account is disabled');

    await this.admins.registerSuccessfulLogin(admin.id);
    const { secret, hash } = this.tokens.newRefreshSecret();
    const expiresAt = addMs(new Date(), this.config.jwt.platformRefreshTtlMs);
    const session = await this.admins.createSession({
      adminId: admin.id,
      tokenHash: hash,
      expiresAt,
      ipAddress: this.ctx.ip,
      userAgent: this.ctx.userAgent,
    });
    await this.audit.record({
      action: 'platform.auth.login',
      tenantId: null,
      actor: { type: 'PLATFORM_ADMIN', id: admin.id },
      metadata: { sessionId: session.id },
    });
    const access = await this.tokens.signPlatformAccess({ sub: admin.id, sid: session.id });
    return {
      ...access,
      refreshToken: this.tokens.composeRefreshToken(session.id, secret),
      refreshTokenExpiresAt: expiresAt,
    };
  }

  async refresh(refreshToken: string | undefined): Promise<PlatformSessionTokens> {
    const parsed = refreshToken ? this.tokens.parseRefreshToken(refreshToken) : null;
    if (!parsed) throw new AppException(ErrorCode.INVALID_TOKEN, 'Invalid refresh token');
    const session = await this.admins.findSession(parsed.sessionId);
    if (!session) throw new AppException(ErrorCode.SESSION_REVOKED, 'Session is no longer valid');

    const verdict = evaluateRefresh(session, parsed.secretHash);
    if (verdict === 'reuse') {
      await this.admins.revokeSession(session.id, 'refresh_token_reuse');
      this.accessCache.invalidateSession(session.id);
      await this.audit.record({
        action: 'platform.auth.refresh_reuse_detected',
        tenantId: null,
        actor: { type: 'PLATFORM_ADMIN', id: session.adminId },
      });
    }
    if (verdict !== 'valid') {
      throw new AppException(
        verdict === 'stale' ? ErrorCode.INVALID_TOKEN : ErrorCode.SESSION_REVOKED,
        'Session is no longer valid',
      );
    }
    if (!session.admin.isActive) throw new AppException(ErrorCode.ACCOUNT_DISABLED, 'This account is disabled');

    const next = this.tokens.newRefreshSecret();
    if (!(await this.admins.rotateSession(session.id, parsed.secretHash, next.hash))) {
      throw new AppException(ErrorCode.INVALID_TOKEN, 'Refresh token already used; use the latest one');
    }
    const access = await this.tokens.signPlatformAccess({ sub: session.adminId, sid: session.id });
    return {
      ...access,
      refreshToken: this.tokens.composeRefreshToken(session.id, next.secret),
      refreshTokenExpiresAt: session.expiresAt,
    };
  }

  async logout(): Promise<void> {
    const actor = this.ctx.requirePlatformAdmin();
    await this.admins.revokeSession(actor.sessionId, 'logout');
    this.accessCache.invalidateSession(actor.sessionId);
    await this.audit.record({ action: 'platform.auth.logout', tenantId: null });
  }

  async me() {
    const actor = this.ctx.requirePlatformAdmin();
    const admin = await this.admins.findById(actor.adminId);
    if (!admin) throw new AppException(ErrorCode.SESSION_REVOKED, 'Session is no longer valid');
    return {
      id: admin.id,
      email: admin.email,
      fullName: admin.fullName,
      role: admin.role,
      permissions: [...PLATFORM_ROLE_PERMISSIONS[admin.role]],
    };
  }

  private invalidCredentials(): AppException {
    return new AppException(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
  }
}
