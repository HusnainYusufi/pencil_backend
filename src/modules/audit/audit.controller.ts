import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CursorQueryDto } from '../../common/dto/pagination.dto.js';
import { RequestContext } from '../../core/context/request-context.service.js';
import { RequireFeature, RequirePermissions, TenantAuth } from '../../core/security/decorators.js';
import { Permission } from '../access/permissions.js';
import { Feature } from '../entitlements/features.js';
import { AuditRepository } from './audit.repository.js';

export class AuditQueryDto extends CursorQueryDto {
  @IsOptional() @IsString() @MaxLength(100) action?: string;
  @IsOptional() @IsString() @MaxLength(64) entityType?: string;
  @IsOptional() @IsString() @MaxLength(64) entityId?: string;
}

@ApiTags('Audit')
@TenantAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(
    private readonly repository: AuditRepository,
    private readonly ctx: RequestContext,
  ) {}

  @Get()
  @ApiOperation({ summary: "List the current tenant's audit trail (newest first)" })
  @RequirePermissions(Permission.AUDIT_READ)
  @RequireFeature(Feature.AUDIT_LOG)
  list(@Query() query: AuditQueryDto) {
    return this.repository.list({ ...query, tenantId: this.ctx.requireTenantId() });
  }
}
