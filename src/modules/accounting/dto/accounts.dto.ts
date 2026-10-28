import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, ValidateIf } from 'class-validator';
import { ToBoolean } from '../../../common/dto/validators.js';
import { AccountSubtype, AccountType } from '../../../generated/prisma/enums.js';

const ACCOUNT_CODE = /^[0-9A-Za-z][0-9A-Za-z.-]{0,19}$/;

export class AccountsQueryDto {
  @IsOptional() @IsIn(Object.values(AccountType)) type?: AccountType;
  @IsOptional() @ToBoolean() @IsBoolean() includeInactive?: boolean;
  @IsOptional() @ToBoolean() @IsBoolean() postableOnly?: boolean;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}

export class CreateAccountDto {
  @Matches(ACCOUNT_CODE, { message: 'code must be 1-20 letters, digits, dots or dashes' }) code: string;
  @IsString() @Length(1, 150) name: string;
  @IsOptional() @IsString() @Length(1, 150) nameAr?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  /** The account category; the type (asset, liability, ...) follows from it. */
  @IsIn(Object.values(AccountSubtype)) subtype: AccountSubtype;
  @IsOptional() @IsUUID() parentId?: string;
  /** Group accounts organise the tree and cannot be posted to. */
  @IsOptional() @IsBoolean() isGroup?: boolean;
}

export class UpdateAccountDto {
  @IsOptional() @Matches(ACCOUNT_CODE, { message: 'code must be 1-20 letters, digits, dots or dashes' }) code?: string;
  @IsOptional() @IsString() @Length(1, 150) name?: string;
  @IsOptional() @IsString() @Length(1, 150) nameAr?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsIn(Object.values(AccountSubtype)) subtype?: AccountSubtype;
  /** `null` moves the account to the top level. */
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() parentId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  /** Control accounts accept no manual journals (changing it needs books.close). */
  @IsOptional() @IsBoolean() allowManualPosting?: boolean;
}
