import { IsBoolean, IsOptional, IsString, Length, Matches } from 'class-validator';
import { ToBoolean } from '../../../common/dto/validators.js';

export class CreateDimensionDto {
  @Matches(/^[0-9A-Za-z][0-9A-Za-z_-]{0,19}$/, { message: 'code must be 1-20 letters, digits, dashes or underscores' })
  code: string;

  @IsString() @Length(1, 150) name: string;
  @IsOptional() @IsString() @Length(1, 150) nameAr?: string;
}

export class UpdateDimensionDto {
  @IsOptional() @IsString() @Length(1, 150) name?: string;
  @IsOptional() @IsString() @Length(1, 150) nameAr?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class IncludeInactiveQueryDto {
  @IsOptional() @ToBoolean() @IsBoolean() includeInactive?: boolean;
}
