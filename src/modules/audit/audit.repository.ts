import { Injectable } from '@nestjs/common';
import { buildCursorPage, decodeCursor, type CursorPage } from '../../common/helpers/pagination.js';
import { BaseRepository } from '../../core/database/base.repository.js';
import type { AuditLog, Prisma } from '../../generated/prisma/client.js';

export interface AuditListFilter {
  tenantId?: string | null;
  action?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  cursor?: string;
  limit: number;
}

/**
 * Tenant id is explicit (not taken from context) because platform-level
 * events have none. RLS still restricts which rows a tenant scope can see.
 */
@Injectable()
export class AuditRepository extends BaseRepository {
  async insert(data: Prisma.AuditLogUncheckedCreateInput): Promise<void> {
    await this.client.auditLog.create({ data, select: { id: true } });
  }

  /** Keyset pagination on the UUIDv7 id (time-ordered), newest first. */
  async list(filter: AuditListFilter): Promise<CursorPage<AuditLog>> {
    const cursor = filter.cursor ? decodeCursor<{ id: string }>(filter.cursor) : null;
    const rows = await this.client.auditLog.findMany({
      where: {
        ...(filter.tenantId !== undefined && { tenantId: filter.tenantId }),
        ...(filter.action && { action: filter.action }),
        ...(filter.entityType && { entityType: filter.entityType }),
        ...(filter.entityId && { entityId: filter.entityId }),
        ...(filter.actorId && { actorId: filter.actorId }),
        ...(cursor?.id && { id: { lt: cursor.id } }),
      },
      orderBy: { id: 'desc' },
      take: filter.limit + 1,
    });
    return buildCursorPage(rows, filter.limit, (row) => ({ id: row.id }));
  }
}
