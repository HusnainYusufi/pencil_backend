import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireFeature, RequirePermissions, TenantAuth } from '../../core/security/decorators.js';
import { Permission } from '../access/permissions.js';
import { Feature } from '../entitlements/features.js';
import { ContactsService } from './contacts.service.js';
import { ContactsQueryDto, ContactStatementQueryDto, CreateContactDto, UpdateContactDto } from './dto/contacts.dto.js';

@ApiTags('Contacts')
@TenantAuth()
@RequireFeature(Feature.CONTACTS)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @ApiOperation({ summary: 'Customers and suppliers with their receivable / payable balances' })
  @RequirePermissions(Permission.CONTACTS_READ)
  list(@Query() query: ContactsQueryDto) {
    return this.contacts.list(query);
  }

  @Get('reconciliation')
  @ApiOperation({ summary: 'Receivable / payable control accounts against the sum of contact balances' })
  @RequirePermissions(Permission.CONTACTS_READ)
  reconciliation() {
    return this.contacts.reconciliation();
  }

  @Get(':id')
  @RequirePermissions(Permission.CONTACTS_READ)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.contacts.get(id);
  }

  @Get(':id/statement')
  @ApiOperation({ summary: 'Contact statement: receivable / payable postings with running balance' })
  @RequirePermissions(Permission.CONTACTS_READ)
  statement(@Param('id', ParseUUIDPipe) id: string, @Query() query: ContactStatementQueryDto) {
    return this.contacts.statement(id, query);
  }

  @Post()
  @RequirePermissions(Permission.CONTACTS_MANAGE)
  create(@Body() dto: CreateContactDto) {
    return this.contacts.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(Permission.CONTACTS_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateContactDto) {
    return this.contacts.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an unused contact (deactivate used ones instead)' })
  @RequirePermissions(Permission.CONTACTS_MANAGE)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.contacts.delete(id);
  }
}
