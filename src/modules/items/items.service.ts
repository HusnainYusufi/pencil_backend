import { Injectable } from '@nestjs/common';
import { Db } from '../../core/database/db.service.js';
import { AppException } from '../../core/errors/app.exception.js';
import { ErrorCode } from '../../core/errors/error-codes.js';
import type { AccountType, ItemType, TaxCodeKind } from '../../generated/prisma/enums.js';
import { SystemAccount } from '../accounting/chart-of-accounts/system-accounts.js';
import { AccountsRepository } from '../accounting/repositories/accounts.repository.js';
import { AuditService } from '../audit/audit.service.js';
import type { CreateItemDto, ItemsQueryDto, UpdateItemDto } from './dto/items.dto.js';
import { ItemsRepository, type ItemDetail } from './items.repository.js';

type FieldErrors = Array<{ field: string; errors: string[] }>;

/**
 * Products and services. Every item knows where it posts (revenue / cost
 * account) and how it is taxed (sales / purchase tax code), so invoice lines
 * are right by default. A company not registered for VAT / GST defaults to
 * out-of-scope sales: it may not charge tax.
 */
@Injectable()
export class ItemsService {
  constructor(
    private readonly db: Db,
    private readonly items: ItemsRepository,
    private readonly accounts: AccountsRepository,
    private readonly audit: AuditService,
  ) {}

  list(query: ItemsQueryDto) {
    return this.items.list(query).then((page) => ({ ...page, items: page.items.map(toItem) }));
  }

  async get(id: string) {
    return toItem(await this.require(id));
  }

  async create(dto: CreateItemDto) {
    const item = await this.db.transaction(async () => {
      if (await this.items.findByCode(dto.code)) {
        throw new AppException(ErrorCode.CONFLICT, `Item code '${dto.code}' is already used`, { field: 'code' });
      }
      const defaults = await this.defaults(dto.type);
      const data = {
        code: dto.code,
        type: dto.type,
        name: dto.name.trim(),
        nameAr: dto.nameAr?.trim() || null,
        description: dto.description?.trim() || null,
        unitCode: dto.unitCode ?? (dto.type === 'SERVICE' ? 'C62' : 'PCE'),
        salePrice: dto.salePrice ?? null,
        purchasePrice: dto.purchasePrice ?? null,
        salesAccountId: dto.salesAccountId === undefined ? defaults.salesAccountId : dto.salesAccountId,
        purchaseAccountId: dto.purchaseAccountId === undefined ? defaults.purchaseAccountId : dto.purchaseAccountId,
        salesTaxCodeId: dto.salesTaxCodeId === undefined ? defaults.salesTaxCodeId : dto.salesTaxCodeId,
        purchaseTaxCodeId: dto.purchaseTaxCodeId === undefined ? defaults.purchaseTaxCodeId : dto.purchaseTaxCodeId,
      };
      await this.validate(data);
      const created = await this.items.create(data);
      await this.audit.record({ action: 'item.created', entityType: 'item', entityId: created.id, metadata: { code: created.code } });
      return created;
    });
    return toItem(item);
  }

  async update(id: string, dto: UpdateItemDto) {
    const item = await this.db.transaction(async () => {
      const current = await this.require(id);
      if (dto.code && dto.code !== current.code && (await this.items.findByCode(dto.code))) {
        throw new AppException(ErrorCode.CONFLICT, `Item code '${dto.code}' is already used`, { field: 'code' });
      }
      const data = {
        type: dto.type ?? current.type,
        salesAccountId: dto.salesAccountId === undefined ? current.salesAccountId : dto.salesAccountId,
        purchaseAccountId: dto.purchaseAccountId === undefined ? current.purchaseAccountId : dto.purchaseAccountId,
        salesTaxCodeId: dto.salesTaxCodeId === undefined ? current.salesTaxCodeId : dto.salesTaxCodeId,
        purchaseTaxCodeId: dto.purchaseTaxCodeId === undefined ? current.purchaseTaxCodeId : dto.purchaseTaxCodeId,
      };
      await this.validate(data);
      const updated = await this.items.update(id, {
        ...data,
        code: dto.code,
        name: dto.name?.trim(),
        nameAr: dto.nameAr === undefined ? undefined : dto.nameAr?.trim() || null,
        description: dto.description === undefined ? undefined : dto.description?.trim() || null,
        unitCode: dto.unitCode,
        salePrice: dto.salePrice,
        purchasePrice: dto.purchasePrice,
        isActive: dto.isActive,
      });
      await this.audit.record({ action: 'item.updated', entityType: 'item', entityId: id, metadata: { changes: Object.keys(dto) } });
      return updated;
    });
    return toItem(item);
  }

