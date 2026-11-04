import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service.js';
import { randomToken, safeEqual, sha256Hex } from '../../common/helpers/crypto.js';
import { AppException } from '../../core/errors/app.exception.js';
import { ErrorCode } from '../../core/errors/error-codes.js';
import type { User, UserTokenPurpose } from '../../generated/prisma/client.js';
import { MailerService } from '../email/mailer.service.js';
import { invitationEmail, passwordResetEmail } from '../email/templates.js';
import { UserTokensRepository, type UserTokenWithUser } from './user-tokens.repository.js';

export const INVITATION_TTL_DAYS = 7;
export const RESET_TTL_MINUTES = 60;
const PRODUCT = 'Pencil';

/**
 * Issues and verifies the links Pencil emails: invitations (set a password,
 * join a company) and password resets. A link is `<token id>.<secret>`; only
 * the secret's SHA-256 is stored, so a database leak exposes no usable link.
 */
@Injectable()
export class AccountLinksService {
  constructor(
    private readonly config: AppConfig,
    private readonly tokens: UserTokensRepository,
    private readonly mailer: MailerService,
  ) {}

  private async issue(userId: string, purpose: UserTokenPurpose, ttlMs: number, extra: { tenantId?: string; invitedById?: string | null } = {}) {
    await this.tokens.retireOpen(userId, purpose, purpose === 'INVITATION' ? (extra.tenantId ?? null) : undefined);
    const secret = randomToken(32);
    const row = await this.tokens.create({
      userId,
      purpose,
      tokenHash: sha256Hex(secret),
      tenantId: extra.tenantId ?? null,
      invitedById: extra.invitedById ?? null,
      expiresAt: new Date(Date.now() + ttlMs),
    });
    return `${row.id}.${secret}`;
  }

  private link(path: string, token: string): string {
    return `${this.config.get('APP_URL').replace(/\/+$/, '')}${path}?token=${encodeURIComponent(token)}`;
  }

  /** Creates an invitation link and emails it. Returns whether the email went out. */
  async sendInvitation(args: {
    user: User;
    tenantId: string;
    companyName: string;
    inviterName: string | null;
    invitedById: string | null;
  }): Promise<boolean> {
    const token = await this.issue(args.user.id, 'INVITATION', INVITATION_TTL_DAYS * 86_400_000, {
      tenantId: args.tenantId,
      invitedById: args.invitedById,
    });
    return this.mailer.send(
      invitationEmail({
        to: args.user.email,
        inviteeName: args.user.fullName,
        companyName: args.companyName,
        inviterName: args.inviterName,
        url: this.link('/invite', token),
        expiresInDays: INVITATION_TTL_DAYS,
        newAccount: args.user.passwordHash === null,
        product: PRODUCT,
        support: this.config.get('SUPPORT_EMAIL'),
      }),
    );
  }

  /** At most one reset email per minute per user (quiet on repeats). */
  async sendPasswordReset(user: User): Promise<void> {
    const last = await this.tokens.lastIssuedAt(user.id, 'PASSWORD_RESET');
    if (last && Date.now() - last.createdAt.getTime() < 60_000) return;
    const token = await this.issue(user.id, 'PASSWORD_RESET', RESET_TTL_MINUTES * 60_000);
    await this.mailer.send(
      passwordResetEmail({
        to: user.email,
        name: user.fullName,
        url: this.link('/reset-password', token),
        expiresInMinutes: RESET_TTL_MINUTES,
        product: PRODUCT,
        support: this.config.get('SUPPORT_EMAIL'),
      }),
    );
  }

  /** Resolves an unused, unexpired link of the given kind (constant-time hash check). */
  async verify(token: string, purpose: UserTokenPurpose): Promise<UserTokenWithUser> {
    const [id, secret] = token.split('.');
    const invalid = () => new AppException(ErrorCode.LINK_INVALID, 'This link is invalid or has expired');
    if (!id || !secret || !/^[0-9a-f-]{36}$/i.test(id)) throw invalid();
    const row = await this.tokens.findWithUser(id);
    if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt <= new Date() || !safeEqual(row.tokenHash, sha256Hex(secret))) {
      throw invalid();
    }
    if (row.user.status !== 'ACTIVE') throw invalid();
    return row;
  }

  consume(id: string): Promise<boolean> {
    return this.tokens.markUsed(id);
  }
}
