import { Injectable } from '@nestjs/common';
import { TenantScopedRepository } from '../../../core/database/base.repository.js';
import type { Branch, CostCenter, Prisma } from '../../../generated/prisma/client.js';

/** Analytic dimensions stamped on journal lines: branches and cost centers. */
@Injectable()
export class DimensionsRepository extends TenantScopedRepository {
  listBranches(includeInactive = false): Promise<Branch[]> {
    return this.client.branch.findMany({
      where: { tenantId: this.tenantId, ...(!includeInactive && { isActive: true }) },
      orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
    });
  }

  findBranch(id: string): Promise<Branch | null> {
    return this.client.branch.findFirst({ where: { id, tenantId: this.tenantId } });
  }

  countActiveBranches(): Promise<number> {
    return this.client.branch.count({ where: { tenantId: this.tenantId, isActive: true } });
  }

  createBranch(data: { code: string; name: string; nameAr?: string }): Promise<Branch> {
    return this.client.branch.create({ data: { ...data, tenantId: this.tenantId } });
  }

  updateBranch(id: string, data: Prisma.BranchUpdateInput): Promise<Branch> {
    return this.client.branch.update({ where: { id, tenantId: this.tenantId }, data });
  }

  /** Provisioning (system scope): the tenant's first, default branch. */
  createDefaultBranch(tenantId: string): Promise<Branch> {
    return this.client.branch.create({
      data: { tenantId, code: 'MAIN', name: 'Main branch', nameAr: 'الفرع الرئيسي', isDefault: true },
    });
  }

  listCostCenters(includeInactive = false): Promise<CostCenter[]> {
    return this.client.costCenter.findMany({
      where: { tenantId: this.tenantId, ...(!includeInactive && { isActive: true }) },
      orderBy: { code: 'asc' },
    });
  }

  findCostCenter(id: string): Promise<CostCenter | null> {
    return this.client.costCenter.findFirst({ where: { id, tenantId: this.tenantId } });
  }

  createCostCenter(data: { code: string; name: string; nameAr?: string }): Promise<CostCenter> {
    return this.client.costCenter.create({ data: { ...data, tenantId: this.tenantId } });
  }

  updateCostCenter(id: string, data: Prisma.CostCenterUpdateInput): Promise<CostCenter> {
    return this.client.costCenter.update({ where: { id, tenantId: this.tenantId }, data });
  }

  /** Returns the ids among `branchIds` / `costCenterIds` that are NOT active in this tenant. */
  async findInvalidDimensions(branchIds: string[], costCenterIds: string[]) {
    const [branches, costCenters] = await Promise.all([
      branchIds.length
        ? this.client.branch.findMany({
            where: { tenantId: this.tenantId, id: { in: branchIds }, isActive: true },
            select: { id: true },
          })
        : [],
      costCenterIds.length
        ? this.client.costCenter.findMany({
            where: { tenantId: this.tenantId, id: { in: costCenterIds }, isActive: true },
            select: { id: true },
          })
        : [],
    ]);
    const okBranches = new Set(branches.map((b) => b.id));
    const okCostCenters = new Set(costCenters.map((c) => c.id));
    return {
      branches: branchIds.filter((id) => !okBranches.has(id)),
      costCenters: costCenterIds.filter((id) => !okCostCenters.has(id)),
    };
  }
}
