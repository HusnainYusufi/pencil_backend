import { Injectable } from '@nestjs/common';
import { COUNTRY_PROFILES } from '../../common/constants/countries.js';
import { formatDateOnly, parseDateOnly } from '../../common/helpers/date.js';
import { Decimal, formatAmount } from '../../common/helpers/money.js';
import { Db } from '../../core/database/db.service.js';
import { AppException } from '../../core/errors/app.exception.js';
import { ErrorCode } from '../../core/errors/error-codes.js';
import type { CountryCode, PartyIdScheme } from '../../generated/prisma/enums.js';
import { AccountingContext } from '../accounting/accounting-context.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { ContactsQueryDto, ContactStatementQueryDto, CreateContactDto, UpdateContactDto } from './dto/contacts.dto.js';
import { ContactsRepository, type ContactBalances, type ContactWithTax } from './contacts.repository.js';

type FieldErrors = Array<{ field: string; errors: string[] }>;

/** KSA identification formats (ZATCA buyer ID schemes). */
const KSA_ID: Partial<Record<PartyIdScheme, RegExp>> = {
  NAT: /^1\d{9}$/,
  IQA: /^2\d{9}$/,
  CRN: /^\d{10}$/,
  UNIFIED_700: /^7\d{9}$/,
};
const KSA_ADDRESS: Record<string, RegExp> = { buildingNumber: /^\d{4}$/, postalCode: /^\d{5}$/, additionalNumber: /^\d{4}$/ };

/**
 * Customers and suppliers. Validation follows what ZATCA / JoFotara will ask
 * of the buyer on an invoice; e-invoice readiness is reported (not enforced)
 * here, and enforced when an invoice is issued.
 */
@Injectable()
export class ContactsService {
  constructor(
    private readonly db: Db,
    private readonly contacts: ContactsRepository,
    private readonly accounting: AccountingContext,
    private readonly audit: AuditService,
  ) {}

  async list(query: ContactsQueryDto) {
    const [page, profile] = await Promise.all([this.contacts.list(query), this.accounting.profile()]);
    const balances = await this.contacts.balances(page.items.map((c) => c.id));
    return { ...page, items: page.items.map((c) => toContact(c, profile.country, profile.baseCurrency, balances.get(c.id))) };
  }

  async get(id: string) {
    const [contact, profile] = await Promise.all([this.require(id), this.accounting.profile()]);
    const balances = await this.contacts.balances([id]);
    return toContact(contact, profile.country, profile.baseCurrency, balances.get(id));
  }

  async create(dto: CreateContactDto) {
    const profile = await this.accounting.profile();
    const created = await this.db.transaction(async () => {
      const data = this.normalize(dto, { country: profile.country, currency: profile.baseCurrency });
      await this.validate(data);
      if (data.code && (await this.contacts.findByCode(data.code))) {
        throw new AppException(ErrorCode.CONFLICT, `Contact code '${data.code}' is already used`, { field: 'code' });
      }
      const contact = await this.contacts.create(data);
      await this.audit.record({ action: 'contact.created', entityType: 'contact', entityId: contact.id, metadata: { name: contact.name } });
      return contact;
    });
    return toContact(created, profile.country, profile.baseCurrency, undefined);
  }

  async update(id: string, dto: UpdateContactDto) {
    const profile = await this.accounting.profile();
    const updated = await this.db.transaction(async () => {
      const current = await this.require(id);
      const merged = this.normalize({ ...stripNulls(current), ...dto }, { country: current.country, currency: current.currency });
      await this.validate(merged);
      if (merged.code && merged.code !== current.code && (await this.contacts.findByCode(merged.code))) {
        throw new AppException(ErrorCode.CONFLICT, `Contact code '${merged.code}' is already used`, { field: 'code' });
      }
      // A role with a balance cannot be dropped: the sub-ledger would lose its owner.
      const balance = (await this.contacts.balances([id])).get(id);
      if (current.isCustomer && !merged.isCustomer && balance && !balance.receivable.isZero()) {
        throw new AppException(ErrorCode.ACCOUNT_IN_USE, 'This customer still has a receivable balance', { field: 'isCustomer' });
      }
      if (current.isSupplier && !merged.isSupplier && balance && !balance.payable.isZero()) {
        throw new AppException(ErrorCode.ACCOUNT_IN_USE, 'This supplier still has a payable balance', { field: 'isSupplier' });
      }
      const contact = await this.contacts.update(id, { ...merged, isActive: dto.isActive });
      await this.audit.record({ action: 'contact.updated', entityType: 'contact', entityId: id, metadata: { changes: Object.keys(dto) } });
      return contact;
    });
    const balances = await this.contacts.balances([id]);
    return toContact(updated, profile.country, profile.baseCurrency, balances.get(id));
  }

