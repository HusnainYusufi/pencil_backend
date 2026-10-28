import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireFeature, RequirePermissions, TenantAuth } from '../../core/security/decorators.js';
import { Permission } from '../access/permissions.js';
import { Feature } from '../entitlements/features.js';
import { CreateTaxCodeDto, TaxCodesQueryDto, TaxRateDto, UpdateTaxCodeDto, UpdateTaxProfileDto } from './dto/tax.dto.js';
import { TaxService } from './tax.service.js';

@ApiTags('Tax · Codes')
@TenantAuth()
@RequireFeature(Feature.TAX_CODES)
@Controller('tax-codes')
export class TaxCodesController {
  constructor(private readonly tax: TaxService) {}

  @Get()
  @ApiOperation({ summary: 'Tax codes with their current rate and full rate history' })
  @RequirePermissions(Permission.TAXES_READ)
  list(@Query() query: TaxCodesQueryDto) {
    return this.tax.list(query);
  }

  @Get(':id')
  @RequirePermissions(Permission.TAXES_READ)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tax.get(id);
  }

  @Post()
  @ApiOperation({ summary: 'Add a company tax code (country codes come from the template)' })
  @RequirePermissions(Permission.TAXES_MANAGE)
  create(@Body() dto: CreateTaxCodeDto) {
    return this.tax.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(Permission.TAXES_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTaxCodeDto) {
    return this.tax.update(id, dto);
  }

  @Post(':id/rates')
  @ApiOperation({ summary: 'Change the rate of a company tax code from a date' })
  @RequirePermissions(Permission.TAXES_MANAGE)
  addRate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TaxRateDto) {
    return this.tax.addRate(id, dto.ratePercent, dto.effectiveFrom);
  }
}

@ApiTags('Tax · Company profile')
@TenantAuth()
@Controller('tax-profile')
export class TaxProfileController {
  constructor(private readonly tax: TaxService) {}

  @Get()
  @ApiOperation({ summary: 'Seller tax registration and address, with e-invoicing readiness' })
  @RequirePermissions(Permission.TENANT_READ)
  get() {
    return this.tax.profile();
  }

  @Patch()
  @RequirePermissions(Permission.TAXES_MANAGE)
  update(@Body() dto: UpdateTaxProfileDto) {
    return this.tax.updateProfile(dto);
  }
}
