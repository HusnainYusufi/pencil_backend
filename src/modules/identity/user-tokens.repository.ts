import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../core/database/base.repository.js';
import type { Prisma, User, UserToken, UserTokenPurpose } from '../../generated/prisma/client.js';

export type UserTokenWithUser = UserToken & { user: User };

/** Emailed single-use links (global table: links are opened before sign-in). */
@Injectable()
export class UserTokensRepository extends BaseRepository {
  create(data: Prisma.UserTokenUncheckedCreateInput): Promise<UserToken> {
    return this.client.userToken.create({ data });
  }

  findWithUser(id: string): Promise<UserTokenWithUser | null> {
    return this.client.userToken.findUnique({ where: { id }, include: { user: true } });
  }

  /** Compare-and-set: only one use can win. */
  async markUsed(id: string): Promise<boolean> {
    const { count } = await this.client.userToken.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date() } });
    return count === 1;
  }

  /** Retires earlier open links of the same kind (a new invite or reset supersedes them). */
  async retireOpen(userId: string, purpose: UserTokenPurpose, tenantId?: string | null): Promise<void> {
    await this.client.userToken.updateMany({
      where: { userId, purpose, usedAt: null, ...(tenantId !== undefined && { tenantId }) },
      data: { usedAt: new Date() },
    });
  }

  lastIssuedAt(userId: string, purpose: UserTokenPurpose): Promise<{ createdAt: Date } | null> {
    return this.client.userToken.findFirst({ where: { userId, purpose }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  }
}
