import { Injectable } from '@nestjs/common';
import { Db } from '../../../core/database/db.service.js';
import { AppException } from '../../../core/errors/app.exception.js';
import { ErrorCode } from '../../../core/errors/error-codes.js';
import type { Account } from '../../../generated/prisma/client.js';
import { AuditService } from '../../audit/audit.service.js';
import type { AccountsQueryDto, CreateAccountDto, UpdateAccountDto } from '../dto/accounts.dto.js';
import { AccountsRepository } from '../repositories/accounts.repository.js';
import { SUBTYPE_TYPE } from './system-accounts.js';

/**
 * Chart-of-accounts rules:
 *  - the type follows from the subtype; a parent must be a group of the same type;
 *  - group-vs-postable is fixed at creation;
 *  - accounts with postings keep their type (history must stay meaningful);
 *  - system accounts (used by posting rules) can be renamed, never removed;
 *  - used accounts are deactivated, not deleted.
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly db: Db,
    private readonly accounts: AccountsRepository,
    private readonly audit: AuditService,
  ) {}

  list(query: AccountsQueryDto): Promise<Account[]> {
    return this.accounts.list(query);
  }

  async get(id: string): Promise<Account> {
    const account = await this.accounts.findById(id);
    if (!account) throw AppException.notFound('Account', id);
    return account;
  }

  async create(dto: CreateAccountDto): Promise<Account> {
    const type = SUBTYPE_TYPE[dto.subtype];
    return this.db.transaction(async () => {
      await this.assertCodeFree(dto.code);
      if (dto.parentId) await this.assertValidParent(dto.parentId, type);
      const account = await this.accounts.create({
        code: dto.code,
        name: dto.name.trim(),
        nameAr: dto.nameAr?.trim(),
        description: dto.description,
        type,
        subtype: dto.subtype,
        isGroup: dto.isGroup ?? false,
        parentId: dto.parentId ?? null,
      });
      await this.audit.record({ action: 'account.created', entityType: 'account', entityId: account.id, metadata: { code: account.code, name: account.name } });
      return account;
    });
  }

  async update(id: string, dto: UpdateAccountDto): Promise<Account> {
    return this.db.transaction(async () => {
      const account = await this.get(id);
      const nextType = dto.subtype ? SUBTYPE_TYPE[dto.subtype] : account.type;

      if (account.systemKey) {
        if (dto.subtype && dto.subtype !== account.subtype) {
          throw new AppException(ErrorCode.SYSTEM_ACCOUNT_PROTECTED, 'The category of a system account cannot change');
        }
        if (dto.isActive === false) {
          throw new AppException(ErrorCode.SYSTEM_ACCOUNT_PROTECTED, 'System accounts cannot be deactivated');
        }
      }
      if (nextType !== account.type) {
        if (account.isGroup ? await this.accounts.hasChildren(id) : await this.accounts.hasActivity(id)) {
          throw new AppException(ErrorCode.ACCOUNT_IN_USE, 'An account in use cannot change its type');
        }
      }
      if (dto.code && dto.code !== account.code) await this.assertCodeFree(dto.code);
      if (dto.parentId !== undefined && dto.parentId !== account.parentId && dto.parentId !== null) {
        await this.assertValidParent(dto.parentId, nextType, id);
      }
      if (dto.isActive === false && account.isGroup) {
        const activeChildren = (await this.accounts.list({})).some((a) => a.parentId === id);
        if (activeChildren) throw new AppException(ErrorCode.ACCOUNT_IN_USE, 'Deactivate the sub-accounts first');
      }

      const updated = await this.accounts.update(id, {
        code: dto.code,
        name: dto.name?.trim(),
        nameAr: dto.nameAr?.trim(),
        description: dto.description,
        subtype: dto.subtype,
        type: nextType,
        parentId: dto.parentId,
        isActive: dto.isActive,
      });
      await this.audit.record({ action: 'account.updated', entityType: 'account', entityId: id, metadata: { changes: Object.keys(dto) } });
      return updated;
    });
  }

  async delete(id: string): Promise<void> {
    await this.db.transaction(async () => {
      const account = await this.get(id);
      if (account.systemKey) {
        throw new AppException(ErrorCode.SYSTEM_ACCOUNT_PROTECTED, 'System accounts cannot be deleted');
      }
      if ((await this.accounts.hasChildren(id)) || (await this.accounts.hasActivity(id))) {
        throw new AppException(ErrorCode.ACCOUNT_IN_USE, 'This account is in use; deactivate it instead');
      }
      await this.accounts.delete(id);
      await this.audit.record({ action: 'account.deleted', entityType: 'account', entityId: id, metadata: { code: account.code } });
    });
  }

  private async assertCodeFree(code: string): Promise<void> {
    if (await this.accounts.findByCode(code)) {
      throw new AppException(ErrorCode.CONFLICT, `Account code '${code}' is already used`, { field: 'code' });
    }
  }

  private async assertValidParent(parentId: string, type: Account['type'], selfId?: string): Promise<void> {
    const parent = await this.accounts.findById(parentId);
    if (!parent) throw AppException.notFound('Parent account', parentId);
    if (!parent.isGroup) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', [
        { field: 'parentId', errors: ['parent must be a group account'] },
      ]);
    }
    if (parent.type !== type) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', [
        { field: 'parentId', errors: [`parent is a ${parent.type} group; this account is ${type}`] },
      ]);
    }
    // No cycles: the new parent must not be the account itself or one of its descendants.
    for (let cursor: Account | null = parent; cursor && selfId; ) {
      if (cursor.id === selfId) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', [
          { field: 'parentId', errors: ['an account cannot be moved under itself'] },
        ]);
      }
      cursor = cursor.parentId ? await this.accounts.findById(cursor.parentId) : null;
    }
  }
}
