import { Global, Module } from '@nestjs/common';
import { AccessCache } from './access-cache.js';
import { PermissionsGuard } from './permissions.guard.js';
import { SecretBox } from './secret-box.js';

@Global()
@Module({
  providers: [AccessCache, PermissionsGuard, SecretBox],
  exports: [AccessCache, PermissionsGuard, SecretBox],
})
export class SecurityModule {}
