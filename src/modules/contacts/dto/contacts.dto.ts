import { OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { SearchPageQueryDto } from '../../../common/dto/pagination.dto.js';
import { IsDateOnly, ToBoolean } from '../../../common/dto/validators.js';
import { ContactType, PartyIdScheme } from '../../../generated/prisma/enums.js';

export class ContactsQueryDto extends SearchPageQueryDto {
  @IsOptional() @IsIn(['customer', 'supplier']) role?: 'customer' | 'supplier';
  @IsOptional() @ToBoolean() @IsBoolean() includeInactive?: boolean;
}

export class CreateContactDto {
  @IsOptional() @Matches(/^[A-Za-z0-9][A-Za-z0-9.-]{0,29}$/, { message: 'code must be 1-30 letters, digits, dots or dashes' }) code?: string;
  @IsOptional() @IsIn(Object.values(ContactType)) type?: ContactType;
  @IsOptional() @IsBoolean() isCustomer?: boolean;
  @IsOptional() @IsBoolean() isSupplier?: boolean;
  @IsString() @Length(1, 200) name: string;
  @IsOptional() @IsString() @Length(1, 200) nameAr?: string;
  /** Checked against the contact's country (KSA VAT: 15 digits starting and ending with 3). */
  @IsOptional() @Matches(/^[A-Za-z0-9-]{3,32}$/, { message: 'taxNumber may contain letters, digits and dashes' }) taxNumber?: string;
  @IsOptional() @IsIn(Object.values(PartyIdScheme)) idScheme?: PartyIdScheme;
  @IsOptional() @IsString() @Length(1, 50) idNumber?: string;
  /** ISO 3166-1 alpha-2; defaults to the company's country. */
  @IsOptional() @Matches(/^[A-Z]{2}$/, { message: 'country must be an ISO 3166-1 alpha-2 code' }) country?: string;
  @IsOptional() @IsString() @Length(1, 10) buildingNumber?: string;
  @IsOptional() @IsString() @Length(1, 150) street?: string;
  @IsOptional() @IsString() @Length(1, 100) district?: string;
  @IsOptional() @IsString() @Length(1, 100) city?: string;
  @IsOptional() @IsString() @Length(1, 10) postalCode?: string;
  @IsOptional() @IsString() @Length(1, 10) additionalNumber?: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @Matches(/^\+?[1-9]\d{7,14}$/, { message: 'phone must be in international format' }) phone?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) paymentTermsDays?: number;
  @IsOptional() @IsUUID() withholdingTaxCodeId?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class UpdateContactDto extends PartialType(OmitType(CreateContactDto, [] as const)) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ContactStatementQueryDto {
  @IsOptional() @IsDateOnly() from?: string;
  @IsOptional() @IsDateOnly() to?: string;
}
