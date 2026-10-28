import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module.js';
import { EntitlementsModule } from '../entitlements/entitlements.module.js';
import { ContactsController } from './contacts.controller.js';
import { ContactsRepository } from './contacts.repository.js';
import { ContactsService } from './contacts.service.js';

/** Customers and suppliers, and their receivable / payable sub-ledgers. */
@Module({
  imports: [AccountingModule, EntitlementsModule],
  controllers: [ContactsController],
  providers: [ContactsRepository, ContactsService],
  exports: [ContactsRepository, ContactsService],
})
export class ContactsModule {}
