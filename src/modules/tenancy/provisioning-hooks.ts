import { Injectable } from '@nestjs/common';
import type { CountryCode } from '../../generated/prisma/enums.js';

export interface ProvisionedTenant {
  id: string;
  country: CountryCode;
  baseCurrency: string;
  timezone: string;
  fiscalYearStartMonth: number;
}

/**
 * Lets feature modules (accounting, e-invoicing, ...) initialise a new
 * company without the tenancy module depending on them. Hooks run inside the
 * provisioning transaction under system scope: if any hook fails, the whole
 * company creation rolls back.
 */
export interface TenantProvisioningHook {
  readonly name: string;
  onTenantProvisioned(tenant: ProvisionedTenant): Promise<void>;
}

@Injectable()
export class TenantProvisioningHooks {
  private readonly hooks: TenantProvisioningHook[] = [];

  register(hook: TenantProvisioningHook): void {
    if (this.hooks.some((h) => h.name === hook.name)) {
      throw new Error(`Provisioning hook '${hook.name}' registered twice`);
    }
    this.hooks.push(hook);
  }

  list(): readonly TenantProvisioningHook[] {
    return this.hooks;
  }
}
