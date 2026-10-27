import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CountryCode } from '../../../generated/prisma/enums.js';
import { SUPPORTED_LOCALES } from '../../tenancy/dto/tenancy.dto.js';

/** Length over complexity (NIST 800-63B), plus at least one letter and digit. */
const PASSWORD_RULE = /^(?=.*[\p{L}])(?=.*\d).+$/u;

export class CompanyDto {
  @IsString() @Length(2, 200) legalName: string;
  @IsOptional() @IsString() @Length(2, 200) tradeName?: string;
  @IsIn(Object.values(CountryCode)) country: CountryCode;
  /** KSA VAT number / Jordan TIN; format checked per country. */
  @IsOptional() @IsString() @Matches(/^\d+$/, { message: 'taxNumber must contain digits only' }) taxNumber?: string;
  @IsOptional() @IsString() @Length(4, 32) commercialRegistration?: string;
  @IsOptional() @IsIn(SUPPORTED_LOCALES) locale?: string;
}

export class SignupDto {
  @IsString() @Length(2, 150) fullName: string;
  @IsEmail() @MaxLength(254) email: string;

  @IsString()
  @Length(10, 128)
  @Matches(PASSWORD_RULE, { message: 'password must contain at least one letter and one digit' })
  password: string;

  @IsOptional() @Matches(/^\+?[1-9]\d{7,14}$/, { message: 'phone must be in international format' }) phone?: string;
  @IsOptional() @IsIn(SUPPORTED_LOCALES) locale?: string;

  @ValidateNested() @Type(() => CompanyDto) company: CompanyDto;
}

export class LoginDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @Length(1, 128) password: string;
  /** Pre-select a company (otherwise auto-selected when the user has exactly one). */
  @IsOptional() @IsUUID() tenantId?: string;
}

export class RefreshDto {
  /** Optional for browsers: the httpOnly refresh cookie is used when absent. */
  @IsOptional() @IsString() @MaxLength(200) refreshToken?: string;
}

export class SwitchTenantDto {
  @IsUUID() tenantId: string;
}

export class PlatformLoginDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @Length(1, 128) password: string;
}
