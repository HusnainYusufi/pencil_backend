import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../../core/database/base.repository.js';
import type { PlatformAdmin, PlatformAdminRole, PlatformSession } from '../../../generated/prisma/client.js';

export type PlatformSessionWithAdmin = PlatformSession & {
  admin: { isActive: boolean; role: PlatformAdminRole };
};

@Injectable()
export class PlatformAdminsRepository extends BaseRepository {
  findById(id: string): Promise<PlatformAdmin | null> {
    return this.client.platformAdmin.findUnique({ where: { id } });
  }

  findByEmail(email: string): Promise<PlatformAdmin | null> {
    return this.client.platformAdmin.findUnique({ where: { email } });
  }

  /** See UsersRepository.registerFailedLogin: atomic count + lockout. */
  async registerFailedLogin(id: string, maxAttempts: number, lockoutMs: number): Promise<void> {
    await this.client.$executeRaw`
      UPDATE platform_admins SET
        failed_login_attempts = CASE WHEN failed_login_attempts + 1 >= ${maxAttempts} THEN 0 ELSE failed_login_attempts + 1 END,
        locked_until = CASE WHEN failed_login_attempts + 1 >= ${maxAttempts}
                            THEN now() + make_interval(secs => ${lockoutMs / 1000}) ELSE locked_until END,
        updated_at = now()
      WHERE id = ${id}::uuid`;
  }

  async registerSuccessfulLogin(id: string): Promise<void> {
    await this.client.platformAdmin.update({
      where: { id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
      select: { id: true },
    });
  }

  createSession(data: {
    adminId: string;
    tokenHash: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<PlatformSession> {
    return this.client.platformSession.create({ data });
  }

  findSession(id: string): Promise<PlatformSessionWithAdmin | null> {
    return this.client.platformSession.findUnique({
      where: { id },
      include: { admin: { select: { isActive: true, role: true } } },
    });
  }

  async rotateSession(id: string, currentHash: string, nextHash: string): Promise<boolean> {
    const now = new Date();
    const { count } = await this.client.platformSession.updateMany({
      where: { id, tokenHash: currentHash, revokedAt: null },
      // Absolute expiry: staff sessions are not extended by refreshing.
      data: { previousTokenHash: currentHash, tokenHash: nextHash, rotatedAt: now, lastUsedAt: now },
    });
    return count === 1;
  }

  async revokeSession(id: string, reason: string): Promise<void> {
    await this.client.platformSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }
}
