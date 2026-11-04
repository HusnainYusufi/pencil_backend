import { Injectable } from '@nestjs/common';
import { TenantScopedRepository } from '../../core/database/base.repository.js';
import type { Prisma, TaxRate } from '../../generated/prisma/client.js';

@Injectable()
export class TaxRatesRepository extends TenantScopedRepository {
  list(includeInactive: boolean): Promise<TaxRate[]> {
    return this.client.taxRate.findMany({
      where: { tenantId: this.tenantId, ...(!includeInactive && { isActive: true }) },
      orderBy: [{ isDefault: 'desc' }, { category: 'asc' }, { code: 'asc' }],
    });
  }

  findById(id: string): Promise<TaxRate | null> {
    return this.client.taxRate.findFirst({ where: { id, tenantId: this.tenantId } });
  }

  findManyByIds(ids: string[]): Promise<TaxRate[]> {
    return this.client.taxRate.findMany({ where: { tenantId: this.tenantId, id: { in: ids } } });
  }

  findByCode(code: string): Promise<TaxRate | null> {
    return this.client.taxRate.findFirst({ where: { tenantId: this.tenantId, code } });
  }

  create(data: Omit<Prisma.TaxRateUncheckedCreateInput, 'tenantId'>): Promise<TaxRate> {
    return this.client.taxRate.create({ data: { ...data, tenantId: this.tenantId } });
  }

  update(id: string, data: Prisma.TaxRateUncheckedUpdateInput): Promise<TaxRate> {
    return this.client.taxRate.update({ where: { id, tenantId: this.tenantId }, data });
  }

  /** Before marking another rate as default (one default per company). */
  async clearDefault(): Promise<void> {
    await this.client.taxRate.updateMany({ where: { tenantId: this.tenantId, isDefault: true }, data: { isDefault: false } });
  }
}
