import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EntitlementsModule } from '../entitlements/entitlements.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { AccessContextService } from './access-context.service.js';
import { AuthController, MeController, PlatformAuthController } from './auth.controllers.js';
import { AuthGuard } from './auth.guard.js';
import { PasswordService } from './password.service.js';
import { PlatformAdminsRepository } from './platform/platform-admins.repository.js';
import { PlatformAuthService } from './platform/platform-auth.service.js';
import { TokenService } from './token.service.js';
import { UserAuthService } from './user-auth.service.js';

/** Authentication for both realms: tenant users and platform staff. */
@Module({
  // Secrets are passed per call (two trust domains), so no default secret here.
  imports: [JwtModule.register({}), IdentityModule, TenancyModule, EntitlementsModule],
  controllers: [AuthController, MeController, PlatformAuthController],
  providers: [
    TokenService,
    PasswordService,
    AccessContextService,
    AuthGuard,
    UserAuthService,
    PlatformAuthService,
    PlatformAdminsRepository,
  ],
  exports: [AuthGuard, PasswordService],
})
export class AuthModule {}
