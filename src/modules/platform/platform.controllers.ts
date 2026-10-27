import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CursorQueryDto } from '../../common/dto/pagination.dto.js';
import { Idempotent } from '../../core/idempotency/idempotent.decorator.js';
import { PlatformAuth, RequirePermissions } from '../../core/security/decorators.js';
import { PlatformPermission } from '../access/platform-permissions.js';
import { AuditRepository } from '../audit/audit.repository.js';
import {
  ChangeSubscriptionDto,
  CreateFeatureDto,
  CreatePlanDto,
  FeatureOverrideDto,
  OnboardTenantDto,
  ReplacePlanFeaturesDto,
  ReplacePlanPricesDto,
  TenantsQueryDto,
  UpdateFeatureDto,
  UpdatePlanDto,
  UpdateTenantStatusDto,
} from './dto/platform.dto.js';
import { PlatformCatalogService } from './platform-catalog.service.js';
import { PlatformTenantsService } from './platform-tenants.service.js';

@ApiTags('Platform · Tenants')
@PlatformAuth()
@Controller('platform/tenants')
export class PlatformTenantsController {
  constructor(private readonly tenants: PlatformTenantsService) {}

  @Get()
  @RequirePermissions(PlatformPermission.TENANTS_READ)
  list(@Query() query: TenantsQueryDto) {
    return this.tenants.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Tenant detail with subscription, effective entitlements and overrides' })
  @RequirePermissions(PlatformPermission.TENANTS_READ)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.get(id);
  }

  @Post()
  @Idempotent()
  @ApiOperation({ summary: 'Onboard a company (sales-assisted) with its owner' })
  @RequirePermissions(PlatformPermission.TENANTS_MANAGE)
  onboard(@Body() dto: OnboardTenantDto) {
    return this.tenants.onboard(dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Suspend, archive or reactivate a tenant' })
  @RequirePermissions(PlatformPermission.TENANTS_MANAGE)
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTenantStatusDto) {
    return this.tenants.setStatus(id, dto);
  }

  @Put(':id/subscription')
  @ApiOperation({ summary: 'Change plan / subscription status' })
  @RequirePermissions(PlatformPermission.SUBSCRIPTIONS_MANAGE)
  changeSubscription(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeSubscriptionDto) {
    return this.tenants.changeSubscription(id, dto);
  }

  @Put(':id/features/:featureKey')
  @ApiOperation({ summary: 'Grant/revoke a feature or adjust a limit for one tenant' })
  @RequirePermissions(PlatformPermission.SUBSCRIPTIONS_MANAGE)
  setFeatureOverride(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('featureKey') featureKey: string,
    @Body() dto: FeatureOverrideDto,
  ) {
    return this.tenants.setFeatureOverride(id, featureKey, dto);
  }

  @Delete(':id/features/:featureKey')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PlatformPermission.SUBSCRIPTIONS_MANAGE)
  async removeFeatureOverride(@Param('id', ParseUUIDPipe) id: string, @Param('featureKey') featureKey: string) {
    await this.tenants.removeFeatureOverride(id, featureKey);
  }
}

@ApiTags('Platform · Catalog')
@PlatformAuth()
@Controller('platform')
export class PlatformCatalogController {
  constructor(private readonly catalog: PlatformCatalogService) {}

  @Get('features')
  @RequirePermissions(PlatformPermission.CATALOG_READ)
  listFeatures() {
    return this.catalog.listFeatures();
  }

  @Post('features')
  @RequirePermissions(PlatformPermission.CATALOG_MANAGE)
  createFeature(@Body() dto: CreateFeatureDto) {
    return this.catalog.createFeature(dto);
  }

  @Patch('features/:key')
  @RequirePermissions(PlatformPermission.CATALOG_MANAGE)
  updateFeature(@Param('key') key: string, @Body() dto: UpdateFeatureDto) {
    return this.catalog.updateFeature(key, dto);
  }

  @Get('plans')
  @RequirePermissions(PlatformPermission.CATALOG_READ)
  listPlans(@Query('includeInactive', new ParseBoolPipe({ optional: true })) includeInactive?: boolean) {
    return this.catalog.listPlans(includeInactive ?? false);
  }

  @Get('plans/:id')
  @RequirePermissions(PlatformPermission.CATALOG_READ)
  getPlan(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getPlan(id);
  }

  @Post('plans')
  @RequirePermissions(PlatformPermission.CATALOG_MANAGE)
  createPlan(@Body() dto: CreatePlanDto) {
    return this.catalog.createPlan(dto);
  }

  @Patch('plans/:id')
  @RequirePermissions(PlatformPermission.CATALOG_MANAGE)
  updatePlan(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlanDto) {
    return this.catalog.updatePlan(id, dto);
  }

  @Put('plans/:id/features')
  @RequirePermissions(PlatformPermission.CATALOG_MANAGE)
  replacePlanFeatures(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplacePlanFeaturesDto) {
    return this.catalog.replacePlanFeatures(id, dto.features);
  }

  @Put('plans/:id/prices')
  @RequirePermissions(PlatformPermission.CATALOG_MANAGE)
  replacePlanPrices(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplacePlanPricesDto) {
    return this.catalog.replacePlanPrices(id, dto.prices);
  }
}

export class PlatformAuditQueryDto extends CursorQueryDto {
  @IsOptional() @IsUUID() tenantId?: string;
  @IsOptional() @IsString() @MaxLength(100) action?: string;
  @IsOptional() @IsUUID() actorId?: string;
}

@ApiTags('Platform · Audit')
@PlatformAuth()
@Controller('platform/audit-logs')
export class PlatformAuditController {
  constructor(private readonly audit: AuditRepository) {}

  @Get()
  @ApiOperation({ summary: 'Audit trail across all tenants and platform actions' })
  @RequirePermissions(PlatformPermission.AUDIT_READ)
  list(@Query() query: PlatformAuditQueryDto) {
    return this.audit.list(query);
  }
}
