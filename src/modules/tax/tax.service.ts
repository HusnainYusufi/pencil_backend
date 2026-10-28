import { Injectable } from '@nestjs/common';
import { COUNTRY_PROFILES } from '../../common/constants/countries.js';
import { formatDateOnly, parseDateOnly } from '../../common/helpers/date.js';
import { Decimal } from '../../common/helpers/money.js';
import { Db } from '../../core/database/db.service.js';
import { AppException } from '../../core/errors/app.exception.js';
import { ErrorCode } from '../../core/errors/error-codes.js';
import type { AccountType } from '../../generated/prisma/enums.js';
import { AccountingContext } from '../accounting/accounting-context.service.js';
import { AccountsRepository } from '../accounting/repositories/accounts.repository.js';
import { AuditService } from '../audit/audit.service.js';
import { KSA_ADDRESS, type CreateTaxCodeDto, type TaxCodesQueryDto, type UpdateTaxCodeDto, type UpdateTaxProfileDto } from './dto/tax.dto.js';
import { rateOn, taxCodeProblems } from './tax-engine.js';
import { TaxRepository, type TaxCodeDetail } from './tax.repository.js';

const invalid = (errors: Array<{ field: string; errors: string[] }>) =>
  new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', errors);

/**
 * Tax codes and the company tax profile.
 *  - Country codes (isSystem) follow the law: their kind, treatment, e-invoice
 *    category, reason code and rate history cannot be edited here; Pencil
 *    ships rate changes as dated rates. Companies may re-map their accounts,
 *    rename them, or switch them off.
 *  - Company codes are checked for consistency (taxCodeProblems) and change
 *    rate only by appending a dated rate, never by rewriting history.
 */
@Injectable()
export class TaxService {
  constructor(
    private readonly db: Db,
    private readonly tax: TaxRepository,
    private readonly accounts: AccountsRepository,
    private readonly accounting: AccountingContext,
    private readonly audit: AuditService,
  ) {}

  async list(query: TaxCodesQueryDto) {
    const [codes, today] = await Promise.all([this.tax.listCodes(query), this.accounting.today()]);
    return codes.map((c) => toTaxCode(c, today));
  }

  async get(id: string) {
    return toTaxCode(await this.require(id), await this.accounting.today());
  }

  async create(dto: CreateTaxCodeDto) {
    const created = await this.db.transaction(async () => {
      if (await this.tax.findCodeByCode(dto.code)) {
        throw new AppException(ErrorCode.CONFLICT, `Tax code '${dto.code}' is already used`, { field: 'code' });
      }
      const shape = {
        kind: dto.kind,
        treatment: dto.treatment,
        recoverable: dto.kind === 'PURCHASE' ? (dto.recoverable ?? true) : true,
        taxAccountId: dto.taxAccountId ?? null,
        reverseChargeAccountId: dto.reverseChargeAccountId ?? null,
      };
      const problems = taxCodeProblems(shape, new Decimal(dto.rate.ratePercent).isPositive());
      if (new Decimal(dto.rate.ratePercent).greaterThan(100)) problems.push({ field: 'rate.ratePercent', errors: ['a rate cannot exceed 100%'] });
      if (problems.length) throw invalid(problems);
      await this.assertTaxAccounts(shape);

      const code = await this.tax.createCode(
        {
          code: dto.code,
          name: dto.name.trim(),
          nameAr: dto.nameAr.trim(),
          ...shape,
          einvoiceCategory: dto.einvoiceCategory ?? null,
          reasonCode: dto.reasonCode ?? null,
          reasonText: dto.reasonText ?? null,
          returnBox: dto.returnBox ?? null,
          isSystem: false,
          sortOrder: 1000,
        },
        { ratePercent: new Decimal(dto.rate.ratePercent).toFixed(4), effectiveFrom: parseDateOnly(dto.rate.effectiveFrom) },
      );
      await this.audit.record({ action: 'tax_code.created', entityType: 'tax_code', entityId: code.id, metadata: { code: code.code, ratePercent: dto.rate.ratePercent, effectiveFrom: dto.rate.effectiveFrom } });
      return code;
    });
    return toTaxCode(created, await this.accounting.today());
  }

