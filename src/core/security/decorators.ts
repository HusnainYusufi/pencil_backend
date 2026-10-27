import { applyDecorators, createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ClsServiceManager } from 'nestjs-cls';
import type { Actor, RequestContextStore } from '../context/request-context.js';

export const AUTH_SCOPE_KEY = 'pencil:auth-scope';
export const PERMISSIONS_KEY = 'pencil:permissions';
export const FEATURE_KEY = 'pencil:feature';

/**
 * Which authentication realm a route belongs to. Secure by default: a route
 * with no decorator requires a tenant user with an active tenant selected.
 *
 *  - public          no authentication
 *  - tenant          tenant user + selected tenant (default)
 *  - tenant-optional tenant user; tenant may be unselected (e.g. /me/tenants)
 *  - platform        platform staff (pencil_admin); cross-tenant DB scope
 */
export type AuthScope = 'public' | 'tenant' | 'tenant-optional' | 'platform';

export const Public = () => SetMetadata(AUTH_SCOPE_KEY, 'public' satisfies AuthScope);

export const TenantOptional = () =>
  applyDecorators(SetMetadata(AUTH_SCOPE_KEY, 'tenant-optional' satisfies AuthScope), ApiBearerAuth('tenant'));

export const TenantAuth = () =>
  applyDecorators(SetMetadata(AUTH_SCOPE_KEY, 'tenant' satisfies AuthScope), ApiBearerAuth('tenant'));

export const PlatformAuth = () =>
  applyDecorators(SetMetadata(AUTH_SCOPE_KEY, 'platform' satisfies AuthScope), ApiBearerAuth('platform'));

/** All listed permissions are required. Supports `*` and `module.*` grants. */
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/** The tenant's plan (or an override) must include this feature. */
export const RequireFeature = (featureKey: string) => SetMetadata(FEATURE_KEY, featureKey);

/** Injects the authenticated actor into a controller handler. */
export const CurrentActor = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): Actor | undefined =>
    ClsServiceManager.getClsService<RequestContextStore>().get('actor'),
);
