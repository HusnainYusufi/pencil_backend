import { Injectable } from '@nestjs/common';
import { TenantScopedRepository } from '../../../core/database/base.repository.js';

export interface BooksSettings {
  /** Nothing may be posted on or before this date. */
  lockDate: Date | null;
  /** Set when a tax return is filed; enforced like the lock date. */
  taxLockDate: Date | null;
  /** Cut-over date for opening balances; nothing is posted before it. */
  openingBalanceDate: Date | null;
}

const SETTINGS = { lockDate: true, taxLockDate: true, openingBalanceDate: true } as const;

/**
 * The company's book-keeping controls. Never cached: a lock date must apply
 * to the very next posting (the ledger trigger enforces it regardless).
 */
@Injectable()
export class BooksRepository extends TenantScopedRepository {
  async get(): Promise<BooksSettings> {
    const tenant = await this.client.tenant.findUnique({ where: { id: this.tenantId }, select: SETTINGS });
    return tenant ?? { lockDate: null, taxLockDate: null, openingBalanceDate: null };
  }

  update(data: Partial<BooksSettings>): Promise<BooksSettings> {
    return this.client.tenant.update({ where: { id: this.tenantId }, data, select: SETTINGS });
  }
}
