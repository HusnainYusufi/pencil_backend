import { Injectable } from '@nestjs/common';
import { addMs } from '../../common/helpers/date.js';
import { normalizeEmail } from '../../common/helpers/string.js';
import { AppConfig } from '../../config/app-config.service.js';
import { RequestContext } from '../../core/context/request-context.service.js';
import { Db } from '../../core/database/db.service.js';
import { isUniqueViolation } from '../../core/database/prisma-errors.js';
import { AppException } from '../../core/errors/app.exception.js';
import { ErrorCode } from '../../core/errors/error-codes.js';
import { AccessCache } from '../../core/security/access-cache.js';
import type { User } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { UserSessionsRepository } from '../identity/user-sessions.repository.js';
import { UsersRepository } from '../identity/users.repository.js';
import { MembershipsRepository, type UserTenantView } from '../tenancy/repositories/memberships.repository.js';
import { TenantProvisioningService } from '../tenancy/tenant-provisioning.service.js';
import type { LoginDto, SignupDto } from './dto/auth.dto.js';
import { PasswordService } from './password.service.js';
import { evaluateRefresh } from './refresh-policy.js';
import { TokenService, type IssuedAccessToken } from './token.service.js';

export interface SessionTokens extends IssuedAccessToken {
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  activeTenantId: string | null;
}

export interface UserSummary {
  id: string;
  email: string;
  fullName: string;
  locale: string;
  emailVerified: boolean;
}

export interface TenantSummary {
  id: string;
  slug: string;
  legalName: string;
  tradeName: string | null;
  country: string;
  baseCurrency: string;
  status: string;
  role: { key: string; name: string };
}

export interface AuthResult extends SessionTokens {
  user: UserSummary;
  tenants: TenantSummary[];
}

const toUserSummary = (user: User): UserSummary => ({
  id: user.id,
  email: user.email,
  fullName: user.fullName,
  locale: user.locale,
  emailVerified: user.emailVerifiedAt !== null,
});

const toTenantSummary = (m: UserTenantView): TenantSummary => ({ ...m.tenant, role: m.role });

@Injectable()
export class UserAuthService {
  constructor(
    private readonly config: AppConfig,
    private readonly db: Db,
    private readonly ctx: RequestContext,
    private readonly users: UsersRepository,
    private readonly sessions: UserSessionsRepository,
    private readonly memberships: MembershipsRepository,
    private readonly provisioning: TenantProvisioningService,
    private readonly entitlements: EntitlementsService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly accessCache: AccessCache,
  ) {}

  /** Self-service onboarding: user + company + owner role + trial, atomically. */
  async signup(dto: SignupDto): Promise<AuthResult> {
    const email = normalizeEmail(dto.email);
    const passwordHash = await this.passwords.hash(dto.password); // CPU-heavy: outside the transaction

    const { user, tenantId } = await this.db
      .asSystem(() =>
        this.db.transaction(async () => {
          const user = await this.users.create({
            email,
            passwordHash,
            fullName: dto.fullName.trim(),
            phone: dto.phone,
            locale: dto.locale ?? dto.company.locale ?? 'ar',
          });
          const tenant = await this.provisioning.provision({ company: dto.company, ownerUserId: user.id });
          await this.audit.record({
            action: 'auth.signup',
            tenantId: tenant.id,
            actor: { type: 'USER', id: user.id },
            entityType: 'user',
            entityId: user.id,
          });
          return { user, tenantId: tenant.id };
        }),
      )
      .catch((error: unknown) => {
        if (isUniqueViolation(error, 'email')) {
          throw new AppException(ErrorCode.EMAIL_TAKEN, 'An account with this email already exists');
        }
        throw error;
      });

    const tokens = await this.issueSession(user.id, tenantId);
    return { ...tokens, user: toUserSummary(user), tenants: await this.tenantsOf(user.id) };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.users.findByEmail(normalizeEmail(dto.email));
    if (!user) {
      await this.passwords.verifyDummy(dto.password);
      throw this.invalidCredentials();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppException(ErrorCode.ACCOUNT_LOCKED, 'Too many failed attempts; try again later', {
        retryAfterSeconds: Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000),
      });
    }
    if (!(await this.passwords.verify(user.passwordHash, dto.password))) {
      const { maxFailedAttempts, lockoutMs } = this.config.authLockout;
      await this.users.registerFailedLogin(user.id, maxFailedAttempts, lockoutMs);
      await this.audit.record({ action: 'auth.login_failed', tenantId: null, actor: { type: 'USER', id: user.id } });
      throw this.invalidCredentials();
    }
    // Checked only after the password, so disabled accounts cannot be probed.
    if (user.status !== 'ACTIVE') {
      throw new AppException(ErrorCode.ACCOUNT_DISABLED, 'This account is disabled');
    }

    await this.users.registerSuccessfulLogin(user.id);
    const tenants = await this.tenantsOf(user.id);
    let activeTenantId: string | null = null;
    if (dto.tenantId) {
      if (!tenants.some((t) => t.id === dto.tenantId)) {
        throw new AppException(ErrorCode.TENANT_ACCESS_DENIED, 'You are not a member of this company');
      }
      activeTenantId = dto.tenantId;
    } else if (tenants.length === 1) {
      activeTenantId = tenants[0]!.id;
    }

