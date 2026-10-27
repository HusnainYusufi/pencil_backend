import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../core/context/request-context.service.js';
import { Db } from '../../core/database/db.service.js';
import { AppException } from '../../core/errors/app.exception.js';
import type { Tenant } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { UpdateTenantDto } from './dto/tenancy.dto.js';
import { TenantsRepository } from './repositories/tenants.repository.js';
import { assertValidTaxNumber } from './tax-number.js';

@Injectable()
export class TenantService {
  constructor(
    private readonly db: Db,
    private readonly ctx: RequestContext,
    private readonly tenants: TenantsRepository,
    private readonly audit: AuditService,
  ) {}

  async getCurrent(): Promise<Tenant> {
    const tenant = await this.tenants.findById(this.ctx.requireTenantId());
    if (!tenant) throw AppException.notFound('Tenant');
    return tenant;
  }

  async updateCurrent(dto: UpdateTenantDto): Promise<Tenant> {
    const current = await this.getCurrent();
    assertValidTaxNumber(current.country, dto.taxNumber);

    return this.db.transaction(async () => {
      const updated = await this.tenants.update(current.id, dto);
      await this.audit.record({
        action: 'tenant.updated',
        entityType: 'tenant',
        entityId: current.id,
        metadata: { changes: Object.keys(dto) },
      });
      return updated;
    });
  }
}
