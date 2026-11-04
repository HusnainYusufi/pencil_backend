import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { Db } from '../../core/database/db.service.js';
import { AccountingModule } from '../accounting/accounting.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { TenantProvisioningHooks, type ProvisionedTenant, type TenantProvisioningHook } from '../tenancy/provisioning-hooks.js';
import { bootstrapTaxRates } from './bootstrap-tax.js';
import { TaxRatesController, VatReturnController } from './tax.controller.js';
import { VatReturnRepository, VatReturnService } from './vat-return.service.js';
import { TaxRatesRepository } from './tax-rates.repository.js';
import { TaxRatesService } from './tax-rates.service.js';

/** Seeds the country's tax rates into every new company (after accounting). */
@Injectable()
export class TaxBootstrapService implements TenantProvisioningHook, OnModuleInit {
  readonly name = 'tax';

  constructor(
    private readonly hooks: TenantProvisioningHooks,
    private readonly db: Db,
  ) {}

  onModuleInit(): void {
    this.hooks.register(this);
  }

  async onTenantProvisioned(tenant: ProvisionedTenant): Promise<void> {
    await bootstrapTaxRates(this.db.client, tenant);
  }
}

/**
 * Indirect tax (VAT / GST / sales tax) rates per company. Shared by sales
 * today and purchases later. Imports AccountingModule so the accounting
 * provisioning hook (chart of accounts) is registered, and runs, first.
 */
@Module({
  imports: [TenancyModule, AccountingModule],
  controllers: [TaxRatesController, VatReturnController],
  providers: [TaxRatesRepository, TaxRatesService, TaxBootstrapService, VatReturnRepository, VatReturnService],
  exports: [TaxRatesRepository, TaxRatesService],
})
export class TaxModule {}
