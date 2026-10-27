import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ErrorCode } from './error-codes.js';

export class ErrorBody {
  @ApiProperty({ example: 'VALIDATION_FAILED' })
  code: ErrorCode;

  @ApiProperty({ example: 'Request validation failed' })
  message: string;

  @ApiPropertyOptional()
  details?: unknown;

  @ApiPropertyOptional({ example: '0193f0a2-3b7c-7d41-9c11-1a2b3c4d5e6f' })
  requestId?: string;
}

/** Every non-2xx response has exactly this shape. */
export class ErrorResponse {
  @ApiProperty({ type: ErrorBody })
  error: ErrorBody;
}
