import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, ValidateIf } from 'class-validator';
import { SearchPageQueryDto } from '../../../common/dto/pagination.dto.js';
import { ToBoolean } from '../../../common/dto/validators.js';
import { ItemType } from '../../../generated/prisma/enums.js';
import { UNIT_CODES } from '../units.js';

/** Unit prices may be finer than the currency (e.g. 0.125 per gram): up to 4 decimals. */
const PRICE = /^\d{1,15}(\.\d{1,4})?$/;

export class ItemsQueryDto extends SearchPageQueryDto {
  @IsOptional() @IsIn(Object.values(ItemType)) type?: ItemType;
  @IsOptional() @ToBoolean() @IsBoolean() includeInactive?: boolean;
}

export class CreateItemDto {
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/, { message: 'code must be 1-40 letters, digits or . _ / -' }) code: string;
  @IsIn(Object.values(ItemType)) type: ItemType;
  @IsString() @Length(1, 200) name: string;
  @IsOptional() @IsString() @Length(1, 200) nameAr?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsIn(UNIT_CODES) unitCode?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @Matches(PRICE, { message: 'salePrice must be a decimal string with up to 4 decimals' }) salePrice?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @Matches(PRICE, { message: 'purchasePrice must be a decimal string with up to 4 decimals' }) purchasePrice?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() salesAccountId?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() purchaseAccountId?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() salesTaxCodeId?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() purchaseTaxCodeId?: string | null;
}

export class UpdateItemDto extends PartialType(CreateItemDto) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}
