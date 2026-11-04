import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { buildPage } from '../../common/helpers/pagination.js';
import { RequestContext } from '../../core/context/request-context.service.js';
import { AppException } from '../../core/errors/app.exception.js';
import { Idempotent } from '../../core/idempotency/idempotent.decorator.js';
import { hasPermission } from '../../core/security/permissions.js';
import { RequireFeature, RequirePermissions, TenantAuth } from '../../core/security/decorators.js';
import { Permission } from '../access/permissions.js';
import { AccountingModule } from '../accounting/accounting.module.js';
import { ContactsModule } from '../contacts/contacts.module.js';
import { EInvoicingModule } from '../einvoicing/einvoicing.module.js';
import { Feature } from '../entitlements/features.js';
import { TaxModule } from '../tax/tax.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { SalesInvoiceService } from './invoices/sales-invoice.service.js';
import { SalesInvoicesRepository } from './invoices/sales-invoices.repository.js';
import { CustomerPaymentService } from './payments/customer-payment.service.js';
import { CustomerPaymentsRepository } from './payments/customer-payments.repository.js';
import {
  CreateCustomerPaymentDto,
  CreateSalesInvoiceDto,
  CustomerPaymentsQueryDto,
  SalesInvoicesQueryDto,
  UpdateSalesInvoiceDto,
  VoidSalesInvoiceDto,
} from './sales.dto.js';
import { toCustomerPayment, toSalesInvoiceDetail, toSalesInvoiceSummary } from './sales.mappers.js';

@ApiTags('Sales · Invoices & notes')
@TenantAuth()
@RequireFeature(Feature.SALES_INVOICES)
@Controller('sales-invoices')
export class SalesInvoicesController {
  constructor(
    private readonly invoices: SalesInvoiceService,
    private readonly ctx: RequestContext,
  ) {}

  @Get()
  @RequirePermissions(Permission.INVOICES_READ)
  async list(@Query() query: SalesInvoicesQueryDto) {
    const page = await this.invoices.list(query);
    return buildPage(page.items.map(toSalesInvoiceSummary), page.meta.total, query);
  }

  @Get(':id')
  @RequirePermissions(Permission.INVOICES_READ)
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return toSalesInvoiceDetail(await this.invoices.get(id));
  }

  @Post()
  @Idempotent()
  @ApiOperation({ summary: 'Create a draft invoice / credit note / debit note (or issue it at once with "issue": true)' })
  @RequirePermissions(Permission.INVOICES_MANAGE)
  async create(@Body() dto: CreateSalesInvoiceDto) {
    // "issue": true also needs the issue permission (the guard only checks manage).
    if (dto.issue) {
      const actor = this.ctx.actor;
      if (actor?.type !== 'user' || !hasPermission(actor.permissions, Permission.INVOICES_ISSUE)) {
        throw AppException.forbidden('Issuing documents requires the invoices.issue permission');
      }
    }
    return toSalesInvoiceDetail(await this.invoices.create(dto));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Replace a draft (issued documents are immutable)' })
  @RequirePermissions(Permission.INVOICES_MANAGE)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSalesInvoiceDto) {
    return toSalesInvoiceDetail(await this.invoices.update(id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permission.INVOICES_MANAGE)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.invoices.delete(id);
  }

  @Post(':id/issue')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @ApiOperation({ summary: 'Issue: number, post to the ledger, sign and submit the e-invoice' })
  @RequirePermissions(Permission.INVOICES_ISSUE)
  async issue(@Param('id', ParseUUIDPipe) id: string) {
    return toSalesInvoiceDetail(await this.invoices.issue(id));
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @ApiOperation({ summary: 'Void an issued document not accepted by the tax authority (reversing entry)' })
  @RequirePermissions(Permission.INVOICES_ISSUE)
  async void(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidSalesInvoiceDto) {
    return toSalesInvoiceDetail(await this.invoices.void(id, dto));
  }

  @Post(':id/einvoice/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry a pending e-invoice submission now' })
  @RequirePermissions(Permission.INVOICES_ISSUE)
  async retry(@Param('id', ParseUUIDPipe) id: string) {
    return toSalesInvoiceDetail(await this.invoices.retrySubmission(id));
  }

  @Get(':id/einvoice/xml')
  @ApiOperation({ summary: 'Signed e-invoice XML (authority-stamped copy once cleared)' })
  @RequirePermissions(Permission.INVOICES_READ)
  xml(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.xml(id);
  }
}

@ApiTags('Sales · Customer payments')
@TenantAuth()
@RequireFeature(Feature.SALES_INVOICES)
@Controller('customer-payments')
export class CustomerPaymentsController {
  constructor(private readonly payments: CustomerPaymentService) {}

  @Get()
  @RequirePermissions(Permission.PAYMENTS_READ)
  async list(@Query() query: CustomerPaymentsQueryDto) {
    const page = await this.payments.list(query);
    return buildPage(page.items.map(toCustomerPayment), page.meta.total, query);
  }

  @Get(':id')
  @RequirePermissions(Permission.PAYMENTS_READ)
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return toCustomerPayment(await this.payments.get(id));
  }

  @Post()
  @Idempotent()
  @ApiOperation({ summary: 'Record money received and allocate it to open invoices' })
  @RequirePermissions(Permission.PAYMENTS_MANAGE)
  async create(@Body() dto: CreateCustomerPaymentDto) {
    return toCustomerPayment(await this.payments.create(dto));
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermissions(Permission.PAYMENTS_MANAGE)
  async void(@Param('id', ParseUUIDPipe) id: string) {
    return toCustomerPayment(await this.payments.void(id));
  }
}

/** Sales documents and customer payments, posting through the accounting engine. */
@Module({
  imports: [TenancyModule, AccountingModule, ContactsModule, TaxModule, EInvoicingModule],
  controllers: [SalesInvoicesController, CustomerPaymentsController],
  providers: [SalesInvoicesRepository, SalesInvoiceService, CustomerPaymentsRepository, CustomerPaymentService],
})
export class SalesModule {}
