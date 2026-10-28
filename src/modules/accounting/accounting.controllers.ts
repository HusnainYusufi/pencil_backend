import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { buildPage } from '../../common/helpers/pagination.js';
import { Idempotent } from '../../core/idempotency/idempotent.decorator.js';
import { RequireFeature, RequirePermissions, TenantAuth } from '../../core/security/decorators.js';
import { Permission } from '../access/permissions.js';
import { Feature } from '../entitlements/features.js';
import { toFiscalPeriod, toFiscalYear, toJournalDetail, toJournalSummary } from './accounting.mappers.js';
import { AccountsService } from './chart-of-accounts/accounts.service.js';
import { DimensionsService } from './dimensions/dimensions.service.js';
import { AccountsQueryDto, CreateAccountDto, UpdateAccountDto } from './dto/accounts.dto.js';
import { ReopenDto, UpdateBooksSettingsDto } from './dto/books.dto.js';
import { CreateDimensionDto, IncludeInactiveQueryDto, UpdateDimensionDto } from './dto/dimensions.dto.js';
import {
  CreateJournalEntryDto,
  JournalsQueryDto,
  ReverseJournalEntryDto,
  UpdateJournalEntryDto,
} from './dto/journals.dto.js';
import { AccountStatementQueryDto, TrialBalanceQueryDto } from './dto/reports.dto.js';
import { BooksService } from './fiscal/books.service.js';
import { FiscalCalendarService } from './fiscal/fiscal-calendar.service.js';
import { YearEndService } from './fiscal/year-end.service.js';
import { JournalService } from './journals/journal.service.js';
import { LedgerReportsService } from './reports/ledger-reports.service.js';

@ApiTags('Accounting · Chart of accounts')
@TenantAuth()
@RequireFeature(Feature.CHART_OF_ACCOUNTS)
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @ApiOperation({ summary: 'Chart of accounts (flat, ordered by code; build the tree with parentId)' })
  @RequirePermissions(Permission.ACCOUNTS_READ)
  list(@Query() query: AccountsQueryDto) {
    return this.accounts.list(query);
  }

  @Get(':id')
  @RequirePermissions(Permission.ACCOUNTS_READ)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.get(id);
  }

  @Post()
  @RequirePermissions(Permission.ACCOUNTS_MANAGE)
  create(@Body() dto: CreateAccountDto) {
    return this.accounts.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(Permission.ACCOUNTS_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAccountDto) {
    return this.accounts.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an unused account (deactivate used ones instead)' })
  @RequirePermissions(Permission.ACCOUNTS_MANAGE)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.accounts.delete(id);
  }
}

@ApiTags('Accounting · Fiscal calendar')
@TenantAuth()
@Controller()
export class FiscalController {
  constructor(
    private readonly fiscal: FiscalCalendarService,
    private readonly yearEnd: YearEndService,
  ) {}

  @Get('fiscal-years')
  @RequirePermissions(Permission.JOURNALS_READ)
  async list() {
    return (await this.fiscal.listYears()).map(toFiscalYear);
  }

  @Post('fiscal-years')
  @RequireFeature(Feature.FISCAL_PERIODS)
  @ApiOperation({ summary: 'Open the next fiscal year (12 monthly periods)' })
  @RequirePermissions(Permission.PERIODS_MANAGE)
  async createNext() {
    return toFiscalYear(await this.fiscal.createNextYear());
  }

