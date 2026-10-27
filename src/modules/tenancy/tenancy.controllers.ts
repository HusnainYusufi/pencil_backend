import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireFeature, RequirePermissions, TenantAuth } from '../../core/security/decorators.js';
import { Permission } from '../access/permissions.js';
import { Feature } from '../entitlements/features.js';
import {
  CreateRoleDto,
  MembersQueryDto,
  UpdateMemberRoleDto,
  UpdateRoleDto,
  UpdateTenantDto,
} from './dto/tenancy.dto.js';
import { MembersService } from './members.service.js';
import { RolesService } from './roles.service.js';
import { TenantService } from './tenant.service.js';

@ApiTags('Company')
@TenantAuth()
@Controller('tenant')
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  @Get()
  @ApiOperation({ summary: 'Current company profile' })
  @RequirePermissions(Permission.TENANT_READ)
  get() {
    return this.tenants.getCurrent();
  }

  @Patch()
  @ApiOperation({ summary: 'Update company profile' })
  @RequirePermissions(Permission.TENANT_MANAGE)
  update(@Body() dto: UpdateTenantDto) {
    return this.tenants.updateCurrent(dto);
  }
}

@ApiTags('Roles')
@TenantAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions(Permission.ROLES_READ)
  list() {
    return this.roles.list();
  }

  @Post()
  @ApiOperation({ summary: 'Create a custom role' })
  @RequirePermissions(Permission.ROLES_MANAGE)
  @RequireFeature(Feature.CUSTOM_ROLES)
  create(@Body() dto: CreateRoleDto) {
    return this.roles.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(Permission.ROLES_MANAGE)
  @RequireFeature(Feature.CUSTOM_ROLES)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permission.ROLES_MANAGE)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.roles.delete(id);
  }
}

@ApiTags('Members')
@TenantAuth()
@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequirePermissions(Permission.MEMBERS_READ)
  list(@Query() query: MembersQueryDto) {
    return this.members.list(query);
  }

  @Patch(':id/role')
  @ApiOperation({ summary: "Change a member's role" })
  @RequirePermissions(Permission.MEMBERS_MANAGE)
  changeRole(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMemberRoleDto) {
    return this.members.changeRole(id, dto);
  }
}
