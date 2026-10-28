import { Injectable } from '@nestjs/common';
import { TenantScopedRepository } from '../../../core/database/base.repository.js';

/**
 * The slice of contacts and tax codes the posting engine validates against.
 * Lives in accounting (not in the contacts / tax modules) so the ledger never
 * depends on the modules built on top of it.
 */
@Injectable()
export class PartiesRepository extends TenantScopedRepository {
  findContacts(ids: readonly string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.client.contact.findMany({
      where: { tenantId: this.tenantId, id: { in: [...ids] } },
      select: { id: true, isCustomer: true, isSupplier: true, isActive: true },
    });
  }

  findTaxCodes(ids: readonly string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.client.taxCode.findMany({
      where: { tenantId: this.tenantId, id: { in: [...ids] } },
      select: { id: true, isActive: true, kind: true },
    });
  }
}
