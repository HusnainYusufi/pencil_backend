import { Module } from '@nestjs/common';
import { FeaturesRepository } from './features.repository.js';
import { PlansRepository } from './plans.repository.js';

/** Plans & features catalog: data access shared by provisioning and pencil_admin. */
@Module({
  providers: [PlansRepository, FeaturesRepository],
  exports: [PlansRepository, FeaturesRepository],
})
export class CatalogModule {}
