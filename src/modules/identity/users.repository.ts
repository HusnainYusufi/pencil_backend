import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../core/database/base.repository.js';
import type { Prisma, User } from '../../generated/prisma/client.js';

@Injectable()
export class UsersRepository extends BaseRepository {
  findById(id: string): Promise<User | null> {
    return this.client.user.findUnique({ where: { id } });
  }

  /** `email` must already be normalized (normalizeEmail()). */
  findByEmail(email: string): Promise<User | null> {
    return this.client.user.findUnique({ where: { email } });
  }

  create(data: Prisma.UserCreateInput): Promise<User> {
    return this.client.user.create({ data });
  }

  /**
   * Atomically counts a failed login; on reaching `maxAttempts` the account
   * is locked for `lockoutMs` and the counter resets. Single statement, so
   * parallel brute-force attempts cannot race past the limit.
   */
  async registerFailedLogin(id: string, maxAttempts: number, lockoutMs: number): Promise<void> {
    await this.client.$executeRaw`
      UPDATE users SET
        failed_login_attempts = CASE WHEN failed_login_attempts + 1 >= ${maxAttempts} THEN 0 ELSE failed_login_attempts + 1 END,
        locked_until = CASE WHEN failed_login_attempts + 1 >= ${maxAttempts}
                            THEN now() + make_interval(secs => ${lockoutMs / 1000}) ELSE locked_until END,
        updated_at = now()
      WHERE id = ${id}::uuid`;
  }

  async registerSuccessfulLogin(id: string): Promise<void> {
    await this.client.user.update({
      where: { id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
      select: { id: true },
    });
  }
}
