import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import { IsDateOnly, ToBoolean } from '../../common/dto/validators.js';
import { TaxCategory } from '../../generated/prisma/enums.js';

const PERCENT = /^\d{1,3}(\.\d{1,4})?$/;

export class CreateTaxRateDto {
  @Matches(/^[0-9A-Za-z][0-9A-Za-z_-]{0,29}$/, { message: 'code must be 1-30 letters, digits, dashes or underscores' })
  code: string;

  @IsString() @Length(1, 150) name: string;
  @IsOptional() @IsString() @Length(1, 150) nameAr?: string;

  /** Percentage, e.g. "15" or "4.5". Fixed once created. */
  @Matches(PERCENT, { message: 'rate must be a percentage like "15" or "4.5"' }) rate: string;

  @IsIn(Object.values(TaxCategory)) category: TaxCategory;

  /** Zero-rating / exemption code printed on e-invoices (e.g. VATEX-SA-EDU). */
  @IsOptional() @IsString() @MaxLength(30) exemptionCode?: string;
  @IsOptional() @IsString() @MaxLength(300) exemptionReason?: string;

  /** Output tax account; defaults to the system VAT output account. */
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateTaxRateDto {
  @IsOptional() @IsString() @Length(1, 150) name?: string;
  @IsOptional() @IsString() @Length(1, 150) nameAr?: string;
  @IsOptional() @IsString() @MaxLength(30) exemptionCode?: string;
  @IsOptional() @IsString() @MaxLength(300) exemptionReason?: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class TaxRatesQueryDto {
  @IsOptional() @ToBoolean() @IsBoolean() includeInactive?: boolean;
}

export class VatReturnQueryDto {
  @IsDateOnly() from: string;
  @IsDateOnly() to: string;
}
