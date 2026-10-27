import { PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { SearchPageQueryDto } from '../../../common/dto/pagination.dto.js';
import { isValidTimeZone } from '../../../common/helpers/date.js';

export const SUPPORTED_LOCALES = ['ar', 'en'] as const;

@ValidatorConstraint({ name: 'timeZone' })
class TimeZoneConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isValidTimeZone(value);
  }
  defaultMessage(): string {
    return 'timezone must be a valid IANA time zone';
  }
}

export class UpdateTenantDto {
  @IsOptional() @IsString() @Length(2, 200) tradeName?: string;
  /** Validated against the tenant's country format in the service. */
  @IsOptional() @IsString() @Matches(/^\d+$/, { message: 'taxNumber must contain digits only' }) taxNumber?: string;
  @IsOptional() @IsString() @Length(4, 32) commercialRegistration?: string;
  @IsOptional() @IsIn(SUPPORTED_LOCALES) locale?: string;
  @IsOptional() @Validate(TimeZoneConstraint) timezone?: string;
}

export class CreateRoleDto {
  @IsString() @Length(2, 100) name: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  /** Catalog permissions (`invoices.read`) or resource wildcards (`invoices.*`). */
  @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) permissions: string[];
}

export class UpdateRoleDto extends PartialType(CreateRoleDto) {}

export class UpdateMemberRoleDto {
  @IsUUID() roleId: string;
}

export class MembersQueryDto extends SearchPageQueryDto {}
