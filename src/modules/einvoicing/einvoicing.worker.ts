import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service.js';
import { RequestContext } from '../../core/context/request-context.service.js';
import { Db } from '../../core/database/db.service.js';
import { EInvoiceQueueRepository } from './einvoicing.repositories.js';
import { EInvoicingService } from './einvoicing.service.js';

const BATCH = 20;
/** A claimed submission is invisible to other workers for this long. */
const LEASE_SECONDS = 300;

/**
 * Retries pending submissions (authority outage, network failure, and
 * simplified invoices that must be reported within 24 hours). Safe to run on
 * every API instance: rows are claimed with SKIP LOCKED and a lease.
 */
@Injectable()
export class EInvoiceSubmissionWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(EInvoiceSubmissionWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: AppConfig,
    private readonly ctx: RequestContext,
    private readonly db: Db,
    private readonly queue: EInvoiceQueueRepository,
    private readonly einvoicing: EInvoicingService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('EINVOICING_WORKER_ENABLED') || this.config.isTest) return;
    const intervalMs = this.config.get('EINVOICING_WORKER_INTERVAL_SECONDS') * 1000;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass over due submissions. Public for tests and manual runs. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const due = await this.db.asSystem(() => this.queue.claimDue(BATCH, LEASE_SECONDS));
      for (const item of due) {
        await this.ctx
          .run(async () => {
            this.ctx.set('actor', { type: 'system', name: 'einvoicing-worker' });
            await this.db.withTenant(item.tenant_id, () => this.einvoicing.submit(item.id));
          })
          .catch((error: unknown) => this.logger.error(`e-invoice ${item.id}: ${(error as Error).message}`));
      }
      return due.length;
    } catch (error) {
      this.logger.error(`e-invoice worker pass failed: ${(error as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
