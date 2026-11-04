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
import { PaymentMeans, PurchaseDocumentType, PurchaseStatus, SupplierPaymentStatus } from '../../generated/prisma/enums.js';

const DECIMAL = /^\d{1,14}(\.\d{1,6})?$/;

export class PurchaseLineDto {
  @IsString() @Length(1, 1000) description: string;
  @Matches(DECIMAL, { message: 'quantity must be a decimal like "1" or "2.5"' }) quantity: string;
  @Matches(DECIMAL, { message: 'unitPrice must be a decimal like "100.00"' }) unitPrice: string;
  @IsOptional() @Matches(MONEY_PATTERN, { message: 'discount must be a decimal amount like "5.00"' }) discount?: string;
  @IsUUID() taxRateId: string;
  /** Expense, asset or inventory account debited. */
  @IsUUID() accountId: string;
  @IsOptional() @IsUUID() costCenterId?: string;
}

export class CreatePurchaseBillDto {
  @IsOptional() @IsIn(Object.values(PurchaseDocumentType)) type?: PurchaseDocumentType;
  /** Supplier: required for bills and credit notes, optional for expenses. */
  @IsOptional() @IsUUID() contactId?: string;
  @IsOptional() @IsString() @MaxLength(100) supplierReference?: string;
  @IsDateOnly() billDate: string;
  @IsOptional() @IsDateOnly() dueDate?: string;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsBoolean() pricesIncludeTax?: boolean;
  /** Credit notes: the posted bill being credited. */
  @IsOptional() @IsUUID() originalBillId?: string;
  /** Expenses: the cash or bank account that paid. */
  @IsOptional() @IsUUID() paidFromAccountId?: string;
  @IsOptional() @IsString() @Length(1, 500) reason?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsUUID() branchId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  lines: PurchaseLineDto[];

  /** Post immediately instead of saving a draft. */
  @IsOptional() @IsBoolean() post?: boolean;
}

export class UpdatePurchaseBillDto extends OmitType(CreatePurchaseBillDto, ['post', 'type'] as const) {}

export class VoidPurchaseBillDto {
  @IsString() @Length(3, 500) reason: string;
}

export class PurchaseBillsQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(Object.values(PurchaseDocumentType)) type?: PurchaseDocumentType;
  @IsOptional() @IsIn(Object.values(PurchaseStatus)) status?: PurchaseStatus;
  @IsOptional() @IsUUID() contactId?: string;
  @IsOptional() @IsDateOnly() from?: string;
  @IsOptional() @IsDateOnly() to?: string;
  @IsOptional() @ToBoolean() @IsBoolean() open?: boolean;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}

export class SupplierAllocationDto {
  @IsUUID() billId: string;
  @Matches(MONEY_PATTERN, { message: 'amount must be a decimal amount like "100.00"' }) amount: string;
}

export class CreateSupplierPaymentDto {
  @IsUUID() contactId: string;
  @IsDateOnly() date: string;
  @Matches(MONEY_PATTERN, { message: 'amount must be a decimal amount like "100.00"' }) amount: string;
  /** Cash or bank account paying. */
  @IsUUID() accountId: string;
  @IsOptional() @IsIn(Object.values(PaymentMeans)) method?: PaymentMeans;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SupplierAllocationDto)
  allocations: SupplierAllocationDto[];
}

export class SupplierPaymentsQueryDto extends PageQueryDto {
  @IsOptional() @IsUUID() contactId?: string;
  @IsOptional() @IsIn(Object.values(SupplierPaymentStatus)) status?: SupplierPaymentStatus;
}
