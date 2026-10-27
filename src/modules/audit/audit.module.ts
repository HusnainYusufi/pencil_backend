import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { AuditRepository } from './audit.repository.js';
import { AuditService } from './audit.service.js';

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditRepository, AuditService],
  exports: [AuditRepository, AuditService],
})
export class AuditModule {}
