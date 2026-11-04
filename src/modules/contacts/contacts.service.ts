import { Injectable } from '@nestjs/common';
import { COUNTRY_PROFILES } from '../../common/constants/countries.js';
import type { Page } from '../../common/helpers/pagination.js';
import { Db } from '../../core/database/db.service.js';
import { isUniqueViolation } from '../../core/database/prisma-errors.js';
import { AppException } from '../../core/errors/app.exception.js';
import { ErrorCode } from '../../core/errors/error-codes.js';
import type { Contact } from '../../generated/prisma/client.js';
import type { CountryCode } from '../../generated/prisma/enums.js';
import { AccountingContext } from '../accounting/accounting-context.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { ContactsQueryDto, CreateContactDto, UpdateContactDto } from './contacts.dto.js';
import { ContactsRepository } from './contacts.repository.js';

const invalid = (field: string, message: string) =>
  new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', [{ field, errors: [message] }]);

/**
 * Customers (and later suppliers). A contact is any counterparty: a company,
 * a person, a student's guardian. Documents keep their own frozen copy of the
 * buyer, so editing a contact never rewrites issued invoices.
 */
@Injectable()
export class ContactsService {
  constructor(
    private readonly db: Db,
    private readonly accounting: AccountingContext,
    private readonly contacts: ContactsRepository,
    private readonly audit: AuditService,
  ) {}

  list(query: ContactsQueryDto): Promise<Page<Contact>> {
    return this.contacts.list(query);
  }

  async get(id: string): Promise<Contact> {
    const contact = await this.contacts.findById(id);
    if (!contact) throw AppException.notFound('Contact', id);
    return contact;
  }

  balance(id: string): Promise<string> {
    return this.contacts.balance(id);
  }

  async create(dto: CreateContactDto): Promise<Contact> {
    await this.validate(dto);
    return this.db.transaction(async () => {
      const contact = await this.contacts.create(this.toData(dto)).catch(this.duplicateCode(dto.code));
      await this.audit.record({ action: 'contact.created', entityType: 'contact', entityId: contact.id });
      return contact;
    });
  }

  async update(id: string, dto: UpdateContactDto): Promise<Contact> {
    return this.db.transaction(async () => {
      const current = await this.get(id);
      await this.validate({ ...current, ...definedOnly(dto) } as CreateContactDto);
      const updated = await this.contacts.update(id, this.toData(dto)).catch(this.duplicateCode(dto.code));
      await this.audit.record({ action: 'contact.updated', entityType: 'contact', entityId: id, metadata: { changes: Object.keys(dto) } });
      return updated;
    });
  }

  async delete(id: string): Promise<void> {
    await this.db.transaction(async () => {
      await this.get(id);
      if (await this.contacts.hasDocuments(id)) {
        throw new AppException(ErrorCode.CONFLICT, 'This contact has documents; deactivate it instead');
      }
      await this.contacts.delete(id);
      await this.audit.record({ action: 'contact.deleted', entityType: 'contact', entityId: id });
    });
  }

  private async validate(dto: CreateContactDto): Promise<void> {
    if (dto.idNumber && !dto.idScheme) throw invalid('idScheme', 'choose the identification type for idNumber');
    if (dto.idScheme && !dto.idNumber) throw invalid('idNumber', 'idNumber is required with idScheme');
    if (dto.isCustomer === false && dto.isSupplier === false) throw invalid('isCustomer', 'a contact must be a customer, a supplier or both');
    if (dto.taxNumber) {
      const { country } = await this.accounting.profile();
      const contactCountry = (dto.addressCountry ?? country) as CountryCode;
      const profile = COUNTRY_PROFILES[contactCountry];
      if (profile && !profile.taxNumberPattern.test(dto.taxNumber)) {
        throw invalid('taxNumber', `taxNumber is not a valid ${contactCountry} tax registration number`);
      }
    }
  }

  private toData<T extends UpdateContactDto>(dto: T): T {
    return typeof dto.email === 'string' ? { ...dto, email: dto.email.toLowerCase() } : dto;
  }

  private duplicateCode(code: string | undefined) {
    return (error: unknown): never => {
      if (isUniqueViolation(error, 'code')) throw new AppException(ErrorCode.CONFLICT, `Code '${code}' is already used`, { field: 'code' });
      throw error;
    };
  }
}

/** Fields the request actually sent (null = clear, undefined = unchanged). */
const definedOnly = <T extends object>(value: T): Partial<T> =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
