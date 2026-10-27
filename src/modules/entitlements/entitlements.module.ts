import { Module } from '@nestjs/common';
import { EntitlementsRepository } from './entitlements.repository.js';
import { EntitlementsService } from './entitlements.service.js';
import { FeatureGuard } from './feature.guard.js';

@Module({
  providers: [EntitlementsRepository, EntitlementsService, FeatureGuard],
  exports: [EntitlementsService, FeatureGuard],
})
export class EntitlementsModule {}
