import { Global, Module } from '@nestjs/common';
import { AccessCache } from './access-cache.js';
import { PermissionsGuard } from './permissions.guard.js';

@Global()
@Module({
  providers: [AccessCache, PermissionsGuard],
  exports: [AccessCache, PermissionsGuard],
})
export class SecurityModule {}
