import { Injectable } from '@nestjs/common';
import { randomAlphanumeric, slugify } from '../../common/helpers/string.js';
import { Db } from '../../core/database/db.service.js';
import { AppException } from '../../core/errors/app.exception.js';
import { ErrorCode } from '../../core/errors/error-codes.js';
import { AccessCache } from '../../core/security/access-cache.js';
import type { Role } from '../../generated/prisma/client.js';
import { isGrantablePermission } from '../access/permissions.js';
import { systemRolePermissions } from '../access/system-roles.js';
import { AuditService } from '../audit/audit.service.js';
import type { CreateRoleDto, UpdateRoleDto } from './dto/tenancy.dto.js';
import { MembershipsRepository } from './repositories/memberships.repository.js';
import { RolesRepository } from './repositories/roles.repository.js';

@Injectable()
export class RolesService {
  constructor(
    private readonly db: Db,
    private readonly roles: RolesRepository,
    private readonly memberships: MembershipsRepository,
    private readonly audit: AuditService,
    private readonly accessCache: AccessCache,
  ) {}

  /** System roles report their live (code-defined) permissions. */
  async list(): Promise<Role[]> {
    const roles = await this.roles.list();
    return roles.map((role) =>
      role.isSystem ? { ...role, permissions: [...(systemRolePermissions(role.key) ?? role.permissions)] } : role,
    );
  }

  async create(dto: CreateRoleDto): Promise<Role> {
    const permissions = this.validatePermissions(dto.permissions);
    return this.db.transaction(async () => {
      const role = await this.roles.create({
        key: `${slugify(dto.name, 40) || 'role'}-${randomAlphanumeric(4)}`,
        name: dto.name.trim(),
        description: dto.description,
        permissions,
      });
      await this.audit.record({
        action: 'role.created',
        entityType: 'role',
        entityId: role.id,
        metadata: { name: role.name, permissions },
      });
      return role;
    });
  }

  async update(id: string, dto: UpdateRoleDto): Promise<Role> {
    const role = await this.getMutable(id);
    const permissions = dto.permissions ? this.validatePermissions(dto.permissions) : undefined;
    const updated = await this.db.transaction(async () => {
      const result = await this.roles.update(role.id, {
        name: dto.name?.trim(),
        description: dto.description,
        permissions,
      });
      await this.audit.record({
        action: 'role.updated',
        entityType: 'role',
        entityId: role.id,
        metadata: { before: { name: role.name, permissions: role.permissions }, after: { name: result.name, permissions: result.permissions } },
      });
      return result;
    });
    if (permissions) this.accessCache.invalidateTenant(role.tenantId);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const role = await this.getMutable(id);
    await this.db.transaction(async () => {
      if ((await this.memberships.countByRole(role.tenantId, role.id)) > 0) {
        throw new AppException(ErrorCode.ROLE_IN_USE, 'Reassign members of this role before deleting it');
      }
      await this.roles.delete(role.id);
      await this.audit.record({ action: 'role.deleted', entityType: 'role', entityId: role.id, metadata: { name: role.name } });
    });
  }

  private async getMutable(id: string): Promise<Role> {
    const role = await this.roles.findById(id);
    if (!role) throw AppException.notFound('Role', id);
    if (role.isSystem) {
      throw new AppException(ErrorCode.SYSTEM_ROLE_IMMUTABLE, 'System roles cannot be modified');
    }
    return role;
  }

  private validatePermissions(requested: string[]): string[] {
    const unique = [...new Set(requested.map((p) => p.trim()))];
    const invalid = unique.filter((p) => !isGrantablePermission(p));
    if (invalid.length > 0) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown permissions', [
        { field: 'permissions', errors: invalid.map((p) => `'${p}' is not a grantable permission`) },
      ]);
    }
    return unique.sort();
  }
}