  async delete(id: string): Promise<void> {
    await this.db.transaction(async () => {
      const contact = await this.require(id);
      if (await this.contacts.isUsed(id)) {
        throw new AppException(ErrorCode.ACCOUNT_IN_USE, 'This contact has transactions; deactivate it instead');
      }
      await this.contacts.delete(id);
      await this.audit.record({ action: 'contact.deleted', entityType: 'contact', entityId: id, metadata: { name: contact.name } });
    });
  }

  /** Receivable / payable statement with a running balance (positive = they owe us). */
  async statement(id: string, query: ContactStatementQueryDto) {
    const [contact, { baseCurrency }, today] = await Promise.all([this.require(id), this.accounting.profile(), this.accounting.today()]);
    const to = query.to ? parseDateOnly(query.to) : today;
    const from = query.from ? parseDateOnly(query.from) : new Date(Date.UTC(to.getUTCFullYear(), 0, 1));
    if (from > to) throw new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', [{ field: 'from', errors: ['from must be on or before to'] }]);

    const [opening, rows] = await Promise.all([this.contacts.netBefore(id, from), this.contacts.statementRows(id, from, to)]);
    let running = opening;
    const items = rows.map((r) => {
      const debit = new Decimal(r.debit.toString());
      const credit = new Decimal(r.credit.toString());
      running = running.plus(debit).minus(credit);
      return {
        id: r.id,
        date: formatDateOnly(r.date),
        journalEntryId: r.journalEntryId,
        number: r.journalEntry.number,
        source: r.journalEntry.source,
        reference: r.journalEntry.reference,
        description: r.description ?? r.journalEntry.memo,
        account: { code: r.account.code, name: r.account.name, nameAr: r.account.nameAr, systemKey: r.account.systemKey },
        debit: formatAmount(debit, baseCurrency),
        credit: formatAmount(credit, baseCurrency),
        balance: formatAmount(running, baseCurrency),
      };
    });
    return {
      contact: { id: contact.id, code: contact.code, name: contact.name, nameAr: contact.nameAr },
      from: formatDateOnly(from),
      to: formatDateOnly(to),
      currency: baseCurrency,
      openingBalance: formatAmount(opening, baseCurrency),
      closingBalance: formatAmount(running, baseCurrency),
      items,
    };
  }

  /** Receivables / payables control accounts against the sum of contact balances. */
  async reconciliation() {
    const { baseCurrency } = await this.accounting.profile();
    const rows = await this.contacts.reconciliation();
    return rows.map((r) => {
      // Present payables credit-positive.
      const sign = r.systemKey === 'accounts_payable' ? -1 : 1;
      const control = r.control.times(sign);
      const subledger = r.subledger.times(sign);
      return {
        ledger: r.systemKey === 'accounts_receivable' ? 'receivables' : 'payables',
        control: formatAmount(control, baseCurrency),
        subledger: formatAmount(subledger, baseCurrency),
        unassigned: formatAmount(control.minus(subledger), baseCurrency),
        reconciled: control.equals(subledger),
      };
    });
  }

  private async require(id: string): Promise<ContactWithTax> {
    const contact = await this.contacts.findById(id);
    if (!contact) throw AppException.notFound('Contact', id);
    return contact;
  }

  private normalize(dto: CreateContactDto & { isActive?: boolean }, defaults: { country: string; currency: string }) {
    const text = (v: string | null | undefined) => v?.trim() || null;
    return {
      code: text(dto.code),
      type: dto.type ?? 'BUSINESS',
      isCustomer: dto.isCustomer ?? false,
      isSupplier: dto.isSupplier ?? false,
      name: dto.name.trim(),
      nameAr: text(dto.nameAr),
      taxNumber: text(dto.taxNumber),
      idScheme: dto.idScheme ?? null,
      idNumber: text(dto.idNumber),
      country: dto.country ?? defaults.country,
      buildingNumber: text(dto.buildingNumber),
      street: text(dto.street),
      district: text(dto.district),
      city: text(dto.city),
      postalCode: text(dto.postalCode),
      additionalNumber: text(dto.additionalNumber),
      email: text(dto.email)?.toLowerCase() ?? null,
      phone: text(dto.phone),
      currency: defaults.currency,
      paymentTermsDays: dto.paymentTermsDays ?? 0,
      withholdingTaxCodeId: dto.withholdingTaxCodeId ?? null,
      notes: text(dto.notes),
    };
  }

