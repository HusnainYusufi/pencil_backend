import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../core/database/base.repository.js';
import type { UserSession, UserStatus } from '../../generated/prisma/client.js';

export interface NewSession {
  userId: string;
  activeTenantId: string | null;
  tokenHash: string;
  expiresAt: Date;
  ipAddress?: string;
  userAgent?: string;
}

export type SessionWithUserStatus = UserSession & { user: { status: UserStatus } };

@Injectable()
export class UserSessionsRepository extends BaseRepository {
  create(data: NewSession): Promise<UserSession> {
    return this.client.userSession.create({ data });
  }

  findById(id: string): Promise<SessionWithUserStatus | null> {
    return this.client.userSession.findUnique({
      where: { id },
      include: { user: { select: { status: true } } },
    });
  }

  /**
   * Compare-and-swap rotation: succeeds only if the presented token is still
   * the current one, so two concurrent refreshes cannot both win.
   */
  async rotate(id: string, currentHash: string, nextHash: string, expiresAt: Date): Promise<boolean> {
    const now = new Date();
    const { count } = await this.client.userSession.updateMany({
      where: { id, tokenHash: currentHash, revokedAt: null },
      data: {
        previousTokenHash: currentHash,
        tokenHash: nextHash,
        rotatedAt: now,
        lastUsedAt: now,
        expiresAt,
      },
    });
    return count === 1;
  }

  async setActiveTenant(id: string, tenantId: string): Promise<void> {
    await this.client.userSession.update({
      where: { id },
      data: { activeTenantId: tenantId, lastUsedAt: new Date() },
      select: { id: true },
    });
  }

  async revoke(id: string, reason: string): Promise<void> {
    await this.client.userSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  async revokeAllForUser(userId: string, reason: string): Promise<number> {
    const { count } = await this.client.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  }
}
