import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { buildPage } from '../../common/helpers/pagination.js';
import { RequireFeature, RequirePermissions, TenantAuth } from '../../core/security/decorators.js';
import type { Contact } from '../../generated/prisma/client.js';
import { Permission } from '../access/permissions.js';
import { AccountingModule } from '../accounting/accounting.module.js';
import { Feature } from '../entitlements/features.js';
import { ContactsQueryDto, CreateContactDto, UpdateContactDto } from './contacts.dto.js';
import { ContactsRepository } from './contacts.repository.js';
import { ContactsService } from './contacts.service.js';

export function toContact(c: Contact) {
  return {
    id: c.id,
    type: c.type,
    isCustomer: c.isCustomer,
    isSupplier: c.isSupplier,
    code: c.code,
    name: c.name,
    nameAr: c.nameAr,
    email: c.email,
    phone: c.phone,
    taxNumber: c.taxNumber,
    idScheme: c.idScheme,
    idNumber: c.idNumber,
    address: {
      street: c.addressStreet,
      buildingNumber: c.addressBuildingNumber,
      additionalNumber: c.addressAdditionalNumber,
      district: c.addressDistrict,
      city: c.addressCity,
      postalCode: c.addressPostalCode,
      region: c.addressRegion,
      country: c.addressCountry,
    },
    paymentTermsDays: c.paymentTermsDays,
    notes: c.notes,
    isActive: c.isActive,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

@ApiTags('Contacts')
@TenantAuth()
@RequireFeature(Feature.SALES_INVOICES)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @RequirePermissions(Permission.CONTACTS_READ)
  async list(@Query() query: ContactsQueryDto) {
    const page = await this.contacts.list(query);
    return buildPage(page.items.map(toContact), page.meta.total, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Contact with its open receivable balance' })
  @RequirePermissions(Permission.CONTACTS_READ)
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const [contact, balance] = await Promise.all([this.contacts.get(id), this.contacts.balance(id)]);
    return { ...toContact(contact), balance };
  }

  @Post()
  @RequirePermissions(Permission.CONTACTS_MANAGE)
  async create(@Body() dto: CreateContactDto) {
    return toContact(await this.contacts.create(dto));
  }

  @Patch(':id')
  @RequirePermissions(Permission.CONTACTS_MANAGE)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateContactDto) {
    return toContact(await this.contacts.update(id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a contact without documents (deactivate otherwise)' })
  @RequirePermissions(Permission.CONTACTS_MANAGE)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.contacts.delete(id);
  }
}

/** Counterparties shared by sales (customers) and, later, purchases (suppliers). */
@Module({
  imports: [AccountingModule],
  controllers: [ContactsController],
  providers: [ContactsRepository, ContactsService],
  exports: [ContactsRepository, ContactsService],
})
export class ContactsModule {}
