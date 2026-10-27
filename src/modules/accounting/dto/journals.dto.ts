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
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/pagination.dto.js';
import { IsDateOnly, MONEY_PATTERN } from '../../../common/dto/validators.js';
import { JournalSource, JournalStatus } from '../../../generated/prisma/enums.js';

export class JournalLineDto {
  @IsUUID() accountId: string;
  /** Decimal string; give either `debit` or `credit`. */
  @IsOptional() @Matches(MONEY_PATTERN, { message: 'debit must be a decimal string like "100.00"' }) debit?: string;
  @IsOptional() @Matches(MONEY_PATTERN, { message: 'credit must be a decimal string like "100.00"' }) credit?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() costCenterId?: string;
}

export class CreateJournalEntryDto {
  @IsDateOnly() date: string;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsString() @MaxLength(1000) memo?: string;
  /** Defaults to the company's base currency. */
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsIn(['MANUAL', 'OPENING_BALANCE']) source?: 'MANUAL' | 'OPENING_BALANCE';

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines: JournalLineDto[];

  /** Post immediately instead of saving a draft. */
  @IsOptional() @IsBoolean() post?: boolean;
}

export class UpdateJournalEntryDto extends OmitType(CreateJournalEntryDto, ['post'] as const) {}

export class ReverseJournalEntryDto {
  /** Defaults to today (company time zone). */
  @IsOptional() @IsDateOnly() date?: string;
  @IsOptional() @IsString() @MaxLength(1000) memo?: string;
}

export class JournalsQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(Object.values(JournalStatus)) status?: JournalStatus;
  @IsOptional() @IsIn(Object.values(JournalSource)) source?: JournalSource;
  @IsOptional() @IsDateOnly() from?: string;
  @IsOptional() @IsDateOnly() to?: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}