  @Post('fiscal-periods/:id/close')
  @RequireFeature(Feature.FISCAL_PERIODS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close a period: postings dated inside it are rejected' })
  @RequirePermissions(Permission.PERIODS_MANAGE)
  async close(@Param('id', ParseUUIDPipe) id: string) {
    return toFiscalPeriod(await this.fiscal.closePeriod(id));
  }

  @Post('fiscal-periods/:id/reopen')
  @RequireFeature(Feature.FISCAL_PERIODS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reopen a period (reason required; blocked behind the lock date)' })
  @RequirePermissions(Permission.PERIODS_MANAGE)
  async reopen(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReopenDto) {
    return toFiscalPeriod(await this.fiscal.reopenPeriod(id, dto.reason));
  }

  @Get('fiscal-years/:id/close-preview')
  @ApiOperation({ summary: 'Year-end close preview: result for the year and anything blocking the close' })
  @RequirePermissions(Permission.JOURNALS_READ)
  closePreview(@Param('id', ParseUUIDPipe) id: string) {
    return this.yearEnd.preview(id);
  }

  @Post('fiscal-years/:id/close')
  @RequireFeature(Feature.FISCAL_PERIODS)
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @ApiOperation({ summary: 'Close a fiscal year: post the closing entry to retained earnings and lock the year' })
  @RequirePermissions(Permission.BOOKS_CLOSE)
  closeYear(@Param('id', ParseUUIDPipe) id: string) {
    return this.yearEnd.close(id);
  }

  @Post('fiscal-years/:id/reopen')
  @RequireFeature(Feature.FISCAL_PERIODS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reopen a closed fiscal year (reason required; reverses its closing entry)' })
  @RequirePermissions(Permission.BOOKS_CLOSE)
  reopenYear(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReopenDto) {
    return this.yearEnd.reopen(id, dto.reason);
  }
}

@ApiTags('Accounting · Books controls')
@TenantAuth()
@Controller('books')
export class BooksController {
  constructor(private readonly books: BooksService) {}

  @Get()
  @ApiOperation({ summary: 'Lock dates, opening balance date and opening-balance equity check' })
  @RequirePermissions(Permission.JOURNALS_READ)
  get() {
    return this.books.overview();
  }

  @Patch()
  @ApiOperation({ summary: 'Set lock dates / opening balance date (reason required to loosen a lock)' })
  @RequirePermissions(Permission.BOOKS_CLOSE)
  update(@Body() dto: UpdateBooksSettingsDto) {
    return this.books.update(dto);
  }
}

@ApiTags('Accounting · Dimensions')
@TenantAuth()
@Controller()
export class DimensionsController {
  constructor(private readonly dimensions: DimensionsService) {}

  @Get('branches')
  @RequirePermissions(Permission.TENANT_READ)
  listBranches(@Query() query: IncludeInactiveQueryDto) {
    return this.dimensions.listBranches(query.includeInactive ?? false);
  }

  @Post('branches')
  @ApiOperation({ summary: "Add a branch (limited by the plan's branches.max)" })
  @RequirePermissions(Permission.TENANT_MANAGE)
  createBranch(@Body() dto: CreateDimensionDto) {
    return this.dimensions.createBranch(dto);
  }

  @Patch('branches/:id')
  @RequirePermissions(Permission.TENANT_MANAGE)
  updateBranch(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDimensionDto) {
    return this.dimensions.updateBranch(id, dto);
  }

  @Get('cost-centers')
  @RequireFeature(Feature.COST_CENTERS)
  @RequirePermissions(Permission.ACCOUNTS_READ)
  listCostCenters(@Query() query: IncludeInactiveQueryDto) {
    return this.dimensions.listCostCenters(query.includeInactive ?? false);
  }

  @Post('cost-centers')
  @RequireFeature(Feature.COST_CENTERS)
  @RequirePermissions(Permission.ACCOUNTS_MANAGE)
  createCostCenter(@Body() dto: CreateDimensionDto) {
    return this.dimensions.createCostCenter(dto);
  }

  @Patch('cost-centers/:id')
  @RequireFeature(Feature.COST_CENTERS)
  @RequirePermissions(Permission.ACCOUNTS_MANAGE)
  updateCostCenter(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDimensionDto) {
    return this.dimensions.updateCostCenter(id, dto);
  }
}

@ApiTags('Accounting · Journal entries')
@TenantAuth()
@RequireFeature(Feature.JOURNALS)
@Controller('journal-entries')
export class JournalsController {
  constructor(private readonly journals: JournalService) {}

  @Get()
  @RequirePermissions(Permission.JOURNALS_READ)
  async list(@Query() query: JournalsQueryDto) {
    const page = await this.journals.list(query);
    return buildPage(page.items.map(toJournalSummary), page.meta.total, query);
  }

  @Get(':id')
  @RequirePermissions(Permission.JOURNALS_READ)
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return toJournalDetail(await this.journals.get(id));
  }

  @Post()
  @Idempotent()
  @ApiOperation({ summary: 'Create a draft (or post immediately with "post": true)' })
  @RequirePermissions(Permission.JOURNALS_POST)
  async create(@Body() dto: CreateJournalEntryDto) {
    return toJournalDetail(await this.journals.create(dto));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Replace a draft (posted entries are immutable)' })
  @RequirePermissions(Permission.JOURNALS_POST)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateJournalEntryDto) {
    return toJournalDetail(await this.journals.update(id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permission.JOURNALS_POST)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.journals.delete(id);
  }

  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @ApiOperation({ summary: 'Post a draft to the general ledger (assigns the JV number)' })
  @RequirePermissions(Permission.JOURNALS_POST)
  async post(@Param('id', ParseUUIDPipe) id: string) {
    return toJournalDetail(await this.journals.post(id));
  }

  @Post(':id/reverse')
  @Idempotent()
  @ApiOperation({ summary: 'Reverse a posted entry with a linked mirror entry' })
  @RequirePermissions(Permission.JOURNALS_POST)
  async reverse(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReverseJournalEntryDto) {
    return toJournalDetail(await this.journals.reverse(id, dto));
  }
}

@ApiTags('Accounting · Reports')
@TenantAuth()
@RequireFeature(Feature.LEDGER_REPORTS)
@Controller('reports')
export class LedgerReportsController {
  constructor(private readonly reports: LedgerReportsService) {}

  @Get('trial-balance')
  @ApiOperation({ summary: 'Trial balance with opening, movement and closing (rolled up the account tree)' })
  @RequirePermissions(Permission.REPORTS_READ)
  trialBalance(@Query() query: TrialBalanceQueryDto) {
    return this.reports.trialBalance(query);
  }

  @Get('account-statement/:accountId')
  @ApiOperation({ summary: 'General ledger for one account with running balance (cursor-paginated)' })
  @RequirePermissions(Permission.REPORTS_READ)
  accountStatement(@Param('accountId', ParseUUIDPipe) accountId: string, @Query() query: AccountStatementQueryDto) {
    return this.reports.accountStatement(accountId, query);
  }
}
