import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsDateOnly, ToBoolean } from '../../../common/dto/validators.js';
import { TaxCodeKind, TaxFilingFrequency, TaxRegistration, TaxTreatment } from '../../../generated/prisma/enums.js';

const PERCENT = /^\d{1,3}(\.\d{1,4})?$/;
const CODE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,29}$/;

export class TaxCodesQueryDto {
  @IsOptional() @IsIn(Object.values(TaxCodeKind)) kind?: TaxCodeKind;
  @IsOptional() @ToBoolean() @IsBoolean() includeInactive?: boolean;
}

export class TaxRateDto {
  /** Percent as a decimal string, e.g. "15" or "2.5". */
  @Matches(PERCENT, { message: 'ratePercent must be a percentage like "15" or "2.5"' }) ratePercent: string;
  @IsDateOnly() effectiveFrom: string;
}

/** A company-defined tax code (country codes come from the template). */
export class CreateTaxCodeDto {
  @Matches(CODE, { message: 'code must be 1-30 letters, digits, dots or dashes' }) code: string;
  @IsString() @Length(1, 150) name: string;
  @IsString() @Length(1, 150) nameAr: string;
  @IsIn(Object.values(TaxCodeKind)) kind: TaxCodeKind;
  @IsIn(Object.values(TaxTreatment)) treatment: TaxTreatment;
  @IsOptional() @Matches(/^[A-Z]{1,2}$/) einvoiceCategory?: string;
  @IsOptional() @IsString() @MaxLength(30) reasonCode?: string;
  @IsOptional() @IsString() @MaxLength(300) reasonText?: string;
  @IsOptional() @IsUUID() taxAccountId?: string;
  @IsOptional() @IsUUID() reverseChargeAccountId?: string;
  @IsOptional() @IsBoolean() recoverable?: boolean;
  @IsOptional() @IsString() @MaxLength(30) returnBox?: string;
  @ValidateNested() @Type(() => TaxRateDto) rate: TaxRateDto;
}

/** Kind, treatment and rates are fixed once created (rates change by adding a dated rate). */
export class UpdateTaxCodeDto {
  @IsOptional() @IsString() @Length(1, 150) name?: string;
  @IsOptional() @IsString() @Length(1, 150) nameAr?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() taxAccountId?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() reverseChargeAccountId?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(30) returnBox?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(300) reasonText?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

const DIGITS = (n: number) => new RegExp(`^\\d{${n}}$`);

export class UpdateTaxProfileDto {
  @IsOptional() @IsIn(Object.values(TaxRegistration)) registration?: TaxRegistration;
  @IsOptional() @IsIn(Object.values(TaxFilingFrequency)) filingFrequency?: TaxFilingFrequency;
  /** VAT registration number (KSA) / TIN (Jordan); format checked per country. */
  @IsOptional() @ValidateIf((_o, v) => v !== null) @Matches(/^\d+$/, { message: 'taxNumber must contain digits only' }) taxNumber?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @Length(4, 32) commercialRegistration?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @Length(1, 10) buildingNumber?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @Length(1, 150) street?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @Length(1, 100) district?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @Length(1, 100) city?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @Length(1, 10) postalCode?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @Length(1, 10) additionalNumber?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @Length(1, 30) activityNumber?: string | null;
}

/** KSA National Address formats (Saudi Post). */
export const KSA_ADDRESS = { buildingNumber: DIGITS(4), postalCode: DIGITS(5), additionalNumber: DIGITS(4) } as const;
