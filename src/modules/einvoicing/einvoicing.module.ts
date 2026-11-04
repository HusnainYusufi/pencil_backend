import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { RequireFeature, RequirePermissions, TenantAuth } from '../../core/security/decorators.js';
import { EInvoicingEnvironment } from '../../generated/prisma/enums.js';
import { Permission } from '../access/permissions.js';
import { AccountingModule } from '../accounting/accounting.module.js';
import { Feature } from '../entitlements/features.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { EInvoiceDocumentsRepository, EInvoiceQueueRepository, EInvoicingUnitsRepository } from './einvoicing.repositories.js';
import { EInvoicingService, toUnitView } from './einvoicing.service.js';
import { EInvoiceSubmissionWorker } from './einvoicing.worker.js';
import { EInvoicingOnboardingService } from './onboarding.service.js';
import { defaultZatcaGatewayFactory, ZATCA_GATEWAY_FACTORY } from './zatca/zatca-gateway.js';

export class OnboardZatcaDto {
  /** SANDBOX (developer portal), SIMULATION or PRODUCTION. */
  @IsIn(Object.values(EInvoicingEnvironment)) environment: EInvoicingEnvironment;
  /** One-time password generated in the FATOORA portal. */
  @Matches(/^\d{6}$/, { message: 'otp must be the 6-digit code from the FATOORA portal' }) otp: string;
  @IsOptional() @IsString() @Length(1, 100) name?: string;
  @IsOptional() @IsString() @Length(1, 100) organizationUnit?: string;
  @IsOptional() @IsString() @Length(1, 100) location?: string;
  @IsOptional() @IsString() @Length(1, 100) industry?: string;
}

@ApiTags('E-invoicing')
@TenantAuth()
@RequireFeature(Feature.EINVOICING)
@Controller('einvoicing')
export class EInvoicingController {
  constructor(
    private readonly einvoicing: EInvoicingService,
    private readonly onboarding: EInvoicingOnboardingService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Which authority applies, the active device and submission counts' })
  @RequirePermissions(Permission.INVOICES_READ)
  status() {
    return this.einvoicing.statusSummary();
  }

  @Get('units')
  @RequirePermissions(Permission.EINVOICING_MANAGE)
  async units() {
    return (await this.onboarding.list()).map(toUnitView);
  }

  @Post('units/zatca')
  @ApiOperation({ summary: 'Onboard a ZATCA device: CSR, compliance checks, production certificate' })
  @RequirePermissions(Permission.EINVOICING_MANAGE)
  async onboardZatca(@Body() dto: OnboardZatcaDto) {
    return toUnitView(await this.onboarding.onboardZatca(dto));
  }
}

/**
 * Government e-invoicing (ZATCA today; JoFotara next). Document modules call
 * EInvoicingService.prepare() while issuing and submit() after commit.
 */
@Module({
  imports: [TenancyModule, AccountingModule],
  controllers: [EInvoicingController],
  providers: [
    { provide: ZATCA_GATEWAY_FACTORY, useValue: defaultZatcaGatewayFactory },
    EInvoicingUnitsRepository,
    EInvoiceDocumentsRepository,
    EInvoiceQueueRepository,
    EInvoicingService,
    EInvoicingOnboardingService,
    EInvoiceSubmissionWorker,
  ],
  exports: [EInvoicingService],
})
export class EInvoicingModule {}
