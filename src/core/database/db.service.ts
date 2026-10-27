import { Injectable } from '@nestjs/common';
import { sleep } from '../../common/helpers/async.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { RequestContext } from '../context/request-context.service.js';
import { applyDbScope, createTenantScopedClient, type DbScope } from './prisma-tenant.extension.js';
import { isRetryableTransactionError } from './prisma-errors.js';
import { PrismaService } from './prisma.service.js';

/** What repositories query through: a transaction or the scoped client. */
export type DbClient = Prisma.TransactionClient;

export interface TransactionOptions {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  /** Max time the transaction may run (ms). Default 10s. */
  timeoutMs?: number;
  /** Max time to wait for a pooled connection (ms). Default 5s. */
  maxWaitMs?: number;
  /** Retries on serialization failure / deadlock. Default 2. */
  maxRetries?: number;
}

/**
 * Unit-of-work + tenant-scope boundary for all data access.
 *
 *  - `client`        what repositories use; joins the active transaction.
 *  - `transaction()` atomic unit of work; nested calls join the outer one.
 *  - `withTenant()`  run with a specific tenant's RLS scope (jobs, webhooks).
 *  - `asSystem()`    cross-tenant scope for platform operations. Grep-able
 *                    on purpose: every use deserves review.
 */
@Injectable()
export class Db {
  private readonly scopedClient: DbClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: RequestContext,
  ) {
    // Query-only extensions do not change model result types, so the
    // extended client is safely usable through the transaction-client type.
    this.scopedClient = createTenantScopedClient(prisma, () =>
      this.currentScope(),
    ) as unknown as DbClient;
  }

  get client(): DbClient {
    return this.ctx.get('tx') ?? this.scopedClient;
  }

  get inTransaction(): boolean {
    return this.ctx.get('tx') !== undefined;
  }

  async transaction<T>(fn: (tx: DbClient) => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    const active = this.ctx.get('tx');
    if (active) return fn(active);

    const scope = this.currentScope();
    const maxRetries = options.maxRetries ?? 2;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await applyDbScope(tx, scope);
            return this.ctx.run(async () => {
              this.ctx.set('tx', tx);
              return await fn(tx);
            });
          },
          {
            isolationLevel: options.isolationLevel,
            timeout: options.timeoutMs ?? 10_000,
            maxWait: options.maxWaitMs ?? 5_000,
          },
        );
      } catch (error) {
        if (attempt >= maxRetries || !isRetryableTransactionError(error)) throw error;
        await sleep(25 * 2 ** attempt + Math.random() * 25);
      }
    }
  }

  withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    this.assertNoTransaction('withTenant');
    return this.ctx.run(async () => {
      this.ctx.set('tenantId', tenantId);
      this.ctx.set('bypassRls', false);
      // Await inside the scope: Prisma queries are lazy thenables that would
      // otherwise execute after the scope has been left.
      return await fn();
    });
  }

  asSystem<T>(fn: () => Promise<T>): Promise<T> {
    this.assertNoTransaction('asSystem');
    return this.ctx.run(async () => {
      this.ctx.set('bypassRls', true);
      return await fn();
    });
  }

  private currentScope(): DbScope {
    return { tenantId: this.ctx.tenantId ?? null, bypassRls: this.ctx.bypassRls };
  }

  private assertNoTransaction(method: string): void {
    if (this.inTransaction) {
      throw new Error(`Db.${method}() cannot change scope inside an active transaction`);
    }
  }
}
