import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
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
} from 'class-validator';
import { SearchPageQueryDto } from '../../common/dto/pagination.dto.js';
import { ToBoolean } from '../../common/dto/validators.js';
import { ContactType } from '../../generated/prisma/enums.js';

/**
 * Identification schemes (ZATCA list, usable worldwide): commercial
 * registration, ministry licences, national ID, GCC / Iqama, passport,
 * foreign tax ID, other.
 */
export const ID_SCHEMES = ['CRN', 'MOM', 'MLS', '700', 'SAG', 'NAT', 'GCC', 'IQA', 'PAS', 'TIN', 'OTH'] as const;

export class CreateContactDto {
  @IsOptional() @IsIn(Object.values(ContactType)) type?: ContactType;
  @IsOptional() @IsBoolean() isCustomer?: boolean;
  @IsOptional() @IsBoolean() isSupplier?: boolean;

  @IsOptional()
  @Matches(/^[0-9A-Za-z][0-9A-Za-z_-]{0,29}$/, { message: 'code must be 1-30 letters, digits, dashes or underscores' })
  code?: string;

  @IsString() @Length(1, 200) name: string;
  @IsOptional() @IsString() @Length(1, 200) nameAr?: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @Matches(/^\+?[0-9 ()-]{6,32}$/, { message: 'phone must be a phone number' }) phone?: string;

  @IsOptional() @Matches(/^[0-9A-Za-z-]{3,32}$/, { message: 'taxNumber must be 3-32 letters or digits' }) taxNumber?: string;
  @IsOptional() @IsIn(ID_SCHEMES) idScheme?: string;
  @IsOptional() @IsString() @Length(1, 50) idNumber?: string;

  @IsOptional() @IsString() @Length(1, 200) addressStreet?: string;
  @IsOptional() @IsString() @Length(1, 20) addressBuildingNumber?: string;
  @IsOptional() @IsString() @Length(1, 20) addressAdditionalNumber?: string;
  @IsOptional() @IsString() @Length(1, 100) addressDistrict?: string;
  @IsOptional() @IsString() @Length(1, 100) addressCity?: string;
  @IsOptional() @IsString() @Length(1, 20) addressPostalCode?: string;
  @IsOptional() @IsString() @Length(1, 100) addressRegion?: string;
  @IsOptional() @Matches(/^[A-Z]{2}$/, { message: 'addressCountry must be an ISO 3166-1 alpha-2 code' }) addressCountry?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) paymentTermsDays?: number;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class UpdateContactDto extends PartialType(CreateContactDto) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ContactsQueryDto extends SearchPageQueryDto {
  @IsOptional() @ToBoolean() @IsBoolean() includeInactive?: boolean;
  @IsOptional() @ToBoolean() @IsBoolean() customers?: boolean;
}
