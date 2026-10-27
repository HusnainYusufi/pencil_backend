import { Injectable } from '@nestjs/common';
import { TenantScopedRepository } from '../../../core/database/base.repository.js';
import type { Role } from '../../../generated/prisma/client.js';
import { SYSTEM_ROLES } from '../../access/system-roles.js';

/** Tenant-scoped (RLS): every query is bound to the current tenant. */
@Injectable()
export class RolesRepository extends TenantScopedRepository {
  list(): Promise<Role[]> {
    return this.client.role.findMany({
      where: { tenantId: this.tenantId },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
  }

  findById(id: string): Promise<Role | null> {
    return this.client.role.findFirst({ where: { id, tenantId: this.tenantId } });
  }

  findByKey(key: string): Promise<Role | null> {
    return this.client.role.findUnique({ where: { tenantId_key: { tenantId: this.tenantId, key } } });
  }

  create(data: { key: string; name: string; description?: string; permissions: string[] }): Promise<Role> {
    return this.client.role.create({ data: { ...data, tenantId: this.tenantId, isSystem: false } });
  }

  update(id: string, data: { name?: string; description?: string | null; permissions?: string[] }): Promise<Role> {
    return this.client.role.update({ where: { id, tenantId: this.tenantId }, data });
  }

  async delete(id: string): Promise<void> {
    await this.client.role.delete({ where: { id, tenantId: this.tenantId } });
  }

  /**
   * Seeds the immutable system roles for a NEW tenant (provisioning runs in
   * system scope, so the tenant id is explicit here). Returns key -> role id.
   */
  async createSystemRoles(tenantId: string): Promise<Map<string, string>> {
    const roles = await this.client.role.createManyAndReturn({
      data: SYSTEM_ROLES.map((r) => ({
        tenantId,
        key: r.key,
        name: r.name,
        description: r.description,
        permissions: [...r.permissions],
        isSystem: true,
      })),
      select: { id: true, key: true },
    });
    return new Map(roles.map((r) => [r.key, r.id]));
  }
}
