import { Injectable, OnModuleInit } from '@nestjs/common';
import { todayIn } from '../../common/helpers/date.js';
import { TenantProvisioningHooks, type ProvisionedTenant, type TenantProvisioningHook } from '../tenancy/provisioning-hooks.js';
import { chartOfAccountsTemplate, templateLevels } from './chart-of-accounts/templates.js';
import { fiscalYearContaining, fiscalYearName, monthlyPeriods } from './fiscal/fiscal-calendar.js';
import { AccountsRepository } from './repositories/accounts.repository.js';
import { DimensionsRepository } from './repositories/dimensions.repository.js';
import { FiscalRepository } from './repositories/fiscal.repository.js';

/**
 * Makes a new company ready to book transactions on day one: country chart
 * of accounts, main branch and the current fiscal year with 12 open periods.
 * Runs inside the provisioning transaction.
 */
@Injectable()
export class AccountingBootstrapService implements TenantProvisioningHook, OnModuleInit {
  readonly name = 'accounting';

  constructor(
    private readonly hooks: TenantProvisioningHooks,
    private readonly accounts: AccountsRepository,
    private readonly dimensions: DimensionsRepository,
    private readonly fiscal: FiscalRepository,
  ) {}

  onModuleInit(): void {
    this.hooks.register(this);
  }

  async onTenantProvisioned(tenant: ProvisionedTenant): Promise<void> {
    await this.accounts.createFromTemplate(tenant.id, templateLevels(chartOfAccountsTemplate(tenant.country)));
    await this.dimensions.createDefaultBranch(tenant.id);
    const year = fiscalYearContaining(todayIn(tenant.timezone), tenant.fiscalYearStartMonth);
    await this.fiscal.createYear(tenant.id, { ...year, name: fiscalYearName(year) }, monthlyPeriods(year));
  }
}
