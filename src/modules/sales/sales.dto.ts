import { OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../common/dto/pagination.dto.js';
import { IsDateOnly, MONEY_PATTERN, ToBoolean } from '../../common/dto/validators.js';
import {
  CustomerPaymentStatus,
  InvoiceKind,
  PaymentMeans,
  SalesDocumentType,
  SalesInvoiceStatus,
} from '../../generated/prisma/enums.js';

const DECIMAL = /^\d{1,14}(\.\d{1,6})?$/;

export class SalesInvoiceLineDto {
  @IsString() @Length(1, 1000) description: string;
  /** Decimal string, up to 6 decimals. */
  @Matches(DECIMAL, { message: 'quantity must be a decimal like "1" or "2.5"' }) quantity: string;
  /** Decimal string, up to 6 decimals; tax inclusive when pricesIncludeTax. */
  @Matches(DECIMAL, { message: 'unitPrice must be a decimal like "100.00"' }) unitPrice: string;
  @IsOptional() @Matches(MONEY_PATTERN, { message: 'discount must be a decimal amount like "5.00"' }) discount?: string;
  @IsUUID() taxRateId: string;
  /** Revenue account; defaults to the system sales account. */
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsUUID() costCenterId?: string;
  /** UN/ECE rec. 20 unit code (PCE, HUR, DAY, MON, ...). */
  @IsOptional() @Matches(/^[A-Z0-9]{1,10}$/, { message: 'unitCode must be a UN/ECE unit code like PCE' }) unitCode?: string;
}

export class CreateSalesInvoiceDto {
  @IsOptional() @IsIn(Object.values(SalesDocumentType)) type?: SalesDocumentType;
  /** Defaults to STANDARD for business customers, SIMPLIFIED otherwise. */
  @IsOptional() @IsIn(Object.values(InvoiceKind)) kind?: InvoiceKind;
  /** Required on standard invoices; optional for walk-in simplified sales. */
  @IsOptional() @IsUUID() contactId?: string;
  @IsDateOnly() issueDate: string;
  @IsOptional() @IsDateOnly() dueDate?: string;
  @IsOptional() @IsDateOnly() supplyDate?: string;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsBoolean() pricesIncludeTax?: boolean;
  @IsOptional() @IsIn(Object.values(PaymentMeans)) paymentMeans?: PaymentMeans;
  /** Credit / debit notes: the issued invoice being adjusted. */
  @IsOptional() @IsUUID() originalInvoiceId?: string;
  /** Credit / debit notes: reason for issuance. */
  @IsOptional() @IsString() @Length(1, 500) reason?: string;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsString() @MaxLength(2000) terms?: string;
  @IsOptional() @IsUUID() branchId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SalesInvoiceLineDto)
  lines: SalesInvoiceLineDto[];

  /** Issue immediately instead of saving a draft. */
  @IsOptional() @IsBoolean() issue?: boolean;
}

export class UpdateSalesInvoiceDto extends OmitType(CreateSalesInvoiceDto, ['issue', 'type'] as const) {}

export class VoidSalesInvoiceDto {
  @IsString() @Length(3, 500) reason: string;
}

export class SalesInvoicesQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(Object.values(SalesDocumentType)) type?: SalesDocumentType;
  @IsOptional() @IsIn(Object.values(SalesInvoiceStatus)) status?: SalesInvoiceStatus;
  @IsOptional() @IsUUID() contactId?: string;
  @IsOptional() @IsDateOnly() from?: string;
  @IsOptional() @IsDateOnly() to?: string;
  /** Only documents with an open balance. */
  @IsOptional() @ToBoolean() @IsBoolean() open?: boolean;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}

export class PaymentAllocationDto {
  @IsUUID() invoiceId: string;
  @Matches(MONEY_PATTERN, { message: 'amount must be a decimal amount like "100.00"' }) amount: string;
}

export class CreateCustomerPaymentDto {
  @IsUUID() contactId: string;
  @IsDateOnly() date: string;
  @Matches(MONEY_PATTERN, { message: 'amount must be a decimal amount like "100.00"' }) amount: string;
  /** Cash or bank account receiving the money. */
  @IsUUID() accountId: string;
  @IsOptional() @IsIn(Object.values(PaymentMeans)) method?: PaymentMeans;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationDto)
  allocations: PaymentAllocationDto[];
}

export class CustomerPaymentsQueryDto extends PageQueryDto {
  @IsOptional() @IsUUID() contactId?: string;
  @IsOptional() @IsIn(Object.values(CustomerPaymentStatus)) status?: CustomerPaymentStatus;
  @IsOptional() @IsDateOnly() from?: string;
  @IsOptional() @IsDateOnly() to?: string;
}
