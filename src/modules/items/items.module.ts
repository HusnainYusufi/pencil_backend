import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequireFeature, RequirePermissions, TenantAuth } from '../../core/security/decorators.js';
import { Permission } from '../access/permissions.js';
import { AccountingModule } from '../accounting/accounting.module.js';
import { EntitlementsModule } from '../entitlements/entitlements.module.js';
import { Feature } from '../entitlements/features.js';
import { CreateItemDto, ItemsQueryDto, UpdateItemDto } from './dto/items.dto.js';
import { ItemsRepository } from './items.repository.js';
import { ItemsService } from './items.service.js';
import { UNIT_CODES } from './units.js';

@ApiTags('Items')
@TenantAuth()
@RequireFeature(Feature.ITEMS)
@Controller('items')
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  @RequirePermissions(Permission.ITEMS_READ)
  list(@Query() query: ItemsQueryDto) {
    return this.items.list(query);
  }

  @Get('units')
  @RequirePermissions(Permission.ITEMS_READ)
  units() {
    return UNIT_CODES;
  }

  @Get(':id')
  @RequirePermissions(Permission.ITEMS_READ)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.items.get(id);
  }

  @Post()
  @RequirePermissions(Permission.ITEMS_MANAGE)
  create(@Body() dto: CreateItemDto) {
    return this.items.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(Permission.ITEMS_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateItemDto) {
    return this.items.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permission.ITEMS_MANAGE)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.items.delete(id);
  }
}

/** Products and services catalog (stock tracking comes with inventory). */
@Module({
  imports: [AccountingModule, EntitlementsModule],
  controllers: [ItemsController],
  providers: [ItemsRepository, ItemsService],
  exports: [ItemsRepository, ItemsService],
})
export class ItemsModule {}
