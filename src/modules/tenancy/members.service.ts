import { Injectable } from '@nestjs/common';
import type { Page } from '../../common/helpers/pagination.js';
import { RequestContext } from '../../core/context/request-context.service.js';
import { Db } from '../../core/database/db.service.js';
import { AppException } from '../../core/errors/app.exception.js';
import { ErrorCode } from '../../core/errors/error-codes.js';
import { AccessCache } from '../../core/security/access-cache.js';
import { OWNER_ROLE_KEY } from '../access/system-roles.js';
import { AuditService } from '../audit/audit.service.js';
import { normalizeEmail } from '../../common/helpers/string.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { Feature } from '../entitlements/features.js';
import { AccountLinksService } from '../identity/account-links.service.js';
import { UsersRepository } from '../identity/users.repository.js';
import type { InviteMemberDto, MembersQueryDto, UpdateMemberRoleDto } from './dto/tenancy.dto.js';
import { TenantsRepository } from './repositories/tenants.repository.js';
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
    private readonly users: UsersRepository,
    private readonly tenants: TenantsRepository,
    private readonly links: AccountLinksService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /**
   * Invites someone by email. New people get an account without a password
   * (set from the link); existing Pencil users just join. Either way the
   * membership is INVITED until the link is accepted. Counts against the
   * plan's user limit.
   */
  async invite(dto: InviteMemberDto): Promise<{ member: MemberView; emailSent: boolean }> {
    const actor = this.ctx.requireUser();
    const tenantId = this.ctx.requireTenantId();
    const email = normalizeEmail(dto.email);

    const { membershipId, userId } = await this.db.transaction(async () => {
      const role = await this.roles.findById(dto.roleId);
      if (!role) throw AppException.notFound('Role', dto.roleId);
      if (role.key === OWNER_ROLE_KEY && actor.roleKey !== OWNER_ROLE_KEY) {
        throw AppException.forbidden('Only an owner can invite another owner');
      }
      await this.entitlements.assertWithinLimit(tenantId, Feature.USERS_LIMIT, await this.memberships.countActive(tenantId));

      const user = (await this.users.findByEmail(email)) ?? (await this.users.create({ email, passwordHash: null, fullName: dto.fullName.trim() }));
      const existing = await this.memberships.findByTenantUser(tenantId, user.id);
      if (existing?.status === 'ACTIVE') throw new AppException(ErrorCode.CONFLICT, 'This person is already a member', { field: 'email' });
      const membership = existing ?? (await this.memberships.create({ tenantId, userId: user.id, roleId: role.id, status: 'INVITED' }));
      if (existing && existing.roleId !== role.id) await this.memberships.updateRole(tenantId, existing.id, role.id);
      await this.audit.record({ action: 'member.invited', entityType: 'membership', entityId: membership.id, metadata: { email, role: role.key } });
      return { membershipId: membership.id, userId: user.id };
    });

    const emailSent = await this.sendInvitation(tenantId, userId, actor.userId);
    return { member: (await this.memberships.findMember(tenantId, membershipId))!, emailSent };
  }

  async resendInvitation(membershipId: string): Promise<{ emailSent: boolean }> {
    const actor = this.ctx.requireUser();
    const tenantId = this.ctx.requireTenantId();
    const member = await this.memberships.findMember(tenantId, membershipId);
    if (!member) throw AppException.notFound('Member', membershipId);
    if (member.status !== 'INVITED') throw new AppException(ErrorCode.CONFLICT, 'This member already accepted the invitation');
    return { emailSent: await this.sendInvitation(tenantId, member.user.id, actor.userId) };
  }

  async revokeInvitation(membershipId: string): Promise<void> {
    const tenantId = this.ctx.requireTenantId();
    await this.db.transaction(async () => {
      if (!(await this.memberships.deleteInvited(tenantId, membershipId))) {
        throw new AppException(ErrorCode.CONFLICT, 'Only pending invitations can be withdrawn');
      }
      await this.audit.record({ action: 'member.invitation_revoked', entityType: 'membership', entityId: membershipId });
    });
  }

  private async sendInvitation(tenantId: string, userId: string, inviterId: string | null): Promise<boolean> {
    const [tenant, user, inviter] = await Promise.all([
      this.tenants.findById(tenantId),
      this.users.findById(userId),
      inviterId ? this.users.findById(inviterId) : null,
    ]);
    return this.links.sendInvitation({
      user: user!,
      tenantId,
      companyName: tenant!.tradeName ?? tenant!.legalName,
      inviterName: inviter?.fullName ?? null,
      invitedById: inviterId,
    });
  }

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
