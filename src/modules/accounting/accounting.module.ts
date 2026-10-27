import { Module } from '@nestjs/common';
import { EntitlementsModule } from '../entitlements/entitlements.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { AccountingBootstrapService } from './accounting-bootstrap.service.js';
import { AccountingContext } from './accounting-context.service.js';
import {
  AccountsController,
  DimensionsController,
  FiscalController,
  JournalsController,
  LedgerReportsController,
} from './accounting.controllers.js';
import { AccountsService } from './chart-of-accounts/accounts.service.js';
import { DimensionsService } from './dimensions/dimensions.service.js';
import { FiscalCalendarService } from './fiscal/fiscal-calendar.service.js';
import { JournalService } from './journals/journal.service.js';
import { PostingService } from './journals/posting.service.js';
import { AccountsRepository } from './repositories/accounts.repository.js';
import { DimensionsRepository } from './repositories/dimensions.repository.js';
import { FiscalRepository } from './repositories/fiscal.repository.js';
import { JournalsRepository } from './repositories/journals.repository.js';
import { LedgerRepository } from './repositories/ledger.repository.js';
import { NumberSeriesRepository } from './repositories/number-series.repository.js';
import { LedgerReportsService } from './reports/ledger-reports.service.js';

/**
 * Accounting core: chart of accounts, fiscal calendar, dimensions, journals,
 * the posting engine and ledger reports. Exports the posting engine for the
 * document modules (sales, purchases, banking) that will post through it.
 */
@Module({
  imports: [TenancyModule, EntitlementsModule],
  controllers: [AccountsController, FiscalController, DimensionsController, JournalsController, LedgerReportsController],
  providers: [
    AccountingContext,
    AccountingBootstrapService,
    AccountsRepository,
    FiscalRepository,
    DimensionsRepository,
    JournalsRepository,
    LedgerRepository,
    NumberSeriesRepository,
    AccountsService,
    FiscalCalendarService,
    DimensionsService,
    PostingService,
    JournalService,
    LedgerReportsService,
  ],
  exports: [AccountingContext, PostingService, AccountsRepository, FiscalCalendarService, NumberSeriesRepository],
})
export class AccountingModule {}
