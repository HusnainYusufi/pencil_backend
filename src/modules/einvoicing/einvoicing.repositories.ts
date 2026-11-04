import { Injectable } from '@nestjs/common';
import { BaseRepository, TenantScopedRepository } from '../../core/database/base.repository.js';
import type { EInvoiceDocument, EInvoicingUnit, Prisma } from '../../generated/prisma/client.js';
import type { EInvoicingProvider } from '../../generated/prisma/enums.js';

@Injectable()
export class EInvoicingUnitsRepository extends TenantScopedRepository {
  list(): Promise<EInvoicingUnit[]> {
    return this.client.eInvoicingUnit.findMany({ where: { tenantId: this.tenantId }, orderBy: { createdAt: 'desc' } });
  }

  findById(id: string): Promise<EInvoicingUnit | null> {
    return this.client.eInvoicingUnit.findFirst({ where: { id, tenantId: this.tenantId } });
  }

  findActive(provider: EInvoicingProvider): Promise<EInvoicingUnit | null> {
    return this.client.eInvoicingUnit.findFirst({ where: { tenantId: this.tenantId, provider, status: 'ACTIVE' } });
  }

  create(data: Omit<Prisma.EInvoicingUnitUncheckedCreateInput, 'tenantId'>): Promise<EInvoicingUnit> {
    return this.client.eInvoicingUnit.create({ data: { ...data, tenantId: this.tenantId } });
  }

  update(id: string, data: Prisma.EInvoicingUnitUncheckedUpdateInput): Promise<EInvoicingUnit> {
    return this.client.eInvoicingUnit.update({ where: { id, tenantId: this.tenantId }, data });
  }

  async revokeActive(provider: EInvoicingProvider): Promise<void> {
    await this.client.eInvoicingUnit.updateMany({
      where: { tenantId: this.tenantId, provider, status: 'ACTIVE' },
      data: { status: 'REVOKED' },
    });
  }

  /**
   * Takes the next invoice counter value. The UPDATE row-locks the unit until
   * the issuing transaction ends, so the ICV / PIH chain is strictly serial
   * and a rollback returns the number (no gaps).
   */
  async takeNextCounter(unitId: string): Promise<{ icv: number; previousHash: string | null }> {
    const rows = await this.inScope((client) =>
      client.$queryRaw<{ last_icv: number; last_invoice_hash: string | null }[]>`
        UPDATE einvoicing_units SET last_icv = last_icv + 1, updated_at = now()
        WHERE id = ${unitId}::uuid AND tenant_id = ${this.tenantId}::uuid AND status = 'ACTIVE'
        RETURNING last_icv, last_invoice_hash`,
    );
    const row = rows[0];
    if (!row) throw new Error(`E-invoicing unit ${unitId} is not active`);
    return { icv: Number(row.last_icv), previousHash: row.last_invoice_hash };
  }

  async setLastHash(unitId: string, hash: string): Promise<void> {
    await this.client.eInvoicingUnit.updateMany({ where: { id: unitId, tenantId: this.tenantId }, data: { lastInvoiceHash: hash } });
  }
}

@Injectable()
export class EInvoiceDocumentsRepository extends TenantScopedRepository {
  create(data: Omit<Prisma.EInvoiceDocumentUncheckedCreateInput, 'tenantId'>): Promise<EInvoiceDocument> {
    return this.client.eInvoiceDocument.create({ data: { ...data, tenantId: this.tenantId } });
  }

  findById(id: string): Promise<EInvoiceDocument | null> {
    return this.client.eInvoiceDocument.findFirst({ where: { id, tenantId: this.tenantId } });
  }

  findByInvoice(invoiceId: string): Promise<EInvoiceDocument | null> {
    return this.client.eInvoiceDocument.findFirst({ where: { invoiceId, tenantId: this.tenantId } });
  }

  update(id: string, data: Prisma.EInvoiceDocumentUncheckedUpdateInput): Promise<EInvoiceDocument> {
    return this.client.eInvoiceDocument.update({ where: { id, tenantId: this.tenantId }, data });
  }

  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.client.eInvoiceDocument.groupBy({
      by: ['status'],
      where: { tenantId: this.tenantId },
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }
}

/** Cross-tenant queue access for the retry worker (system scope only). */
@Injectable()
export class EInvoiceQueueRepository extends BaseRepository {
  /**
   * Claims due submissions with a short lease (SKIP LOCKED + moving
   * next_attempt_at), so several API instances never submit the same one.
   */
  claimDue(limit: number, leaseSeconds: number): Promise<Array<{ id: string; tenant_id: string }>> {
    return this.inScope((client) =>
      client.$queryRaw<Array<{ id: string; tenant_id: string }>>`
        UPDATE einvoice_documents SET next_attempt_at = now() + ${leaseSeconds}::int * interval '1 second'
        WHERE id IN (
          SELECT id FROM einvoice_documents
          WHERE status = 'PENDING' AND (next_attempt_at IS NULL OR next_attempt_at <= now())
          ORDER BY created_at
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, tenant_id`,
    );
  }
}
