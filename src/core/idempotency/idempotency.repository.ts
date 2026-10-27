import { Injectable } from '@nestjs/common';
import { Prisma, type IdempotencyKey } from '../../generated/prisma/client.js';
import { BaseRepository } from '../database/base.repository.js';
import { isUniqueViolation } from '../database/prisma-errors.js';

export interface AcquireInput {
  scope: string;
  key: string;
  method: string;
  path: string;
  requestHash: string;
  lockMs: number;
  ttlMs: number;
}

export type AcquireResult = { acquired: true; id: string } | { acquired: false; existing: IdempotencyKey };

@Injectable()
export class IdempotencyRepository extends BaseRepository {
  async acquire(input: AcquireInput): Promise<AcquireResult> {
    const now = Date.now();
    try {
      const row = await this.client.idempotencyKey.create({
        data: {
          scope: input.scope,
          key: input.key,
          method: input.method,
          path: input.path,
          requestHash: input.requestHash,
          status: 'IN_PROGRESS',
          lockedUntil: new Date(now + input.lockMs),
          expiresAt: new Date(now + input.ttlMs),
        },
        select: { id: true },
      });
      return { acquired: true, id: row.id };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.client.idempotencyKey.findUnique({
        where: { scope_key: { scope: input.scope, key: input.key } },
      });
      if (!existing) throw error;
      return { acquired: false, existing };
    }
  }

  /** Claims an abandoned (lock-expired) in-progress key. */
  async takeOver(id: string, lockMs: number): Promise<boolean> {
    const now = new Date();
    const { count } = await this.client.idempotencyKey.updateMany({
      where: { id, status: 'IN_PROGRESS', lockedUntil: { lt: now } },
      data: { lockedUntil: new Date(now.getTime() + lockMs) },
    });
    return count === 1;
  }

  async complete(id: string, responseStatus: number, responseBody: unknown): Promise<void> {
    await this.client.idempotencyKey.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        responseStatus,
        responseBody: responseBody === undefined ? Prisma.JsonNull : (responseBody as Prisma.InputJsonValue),
        lockedUntil: null,
      },
    });
  }

  async release(id: string): Promise<void> {
    await this.client.idempotencyKey.deleteMany({ where: { id, status: 'IN_PROGRESS' } });
  }

  async deleteExpired(now = new Date()): Promise<number> {
    const { count } = await this.client.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } });
    return count;
  }
}