  async delete(id: string): Promise<void> {
    await this.db.transaction(async () => {
      const item = await this.require(id);
      await this.items.delete(id);
      await this.audit.record({ action: 'item.deleted', entityType: 'item', entityId: id, metadata: { code: item.code } });
    });
  }

  private async require(id: string): Promise<ItemDetail> {
    const item = await this.items.findById(id);
    if (!item) throw AppException.notFound('Item', id);
    return item;
  }

  /** Revenue / cost accounts and tax codes an item gets when none are chosen. */
  private async defaults(type: ItemType) {
    const [sales, service, cogs, profile] = await Promise.all([
      this.accounts.findBySystemKey(SystemAccount.SALES),
      this.accounts.findBySystemKey(SystemAccount.SERVICE_REVENUE),
      this.accounts.findBySystemKey(SystemAccount.COGS),
      this.items.registration(),
    ]);
    const registered = profile?.registration !== 'NOT_REGISTERED';
    const [salesTax, purchaseTax] = await Promise.all([
      this.items.findTaxCodeByCode(registered ? 'S' : 'O'),
      this.items.findTaxCodeByCode('P-S'),
    ]);
    return {
      salesAccountId: (type === 'SERVICE' ? service?.id : sales?.id) ?? null,
      purchaseAccountId: type === 'GOODS' ? (cogs?.id ?? null) : null,
      salesTaxCodeId: salesTax?.kind === 'SALES' ? salesTax.id : null,
      purchaseTaxCodeId: purchaseTax?.kind === 'PURCHASE' ? purchaseTax.id : null,
    };
  }

  private async validate(data: {
    salesAccountId: string | null;
    purchaseAccountId: string | null;
    salesTaxCodeId: string | null;
    purchaseTaxCodeId: string | null;
  }): Promise<void> {
    const errors: FieldErrors = [];
    const checkAccount = async (field: string, id: string | null, types: AccountType[]) => {
      if (!id) return;
      const account = await this.accounts.findById(id);
      if (!account || account.isGroup || !account.isActive) return errors.push({ field, errors: ['account not found or not postable'] });
      if (!types.includes(account.type)) return errors.push({ field, errors: [`expected a ${types.join(' or ').toLowerCase()} account`] });
      // Control accounts (receivables, payables, VAT) are never an item's revenue or cost.
      if (!account.allowManualPosting) errors.push({ field, errors: ['control accounts cannot be used on items'] });
    };
    const checkTax = async (field: string, id: string | null, kind: TaxCodeKind) => {
      if (!id) return;
      const code = await this.items.findTaxCode(id);
      if (!code || !code.isActive || code.kind !== kind) errors.push({ field, errors: [`choose an active ${kind.toLowerCase()} tax code`] });
    };
    await checkAccount('salesAccountId', data.salesAccountId, ['REVENUE']);
    await checkAccount('purchaseAccountId', data.purchaseAccountId, ['EXPENSE', 'ASSET']);
    await checkTax('salesTaxCodeId', data.salesTaxCodeId, 'SALES');
    await checkTax('purchaseTaxCodeId', data.purchaseTaxCodeId, 'PURCHASE');
    if (errors.length) throw new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', errors);
  }
}

function toItem(item: ItemDetail) {
  const { tenantId: _tenant, ...rest } = item;
  return {
    ...rest,
    salePrice: item.salePrice?.toString() ?? null,
    purchasePrice: item.purchasePrice?.toString() ?? null,
  };
}
