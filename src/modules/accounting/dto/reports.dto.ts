import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { IsDateOnly, ToBoolean } from '../../../common/dto/validators.js';

class ReportRangeDto {
  /** Defaults to the start of the fiscal year containing `to`. */
  @IsOptional() @IsDateOnly() from?: string;
  /** Defaults to today. */
  @IsOptional() @IsDateOnly() to?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() costCenterId?: string;
}

export class TrialBalanceQueryDto extends ReportRangeDto {
  /** Include active accounts without balances or movements. */
  @IsOptional() @ToBoolean() @IsBoolean() includeZero?: boolean;
}

export class AccountStatementQueryDto extends ReportRangeDto {
  @IsOptional() @IsString() @MaxLength(512) cursor?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(500) limit: number = 100;
}
