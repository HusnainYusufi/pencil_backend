import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../core/context/request-context.service.js';
import { Db } from '../../../core/database/db.service.js';
import { isUniqueViolation } from '../../../core/database/prisma-errors.js';
import { AppException } from '../../../core/errors/app.exception.js';
import { ErrorCode } from '../../../core/errors/error-codes.js';
import type { Branch, CostCenter } from '../../../generated/prisma/client.js';
import { AuditService } from '../../audit/audit.service.js';
import { EntitlementsService } from '../../entitlements/entitlements.service.js';
import { Feature } from '../../entitlements/features.js';
import type { CreateDimensionDto, UpdateDimensionDto } from '../dto/dimensions.dto.js';
import { DimensionsRepository } from '../repositories/dimensions.repository.js';

@Injectable()
export class DimensionsService {
  constructor(
    private readonly db: Db,
    private readonly ctx: RequestContext,
    private readonly dimensions: DimensionsRepository,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
  ) {}

  listBranches(includeInactive: boolean): Promise<Branch[]> {
    return this.dimensions.listBranches(includeInactive);
  }

  /** Limited by the plan's `branches.max`. */
  async createBranch(dto: CreateDimensionDto): Promise<Branch> {
    return this.db.transaction(async () => {
      await this.entitlements.assertWithinLimit(
        this.ctx.requireTenantId(),
        Feature.BRANCHES_LIMIT,
        await this.dimensions.countActiveBranches(),
      );
      const branch = await this.dimensions.createBranch(dto).catch(this.duplicateCode(dto.code));
      await this.audit.record({ action: 'branch.created', entityType: 'branch', entityId: branch.id, metadata: { code: branch.code } });
      return branch;
    });
  }

  async updateBranch(id: string, dto: UpdateDimensionDto): Promise<Branch> {
    return this.db.transaction(async () => {
      const branch = await this.dimensions.findBranch(id);
      if (!branch) throw AppException.notFound('Branch', id);
      if (dto.isActive === false && branch.isDefault) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', [
          { field: 'isActive', errors: ['the default branch cannot be deactivated'] },
        ]);
      }
      if (dto.isActive === true && !branch.isActive) {
        await this.entitlements.assertWithinLimit(
          this.ctx.requireTenantId(),
          Feature.BRANCHES_LIMIT,
          await this.dimensions.countActiveBranches(),
        );
      }
      const updated = await this.dimensions.updateBranch(id, dto);
      await this.audit.record({ action: 'branch.updated', entityType: 'branch', entityId: id, metadata: { changes: Object.keys(dto) } });
      return updated;
    });
  }

  listCostCenters(includeInactive: boolean): Promise<CostCenter[]> {
    return this.dimensions.listCostCenters(includeInactive);
  }

  async createCostCenter(dto: CreateDimensionDto): Promise<CostCenter> {
    return this.db.transaction(async () => {
      const costCenter = await this.dimensions.createCostCenter(dto).catch(this.duplicateCode(dto.code));
      await this.audit.record({ action: 'cost_center.created', entityType: 'cost_center', entityId: costCenter.id, metadata: { code: costCenter.code } });
      return costCenter;
    });
  }

  async updateCostCenter(id: string, dto: UpdateDimensionDto): Promise<CostCenter> {
    return this.db.transaction(async () => {
      if (!(await this.dimensions.findCostCenter(id))) throw AppException.notFound('Cost center', id);
      const updated = await this.dimensions.updateCostCenter(id, dto);
      await this.audit.record({ action: 'cost_center.updated', entityType: 'cost_center', entityId: id, metadata: { changes: Object.keys(dto) } });
      return updated;
    });
  }

  private duplicateCode(code: string) {
    return (error: unknown): never => {
      if (isUniqueViolation(error, 'code')) {
        throw new AppException(ErrorCode.CONFLICT, `Code '${code}' is already used`, { field: 'code' });
      }
      throw error;
    };
  }
}
