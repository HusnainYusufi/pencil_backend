import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireFeature, RequirePermissions, TenantAuth } from '../../core/security/decorators.js';
import type { TaxRate } from '../../generated/prisma/client.js';
import { Permission } from '../access/permissions.js';
import { Feature } from '../entitlements/features.js';
import { CreateTaxRateDto, TaxRatesQueryDto, UpdateTaxRateDto, VatReturnQueryDto } from './tax.dto.js';
import { VatReturnService } from './vat-return.service.js';
import { TaxRatesService } from './tax-rates.service.js';

export function toTaxRate(rate: TaxRate) {
  return {
    id: rate.id,
    code: rate.code,
    name: rate.name,
    nameAr: rate.nameAr,
    rate: rate.rate.toFixed(2),
    category: rate.category,
    exemptionCode: rate.exemptionCode,
    exemptionReason: rate.exemptionReason,
    accountId: rate.accountId,
    isDefault: rate.isDefault,
    isActive: rate.isActive,
  };
}

@ApiTags('Tax')
@TenantAuth()
@RequireFeature(Feature.SALES_INVOICES)
@Controller('tax-rates')
export class TaxRatesController {
  constructor(private readonly taxRates: TaxRatesService) {}

  @Get()
  @ApiOperation({ summary: 'Tax rates of the company (country template plus custom rates)' })
  @RequirePermissions(Permission.INVOICES_READ)
  async list(@Query() query: TaxRatesQueryDto) {
    return (await this.taxRates.list(query.includeInactive)).map(toTaxRate);
  }

  @Get(':id')
  @RequirePermissions(Permission.INVOICES_READ)
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return toTaxRate(await this.taxRates.get(id));
  }

  @Post()
  @RequirePermissions(Permission.TAXES_MANAGE)
  async create(@Body() dto: CreateTaxRateDto) {
    return toTaxRate(await this.taxRates.create(dto));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename, re-route or deactivate a rate (the percentage is fixed once created)' })
  @RequirePermissions(Permission.TAXES_MANAGE)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTaxRateDto) {
    return toTaxRate(await this.taxRates.update(id, dto));
  }
}

@ApiTags('Tax')
@TenantAuth()
@RequireFeature(Feature.VAT_RETURNS)
@Controller('reports')
export class VatReturnController {
  constructor(private readonly vat: VatReturnService) {}

  @Get('vat-return')
  @ApiOperation({ summary: 'VAT / sales-tax return for a period (ZATCA boxes for KSA)' })
  @RequirePermissions(Permission.REPORTS_READ)
  vatReturn(@Query() query: VatReturnQueryDto) {
    return this.vat.vatReturn(query);
  }
}
