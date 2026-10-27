import { Injectable } from '@nestjs/common';
import type { Page } from '../../common/helpers/pagination.js';
import { RequestContext } from '../../core/context/request-context.service.js';
import { Db } from '../../core/database/db.service.js';
import { AppException } from '../../core/errors/app.exception.js';
import { ErrorCode } from '../../core/errors/error-codes.js';
import { AccessCache } from '../../core/security/access-cache.js';
import { OWNER_ROLE_KEY } from '../access/system-roles.js';
import { AuditService } from '../audit/audit.service.js';
import type { MembersQueryDto, UpdateMemberRoleDto } from './dto/tenancy.dto.js';
import { MembershipsRepository, type MemberView } from './repositories/memberships.repository.js';
import { RolesRepository } from './repositories/roles.repository.js';

@Injectable()
export class MembersService {
  constructor(
    private readonly db: Db,
    private readonly ctx: RequestContext,
    private readonly memberships: MembershipsRepository,
    private readonly roles: RolesRepository,
    private readonly audit: AuditService,
    private readonly accessCache: AccessCache,
  ) {}

  list(query: MembersQueryDto): Promise<Page<MemberView>> {
    return this.memberships.listForTenant(this.ctx.requireTenantId(), query);
  }

  /**
   * Escalation rules: nobody changes their own role, and only an owner may
   * grant or revoke the owner role. The last owner can never be demoted.
   */
  async changeRole(membershipId: string, dto: UpdateMemberRoleDto): Promise<MemberView> {
    const actor = this.ctx.requireUser();
    const tenantId = this.ctx.requireTenantId();

    const updated = await this.db.transaction(async () => {
      const member = await this.memberships.findMember(tenantId, membershipId);
      if (!member) throw AppException.notFound('Member', membershipId);
      if (member.user.id === actor.userId) {
        throw AppException.forbidden('You cannot change your own role');
      }
      const role = await this.roles.findById(dto.roleId);
      if (!role) throw AppException.notFound('Role', dto.roleId);
      if (role.id === member.role.id) return member;

      const touchesOwner = role.key === OWNER_ROLE_KEY || member.role.key === OWNER_ROLE_KEY;
      if (touchesOwner && actor.roleKey !== OWNER_ROLE_KEY) {
        throw AppException.forbidden('Only an owner can grant or revoke the owner role');
      }
      if (member.role.key === OWNER_ROLE_KEY && (await this.memberships.countByRole(tenantId, member.role.id)) <= 1) {
        throw new AppException(ErrorCode.LAST_OWNER, 'A company must keep at least one owner');
      }

      const result = await this.memberships.updateRole(tenantId, membershipId, role.id);
      await this.audit.record({
        action: 'member.role_changed',
        entityType: 'membership',
        entityId: membershipId,
        metadata: { userId: member.user.id, from: member.role.key, to: role.key },
      });
      return result;
    });

    this.accessCache.invalidateUser(updated.user.id);
    return updated;
  }
}
