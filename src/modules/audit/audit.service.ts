import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../core/context/request-context.service.js';
import { Db } from '../../core/database/db.service.js';
import type { ActorType, Prisma } from '../../generated/prisma/client.js';
import { AuditRepository } from './audit.repository.js';

export interface AuditEvent {
  /** Dotted verb, e.g. `auth.login`, `role.updated`. */
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonObject;
  /** Defaults to the current tenant; `null` = platform-level event. */
  tenantId?: string | null;
  /** Defaults to the authenticated actor (needed before auth completes). */
  actor?: { type: ActorType; id: string | null };
}

/**
 * Append-only audit trail (who did what, when, from where). Called inside a
 * service's transaction, the entry commits or rolls back with the change.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly repository: AuditRepository,
    private readonly ctx: RequestContext,
    private readonly db: Db,
  ) {}

  async record(event: AuditEvent): Promise<void> {
    const tenantId = event.tenantId !== undefined ? event.tenantId : (this.ctx.tenantId ?? null);
    const actor = event.actor ?? this.currentActor();
    const data: Prisma.AuditLogUncheckedCreateInput = {
      tenantId,
      actorType: actor.type,
      actorId: actor.id,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      metadata: event.metadata,
      ipAddress: this.ctx.ip,
      userAgent: this.ctx.userAgent,
      requestId: this.ctx.requestId,
    };

    const scopeAllowsWrite =
      this.db.inTransaction || this.ctx.bypassRls || (tenantId !== null && tenantId === this.ctx.tenantId);
    if (scopeAllowsWrite) return this.repository.insert(data);
    // Pre-authentication or cross-tenant events (e.g. a login): the audit
    // writer itself is trusted system code.
    return this.db.asSystem(() => this.repository.insert(data));
  }

  private currentActor(): { type: ActorType; id: string | null } {
    const actor = this.ctx.actor;
    switch (actor?.type) {
      case 'user':
        return { type: 'USER', id: actor.userId };
      case 'platform_admin':
        return { type: 'PLATFORM_ADMIN', id: actor.adminId };
      default:
        return { type: 'SYSTEM', id: null };
    }
  }
}
