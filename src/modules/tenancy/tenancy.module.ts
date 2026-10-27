import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { MembersService } from './members.service.js';
import { TenantProvisioningHooks } from './provisioning-hooks.js';
import { MembershipsRepository } from './repositories/memberships.repository.js';
import { RolesRepository } from './repositories/roles.repository.js';
import { SubscriptionsRepository } from './repositories/subscriptions.repository.js';
import { TenantsRepository } from './repositories/tenants.repository.js';
import { RolesService } from './roles.service.js';
import { MembersController, RolesController, TenantController } from './tenancy.controllers.js';
import { TenantProvisioningService } from './tenant-provisioning.service.js';
import { TenantService } from './tenant.service.js';

@Module({
  imports: [CatalogModule],
  controllers: [TenantController, RolesController, MembersController],
  providers: [
    TenantsRepository,
    MembershipsRepository,
    RolesRepository,
    SubscriptionsRepository,
    TenantProvisioningService,
    TenantProvisioningHooks,
    TenantService,
    RolesService,
    MembersService,
  ],
  exports: [
    TenantsRepository,
    MembershipsRepository,
    SubscriptionsRepository,
    TenantProvisioningService,
    TenantProvisioningHooks,
  ],
})
export class TenancyModule {}
