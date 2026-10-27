import { Global, Module } from '@nestjs/common';
import { Db } from './db.service.js';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService, Db],
  exports: [PrismaService, Db],
})
export class DatabaseModule {}
