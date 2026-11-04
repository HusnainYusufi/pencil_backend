import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { buildPage } from '../../common/helpers/pagination.js';
import { Idempotent } from '../../core/idempotency/idempotent.decorator.js';
import { RequireFeature, RequirePermissions, TenantAuth } from '../../core/security/decorators.js';
import { Permission } from '../access/permissions.js';
import { AccountingModule } from '../accounting/accounting.module.js';
import { ContactsModule } from '../contacts/contacts.module.js';
import { RequestContext } from '../../core/context/request-context.service.js';
import { AppException } from '../../core/errors/app.exception.js';
import { ErrorCode } from '../../core/errors/error-codes.js';
import { EntitlementsModule } from '../entitlements/entitlements.module.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { Feature } from '../entitlements/features.js';
import { TaxModule } from '../tax/tax.module.js';
import { PurchaseBillService } from './purchase-bill.service.js';
import {
  CreatePurchaseBillDto,
  CreateSupplierPaymentDto,
  PurchaseBillsQueryDto,
  SupplierPaymentsQueryDto,
  UpdatePurchaseBillDto,
  VoidPurchaseBillDto,
} from './purchases.dto.js';
import { toPurchaseDetail, toPurchaseSummary, toSupplierPayment } from './purchases.mappers.js';
import { PurchaseBillsRepository, SupplierPaymentsRepository } from './purchases.repositories.js';
import { SupplierPaymentService } from './supplier-payment.service.js';

@ApiTags('Purchases · Bills, credits & expenses')
@TenantAuth()
@RequireFeature(Feature.BILLS)
@Controller('purchase-bills')
export class PurchaseBillsController {
  constructor(
    private readonly bills: PurchaseBillService,
    private readonly entitlements: EntitlementsService,
    private readonly ctx: RequestContext,
  ) {}

  @Get()
  @RequirePermissions(Permission.BILLS_READ)
  async list(@Query() query: PurchaseBillsQueryDto) {
    const page = await this.bills.list(query);
    return buildPage(page.items.map(toPurchaseSummary), page.meta.total, query);
  }

  @Get(':id')
  @RequirePermissions(Permission.BILLS_READ)
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return toPurchaseDetail(await this.bills.get(id));
  }

  @Post()
  @Idempotent()
  @ApiOperation({ summary: 'Create a bill, supplier credit or expense (draft, or posted with "post": true)' })
  @RequirePermissions(Permission.BILLS_MANAGE)
  async create(@Body() dto: CreatePurchaseBillDto) {
    if (dto.type === 'EXPENSE' && !(await this.entitlements.getForTenant(this.ctx.requireTenantId())).has(Feature.EXPENSES)) {
      throw new AppException(ErrorCode.FEATURE_NOT_AVAILABLE, 'Your plan does not include this feature', { feature: Feature.EXPENSES });
    }
    return toPurchaseDetail(await this.bills.create(dto));
  }

  @Patch(':id')
  @RequirePermissions(Permission.BILLS_MANAGE)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePurchaseBillDto) {
    return toPurchaseDetail(await this.bills.update(id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permission.BILLS_MANAGE)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.bills.delete(id);
  }

  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermissions(Permission.BILLS_MANAGE)
  async post(@Param('id', ParseUUIDPipe) id: string) {
    return toPurchaseDetail(await this.bills.post(id));
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermissions(Permission.BILLS_MANAGE)
  async void(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidPurchaseBillDto) {
    return toPurchaseDetail(await this.bills.void(id, dto));
  }
}

@ApiTags('Purchases · Supplier payments')
@TenantAuth()
@RequireFeature(Feature.BILLS)
@Controller('supplier-payments')
export class SupplierPaymentsController {
  constructor(private readonly payments: SupplierPaymentService) {}

  @Get()
  @RequirePermissions(Permission.BILLS_READ)
  async list(@Query() query: SupplierPaymentsQueryDto) {
    const page = await this.payments.list(query);
    return buildPage(page.items.map(toSupplierPayment), page.meta.total, query);
  }

  @Get(':id')
  @RequirePermissions(Permission.BILLS_READ)
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return toSupplierPayment(await this.payments.get(id));
  }

  @Post()
  @Idempotent()
  @RequirePermissions(Permission.BILLS_MANAGE)
  async create(@Body() dto: CreateSupplierPaymentDto) {
    return toSupplierPayment(await this.payments.create(dto));
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermissions(Permission.BILLS_MANAGE)
  async void(@Param('id', ParseUUIDPipe) id: string) {
    return toSupplierPayment(await this.payments.void(id));
  }
}

/** Purchases: supplier bills, credits, expenses and supplier payments. */
@Module({
  imports: [AccountingModule, ContactsModule, TaxModule, EntitlementsModule],
  controllers: [PurchaseBillsController, SupplierPaymentsController],
  providers: [PurchaseBillsRepository, SupplierPaymentsRepository, PurchaseBillService, SupplierPaymentService],
})
export class PurchasesModule {}