    const tokens = await this.issueSession(user.id, activeTenantId);
    await this.audit.record({
      action: 'auth.login',
      tenantId: activeTenantId,
      actor: { type: 'USER', id: user.id },
      metadata: { sessionId: this.sessionIdOf(tokens.refreshToken) },
    });
    return { ...tokens, user: toUserSummary(user), tenants };
  }

  async refresh(refreshToken: string | undefined): Promise<SessionTokens> {
    const parsed = refreshToken ? this.tokens.parseRefreshToken(refreshToken) : null;
    if (!parsed) throw new AppException(ErrorCode.INVALID_TOKEN, 'Invalid refresh token');

    const session = await this.sessions.findById(parsed.sessionId);
    if (!session) throw new AppException(ErrorCode.SESSION_REVOKED, 'Session is no longer valid');

    switch (evaluateRefresh(session, parsed.secretHash)) {
      case 'revoked':
      case 'expired':
        throw new AppException(ErrorCode.SESSION_REVOKED, 'Session is no longer valid');
      case 'stale':
        throw new AppException(ErrorCode.INVALID_TOKEN, 'Refresh token already used; use the latest one');
      case 'reuse':
        await this.sessions.revoke(session.id, 'refresh_token_reuse');
        this.accessCache.invalidateSession(session.id);
        await this.audit.record({
          action: 'auth.refresh_reuse_detected',
          tenantId: null,
          actor: { type: 'USER', id: session.userId },
          metadata: { sessionId: session.id },
        });
        throw new AppException(ErrorCode.SESSION_REVOKED, 'Session is no longer valid');
      case 'valid':
        break;
    }
    if (session.user.status !== 'ACTIVE') {
      throw new AppException(ErrorCode.ACCOUNT_DISABLED, 'This account is disabled');
    }

    const next = this.tokens.newRefreshSecret();
    const expiresAt = addMs(new Date(), this.config.jwt.refreshTtlMs);
    if (!(await this.sessions.rotate(session.id, parsed.secretHash, next.hash, expiresAt))) {
      throw new AppException(ErrorCode.INVALID_TOKEN, 'Refresh token already used; use the latest one');
    }
    const access = await this.tokens.signTenantAccess({
      sub: session.userId,
      sid: session.id,
      tid: session.activeTenantId,
    });
    return {
      ...access,
      refreshToken: this.tokens.composeRefreshToken(session.id, next.secret),
      refreshTokenExpiresAt: expiresAt,
      activeTenantId: session.activeTenantId,
    };
  }

  async switchTenant(tenantId: string): Promise<IssuedAccessToken & { activeTenantId: string }> {
    const actor = this.ctx.requireUser();
    const membership = await this.db.withTenant(tenantId, () =>
      this.memberships.findAccess(tenantId, actor.userId),
    );
    if (!membership || membership.status !== 'ACTIVE' || membership.tenant.status === 'ARCHIVED') {
      throw new AppException(ErrorCode.TENANT_ACCESS_DENIED, 'You are not a member of this company');
    }
    await this.sessions.setActiveTenant(actor.sessionId, tenantId);
    const access = await this.tokens.signTenantAccess({ sub: actor.userId, sid: actor.sessionId, tid: tenantId });
    await this.audit.record({ action: 'auth.tenant_switched', tenantId });
    return { ...access, activeTenantId: tenantId };
  }

  async logout(): Promise<void> {
    const actor = this.ctx.requireUser();
    await this.sessions.revoke(actor.sessionId, 'logout');
    this.accessCache.invalidateSession(actor.sessionId);
    await this.audit.record({ action: 'auth.logout', metadata: { sessionId: actor.sessionId } });
  }

  async logoutEverywhere(): Promise<number> {
    const actor = this.ctx.requireUser();
    const count = await this.sessions.revokeAllForUser(actor.userId, 'logout_all');
    this.accessCache.invalidateUser(actor.userId);
    await this.audit.record({ action: 'auth.logout_all', metadata: { sessions: count } });
    return count;
  }

  /** Bootstrap payload for the frontend: who am I, where am I, what may I do. */
  async me() {
    const actor = this.ctx.requireUser();
    const user = await this.users.findById(actor.userId);
    if (!user) throw new AppException(ErrorCode.SESSION_REVOKED, 'Session is no longer valid');
    const tenants = await this.tenantsOf(actor.userId);
    const activeTenant = tenants.find((t) => t.id === actor.tenantId) ?? null;
    const entitlements = actor.tenantId ? await this.entitlements.getForTenant(actor.tenantId) : null;

    return {
      user: toUserSummary(user),
      activeTenant,
      permissions: [...actor.permissions].sort(),
      plan: entitlements?.planCode ?? null,
      entitlements: entitlements?.toJSON() ?? {},
      tenants,
    };
  }

  private async issueSession(userId: string, activeTenantId: string | null): Promise<SessionTokens> {
    const { secret, hash } = this.tokens.newRefreshSecret();
    const expiresAt = addMs(new Date(), this.config.jwt.refreshTtlMs);
    const session = await this.sessions.create({
      userId,
      activeTenantId,
      tokenHash: hash,
      expiresAt,
      ipAddress: this.ctx.ip,
      userAgent: this.ctx.userAgent,
    });
    const access = await this.tokens.signTenantAccess({ sub: userId, sid: session.id, tid: activeTenantId });
    return {
      ...access,
      refreshToken: this.tokens.composeRefreshToken(session.id, secret),
      refreshTokenExpiresAt: expiresAt,
      activeTenantId,
    };
  }

  /** The user's own memberships span tenants, hence system scope (read-only, self). */
  private async tenantsOf(userId: string): Promise<TenantSummary[]> {
    const memberships = await this.db.asSystem(() => this.memberships.listForUser(userId));
    return memberships.map(toTenantSummary);
  }

  private sessionIdOf(refreshToken: string): string {
    return refreshToken.slice(0, refreshToken.indexOf('.'));
  }

  private invalidCredentials(): AppException {
    return new AppException(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
  }
}