  async update(id: string, dto: UpdateTaxCodeDto) {
    const updated = await this.db.transaction(async () => {
      const current = await this.require(id);
      const shape = {
        kind: current.kind,
        treatment: current.treatment,
        recoverable: current.recoverable,
        taxAccountId: dto.taxAccountId === undefined ? current.taxAccountId : dto.taxAccountId,
        reverseChargeAccountId: dto.reverseChargeAccountId === undefined ? current.reverseChargeAccountId : dto.reverseChargeAccountId,
      };
      const positive = current.rates.some((r) => new Decimal(r.ratePercent.toString()).isPositive());
      const problems = taxCodeProblems(shape, positive);
      if (problems.length) throw invalid(problems);
      await this.assertTaxAccounts(shape);

      const code = await this.tax.updateCode(id, {
        name: dto.name?.trim(),
        nameAr: dto.nameAr?.trim(),
        taxAccountId: dto.taxAccountId,
        reverseChargeAccountId: dto.reverseChargeAccountId,
        returnBox: current.isSystem ? undefined : dto.returnBox,
        reasonText: current.isSystem ? undefined : dto.reasonText,
        isActive: dto.isActive,
      });
      await this.audit.record({ action: 'tax_code.updated', entityType: 'tax_code', entityId: id, metadata: { changes: Object.keys(dto) } });
      return code;
    });
    return toTaxCode(updated, await this.accounting.today());
  }

  /** New rate from a date (e.g. a reduced-rate list change); history is never rewritten. */
  async addRate(id: string, ratePercent: string, effectiveFrom: string) {
    const updated = await this.db.transaction(async () => {
      const current = await this.require(id);
      if (current.isSystem) {
        throw new AppException(ErrorCode.TAX_CODE_PROTECTED, 'Rates of country tax codes follow the law and are updated by Pencil');
      }
      const from = parseDateOnly(effectiveFrom);
      const latest = current.rates.at(-1);
      if (latest && from <= latest.effectiveFrom) {
        throw invalid([{ field: 'effectiveFrom', errors: [`must be after ${formatDateOnly(latest.effectiveFrom)}, the start of the current rate`] }]);
      }
      const percent = new Decimal(ratePercent);
      const problems = taxCodeProblems(current, percent.isPositive());
      if (percent.greaterThan(100)) problems.push({ field: 'ratePercent', errors: ['a rate cannot exceed 100%'] });
      if (problems.length) throw invalid(problems);
      await this.tax.appendRate(id, percent.toFixed(4), from);
      await this.audit.record({ action: 'tax_code.rate_added', entityType: 'tax_code', entityId: id, metadata: { ratePercent, effectiveFrom } });
      return (await this.tax.findCode(id))!;
    });
    return toTaxCode(updated, await this.accounting.today());
  }

  /** Seller details for invoices, with what e-invoicing still needs. */
  async profile() {
    const [profile, company] = await Promise.all([this.tax.getProfile(), this.tax.getCompany()]);
    if (!profile || !company) throw AppException.notFound('Tax profile');
    return { ...profile, ...company, einvoiceReadiness: sellerReadiness(company, profile) };
  }

