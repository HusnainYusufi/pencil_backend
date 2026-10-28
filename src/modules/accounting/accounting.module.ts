import { Module } from '@nestjs/common';
import { EntitlementsModule } from '../entitlements/entitlements.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { AccountingBootstrapService } from './accounting-bootstrap.service.js';
import { AccountingContext } from './accounting-context.service.js';
import {
  AccountsController,
  BooksController,
  DimensionsController,
  FiscalController,
  JournalsController,
  LedgerReportsController,
} from './accounting.controllers.js';
import { AccountsService } from './chart-of-accounts/accounts.service.js';
import { DimensionsService } from './dimensions/dimensions.service.js';
import { BooksService } from './fiscal/books.service.js';
import { FiscalCalendarService } from './fiscal/fiscal-calendar.service.js';
import { YearEndService } from './fiscal/year-end.service.js';
import { JournalService } from './journals/journal.service.js';
import { PostingService } from './journals/posting.service.js';
import { AccountsRepository } from './repositories/accounts.repository.js';
import { BooksRepository } from './repositories/books.repository.js';
import { DimensionsRepository } from './repositories/dimensions.repository.js';
import { FiscalRepository } from './repositories/fiscal.repository.js';
import { JournalsRepository } from './repositories/journals.repository.js';
import { LedgerRepository } from './repositories/ledger.repository.js';
import { NumberSeriesRepository } from './repositories/number-series.repository.js';
import { PartiesRepository } from './repositories/parties.repository.js';
import { LedgerReportsService } from './reports/ledger-reports.service.js';

/**
 * Accounting core: chart of accounts, fiscal calendar, dimensions, journals,
 * the posting engine and ledger reports. Exports the posting engine for the
 * document modules (sales, purchases, banking) that will post through it.
 */
@Module({
  imports: [TenancyModule, EntitlementsModule],
  controllers: [AccountsController, FiscalController, BooksController, DimensionsController, JournalsController, LedgerReportsController],
  providers: [
    AccountingContext,
    AccountingBootstrapService,
    AccountsRepository,
    BooksRepository,
    FiscalRepository,
    DimensionsRepository,
    JournalsRepository,
    LedgerRepository,
    NumberSeriesRepository,
    PartiesRepository,
    AccountsService,
    FiscalCalendarService,
    BooksService,
    YearEndService,
    DimensionsService,
    PostingService,
    JournalService,
    LedgerReportsService,
  ],
  exports: [AccountingContext, PostingService, AccountsRepository, LedgerRepository, FiscalCalendarService, NumberSeriesRepository, BooksService],
})
export class AccountingModule {}
