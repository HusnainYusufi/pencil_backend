import { IsOptional, IsString, Length, ValidateIf } from 'class-validator';
import { IsDateOnly } from '../../../common/dto/validators.js';

/** `null` clears a date; an omitted field is left unchanged. */
export class UpdateBooksSettingsDto {
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsDateOnly() lockDate?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsDateOnly() taxLockDate?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsDateOnly() openingBalanceDate?: string | null;
  /** Required when a lock date moves back or is removed (kept in the audit log). */
  @IsOptional() @IsString() @Length(10, 500) reason?: string;
}

/** Reopening closed periods and years always records why. */
export class ReopenDto {
  @IsString() @Length(10, 500) reason: string;
}