  async updateProfile(dto: UpdateTaxProfileDto) {
    await this.db.transaction(async () => {
      const company = (await this.tax.getCompany())!;
      const current = (await this.tax.getProfile())!;
      const errors: Array<{ field: string; errors: string[] }> = [];
      const blank = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);

      const taxNumber = blank(dto.taxNumber);
      if (taxNumber && !COUNTRY_PROFILES[company.country].taxNumberPattern.test(taxNumber)) {
        errors.push({ field: 'taxNumber', errors: [`not a valid ${company.country} tax registration number`] });
      }
      const registration = dto.registration ?? current.registration;
      if (company.country === 'SA' && registration === 'SPECIAL_SALES_TAX') {
        errors.push({ field: 'registration', errors: ['special sales tax applies in Jordan only'] });
      }
      if (registration !== 'NOT_REGISTERED' && (taxNumber === null || (taxNumber === undefined && !company.taxNumber))) {
        errors.push({ field: 'taxNumber', errors: ['a registered company needs its tax number'] });
      }
      const frequency = dto.filingFrequency ?? current.filingFrequency;
      const allowed = company.country === 'SA' ? ['MONTHLY', 'QUARTERLY'] : ['BIMONTHLY', 'MONTHLY'];
      if (!allowed.includes(frequency)) errors.push({ field: 'filingFrequency', errors: [`use ${allowed.join(' or ')} in ${company.country}`] });

      const address = {
        buildingNumber: blank(dto.buildingNumber),
        street: blank(dto.street),
        district: blank(dto.district),
        city: blank(dto.city),
        postalCode: blank(dto.postalCode),
        additionalNumber: blank(dto.additionalNumber),
      };
      if (company.country === 'SA') {
        for (const [field, pattern] of Object.entries(KSA_ADDRESS)) {
          const value = address[field as keyof typeof KSA_ADDRESS];
          if (value && !pattern.test(value)) errors.push({ field, errors: [`not a valid National Address ${field}`] });
        }
      }
      if (errors.length) throw invalid(errors);

      await this.tax.updateProfile({ registration, filingFrequency: frequency, ...address, activityNumber: blank(dto.activityNumber) });
      if (taxNumber !== undefined || dto.commercialRegistration !== undefined) {
        await this.tax.updateCompany({ taxNumber, commercialRegistration: blank(dto.commercialRegistration) });
      }
      await this.audit.record({ action: 'tax_profile.updated', entityType: 'tenant', entityId: company.id, metadata: { changes: Object.keys(dto) } });
    });
    return this.profile();
  }

  private async require(id: string): Promise<TaxCodeDetail> {
    const code = await this.tax.findCode(id);
    if (!code) throw AppException.notFound('Tax code', id);
    return code;
  }

  /** Tax accounts must be postable and on the right side of the balance sheet. */
  private async assertTaxAccounts(shape: { kind: string; recoverable: boolean; taxAccountId: string | null; reverseChargeAccountId: string | null }) {
    const expect: Array<[string, string | null, AccountType]> = [
      ['taxAccountId', shape.taxAccountId, shape.kind === 'PURCHASE' ? 'ASSET' : 'LIABILITY'],
      ['reverseChargeAccountId', shape.reverseChargeAccountId, 'LIABILITY'],
    ];
    const errors: Array<{ field: string; errors: string[] }> = [];
    for (const [field, id, type] of expect) {
      if (!id) continue;
      const account = await this.accounts.findById(id);
      if (!account || account.isGroup || !account.isActive) errors.push({ field, errors: ['account not found or not postable'] });
      else if (account.type !== type) errors.push({ field, errors: [`expected a ${type.toLowerCase()} account`] });
    }
    if (errors.length) throw invalid(errors);
  }
}

function toTaxCode(code: TaxCodeDetail, today: Date) {
  const current = rateOn(code.rates, today);
  return {
    id: code.id,
    code: code.code,
    name: code.name,
    nameAr: code.nameAr,
    kind: code.kind,
    treatment: code.treatment,
    einvoiceCategory: code.einvoiceCategory,
    reasonCode: code.reasonCode,
    reasonText: code.reasonText,
    recoverable: code.recoverable,
    returnBox: code.returnBox,
    isSystem: code.isSystem,
    isActive: code.isActive,
    taxAccount: code.taxAccount,
    reverseChargeAccount: code.reverseChargeAccount,
    currentRate: current ? new Decimal(current.ratePercent.toString()).toString() : null,
    rates: code.rates.map((r) => ({
      ratePercent: new Decimal(r.ratePercent.toString()).toString(),
      effectiveFrom: formatDateOnly(r.effectiveFrom),
      effectiveTo: r.effectiveTo ? formatDateOnly(r.effectiveTo) : null,
    })),
  };
}

/** Seller fields ZATCA (Phase 2) / JoFotara require before the first e-invoice. */
function sellerReadiness(
  company: { country: string; taxNumber: string | null; commercialRegistration: string | null },
  profile: { registration: string; buildingNumber: string | null; street: string | null; district: string | null; city: string | null; postalCode: string | null; activityNumber: string | null },
) {
  const missing: string[] = [];
  const need = (field: string, value: unknown) => {
    if (!value) missing.push(field);
  };
  if (company.country === 'SA') {
    if (profile.registration !== 'NOT_REGISTERED') need('taxNumber', company.taxNumber);
    need('commercialRegistration', company.commercialRegistration);
    for (const field of ['buildingNumber', 'street', 'district', 'city', 'postalCode'] as const) need(field, profile[field]);
  } else {
    need('taxNumber', company.taxNumber);
    need('activityNumber', profile.activityNumber);
    need('city', profile.city);
  }
  return { ready: missing.length === 0, missing };
}
