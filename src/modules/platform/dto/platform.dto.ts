import { OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SearchPageQueryDto } from '../../../common/dto/pagination.dto.js';
import {
  BillingInterval,
  CountryCode,
  FeatureType,
  SubscriptionStatus,
  TenantStatus,
} from '../../../generated/prisma/enums.js';
import { CompanyDto } from '../../auth/dto/auth.dto.js';

// --- Tenants -----------------------------------------------------------------

export class TenantsQueryDto extends SearchPageQueryDto {
  @IsOptional() @IsIn(Object.values(TenantStatus)) status?: TenantStatus;
  @IsOptional() @IsIn(Object.values(CountryCode)) country?: CountryCode;
}

export class OnboardOwnerDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @Length(2, 150) fullName: string;
  /** Required when the email has no account yet (until email invites ship). */
  @IsOptional() @IsString() @Length(10, 128) password?: string;
}

export class OnboardTenantDto {
  @ValidateNested() @Type(() => CompanyDto) company: CompanyDto;
  @ValidateNested() @Type(() => OnboardOwnerDto) owner: OnboardOwnerDto;
  @IsOptional() @IsString() @MaxLength(50) planCode?: string;
}

export class UpdateTenantStatusDto {
  @IsIn(Object.values(TenantStatus)) status: TenantStatus;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class ChangeSubscriptionDto {
  @IsString() @MaxLength(50) planCode: string;
  @IsOptional() @IsIn(Object.values(SubscriptionStatus)) status?: SubscriptionStatus;
  @IsOptional() @IsIn(Object.values(BillingInterval)) billingInterval?: BillingInterval;
  @IsOptional() @IsDateString() currentPeriodEnd?: string;
}

export class FeatureOverrideDto {
  @IsBoolean() enabled: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) limitValue?: number | null;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsDateString() expiresAt?: string;
}

// --- Catalog -----------------------------------------------------------------

export class CreateFeatureDto {
  @Matches(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/, { message: 'key must be dotted snake_case, e.g. reports.advanced' })
  @MaxLength(100)
  key: string;

  @IsString() @Length(2, 150) name: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsIn(Object.values(FeatureType)) type: FeatureType;
}

export class UpdateFeatureDto extends PartialType(OmitType(CreateFeatureDto, ['key', 'type'] as const)) {}

export class PlanFeatureDto {
  @IsString() @MaxLength(100) featureKey: string;
  @IsBoolean() enabled: boolean;
  /** LIMIT features only; omit/null = unlimited. */
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) limitValue?: number | null;
}

export class PlanPriceDto {
  @Matches(/^[A-Z]{3}$/) currency: string;
  @IsIn(Object.values(BillingInterval)) interval: BillingInterval;
  /** Decimal string, up to 3 fraction digits (JOD). */
  @Matches(/^\d{1,11}(\.\d{1,3})?$/, { message: 'amount must be a decimal string like "99.000"' }) amount: string;
}

export class CreatePlanDto {
  @Matches(/^[a-z][a-z0-9_-]{1,49}$/) code: string;
  @IsString() @Length(2, 100) name: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() isPublic?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(365) trialDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;

  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => PlanFeatureDto) features: PlanFeatureDto[];
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => PlanPriceDto) prices: PlanPriceDto[];
}

export class UpdatePlanDto extends PartialType(OmitType(CreatePlanDto, ['code', 'features', 'prices'] as const)) {}

export class ReplacePlanFeaturesDto {
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => PlanFeatureDto) features: PlanFeatureDto[];
}

export class ReplacePlanPricesDto {
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => PlanPriceDto) prices: PlanPriceDto[];
}