  private async validate(data: ReturnType<ContactsService['normalize']>): Promise<void> {
    const errors: FieldErrors = [];
    const add = (field: string, error: string) => errors.push({ field, errors: [error] });

    if (!data.isCustomer && !data.isSupplier) add('isCustomer', 'a contact is a customer, a supplier, or both');
    if (data.taxNumber && (data.country === 'SA' || data.country === 'JO')) {
      if (!COUNTRY_PROFILES[data.country as CountryCode].taxNumberPattern.test(data.taxNumber)) {
        add('taxNumber', `not a valid ${data.country} tax registration number`);
      }
    }
    if ((data.idScheme === null) !== (data.idNumber === null)) add('idNumber', 'give both the ID type and the ID number');
    if (data.idScheme && data.idNumber && data.country === 'SA') {
      const pattern = KSA_ID[data.idScheme];
      if (pattern && !pattern.test(data.idNumber)) add('idNumber', `not a valid ${data.idScheme} number`);
    }
    if (data.country === 'SA') {
      for (const [field, pattern] of Object.entries(KSA_ADDRESS)) {
        const value = data[field as keyof typeof data] as string | null;
        if (value && !pattern.test(value)) add(field, `not a valid National Address ${field}`);
      }
    }
    if (data.withholdingTaxCodeId) {
      if (!data.isSupplier) add('withholdingTaxCodeId', 'withholding applies to suppliers only');
      const code = await this.contacts.findWithholdingCode(data.withholdingTaxCodeId);
      if (!code || code.kind !== 'WITHHOLDING' || !code.isActive) add('withholdingTaxCodeId', 'choose an active withholding tax code');
    }
    if (errors.length) throw new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', errors);
  }
}

const stripNulls = (contact: ContactWithTax): CreateContactDto => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(contact)) if (value !== null) out[key] = value;
  return out as unknown as CreateContactDto;
};

/**
 * What the buyer data still lacks for an e-invoice:
 *  - KSA standard (B2B) tax invoice: VAT number, or another ID; plus street,
 *    building number, postal code, district and city for Saudi buyers;
 *  - Jordan credit invoices: the buyer's name and an ID (TIN / national ID / passport).
 * Individuals in KSA receive simplified invoices, which need none of it.
 */
export function buyerReadiness(contact: Pick<ContactWithTax, 'type' | 'country' | 'taxNumber' | 'idNumber' | 'street' | 'buildingNumber' | 'postalCode' | 'district' | 'city' | 'isCustomer'>, companyCountry: CountryCode) {
  const missing: string[] = [];
  if (!contact.isCustomer) return { ready: true, invoiceType: null, missing };
  if (companyCountry === 'SA') {
    if (contact.type === 'INDIVIDUAL') return { ready: true, invoiceType: 'SIMPLIFIED', missing };
    if (!contact.taxNumber && !contact.idNumber) missing.push('taxNumberOrId');
    if (!contact.street) missing.push('street');
    if (!contact.city) missing.push('city');
    if (contact.country === 'SA') {
      if (!contact.buildingNumber) missing.push('buildingNumber');
      if (!contact.postalCode) missing.push('postalCode');
      if (!contact.district) missing.push('district');
    }
    return { ready: missing.length === 0, invoiceType: 'STANDARD', missing };
  }
  if (!contact.taxNumber && !contact.idNumber) missing.push('taxNumberOrId');
  return { ready: missing.length === 0, invoiceType: contact.type === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'BUSINESS', missing };
}

function toContact(contact: ContactWithTax, companyCountry: CountryCode, currency: string, balances: ContactBalances | undefined) {
  const { tenantId: _tenant, withholdingTaxCodeId: _wht, ...rest } = contact;
  return {
    ...rest,
    balances: {
      receivable: formatAmount(balances?.receivable ?? 0, currency),
      payable: formatAmount(balances?.payable ?? 0, currency),
    },
    einvoiceReadiness: buyerReadiness(contact, companyCountry),
  };
}
