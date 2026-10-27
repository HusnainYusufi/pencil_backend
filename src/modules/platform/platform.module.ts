import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { EntitlementsModule } from '../entitlements/entitlements.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { FeatureOverridesRepository } from './feature-overrides.repository.js';
import { PlatformCatalogService } from './platform-catalog.service.js';
import { PlatformAuditController, PlatformCatalogController, PlatformTenantsController } from './platform.controllers.js';
import { PlatformTenantsService } from './platform-tenants.service.js';

/** Back-office API consumed by pencil_admin (tenants, plans, features, audit). */
@Module({
  imports: [AuthModule, CatalogModule, EntitlementsModule, IdentityModule, TenancyModule],
  controllers: [PlatformTenantsController, PlatformCatalogController, PlatformAuditController],
  providers: [PlatformTenantsService, PlatformCatalogService, FeatureOverridesRepository],
})
export class PlatformModule {}
