import { Injectable, OnModuleInit } from '@nestjs/common';
import { Db } from '../../core/database/db.service.js';
import { TenantProvisioningHooks, type ProvisionedTenant, type TenantProvisioningHook } from '../tenancy/provisioning-hooks.js';
import { bootstrapAccounting } from './bootstrap-accounting.js';

/**
 * Seeds accounting for every new company, inside the provisioning
 * transaction (system scope). The same routine backfills older companies:
 * see prisma/backfill-accounting.ts.
 */
@Injectable()
export class AccountingBootstrapService implements TenantProvisioningHook, OnModuleInit {
  readonly name = 'accounting';

  constructor(
    private readonly hooks: TenantProvisioningHooks,
    private readonly db: Db,
  ) {}

  onModuleInit(): void {
    this.hooks.register(this);
  }

  async onTenantProvisioned(tenant: ProvisionedTenant): Promise<void> {
    await bootstrapAccounting(this.db.client, tenant);
  }
}
