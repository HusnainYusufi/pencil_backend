import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module.js';
import { EntitlementsModule } from '../entitlements/entitlements.module.js';
import { TaxCodesController, TaxProfileController } from './tax.controllers.js';
import { TaxRepository } from './tax.repository.js';
import { TaxService } from './tax.service.js';

/** Tax codes (effective-dated rates), the company tax profile and the tax engine. */
@Module({
  imports: [AccountingModule, EntitlementsModule],
  controllers: [TaxCodesController, TaxProfileController],
  providers: [TaxRepository, TaxService],
  exports: [TaxRepository, TaxService],
})
export class TaxModule {}
