import { Injectable } from '@nestjs/common';
import { TenantScopedRepository } from '../../../core/database/base.repository.js';

/**
 * Gapless counters. The single UPSERT row-locks the series until the
 * surrounding transaction ends: concurrent posters queue, and a rollback
 * returns the number. Must be called inside the posting transaction.
 */
@Injectable()
export class NumberSeriesRepository extends TenantScopedRepository {
  async next(docType: string, year: number): Promise<number> {
    if (!this.db.inTransaction) {
      throw new Error('NumberSeriesRepository.next() must run inside the document transaction');
    }
    const tenantId = this.tenantId;
    const [row] = await this.inScope(
      (client) => client.$queryRaw<{ value: number }[]>`
        INSERT INTO number_series (tenant_id, doc_type, year, next_value)
        VALUES (${tenantId}::uuid, ${docType}, ${year}, 2)
        ON CONFLICT (tenant_id, doc_type, year)
        DO UPDATE SET next_value = number_series.next_value + 1
        RETURNING next_value - 1 AS value`,
    );
    return Number(row!.value);
  }
}
