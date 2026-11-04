import { Injectable } from '@nestjs/common';
import { COUNTRY_PROFILES } from '../../common/constants/countries.js';
import { Decimal } from '../../common/helpers/money.js';
import { Db } from '../../core/database/db.service.js';
import { isUniqueViolation } from '../../core/database/prisma-errors.js';
import { AppException } from '../../core/errors/app.exception.js';
import { ErrorCode } from '../../core/errors/error-codes.js';
import type { TaxRate } from '../../generated/prisma/client.js';
import type { TaxCategory } from '../../generated/prisma/enums.js';
import { AccountingContext } from '../accounting/accounting-context.service.js';
import { SystemAccount } from '../accounting/chart-of-accounts/system-accounts.js';
import { AccountsRepository } from '../accounting/repositories/accounts.repository.js';
import { AuditService } from '../audit/audit.service.js';
import type { CreateTaxRateDto, UpdateTaxRateDto } from './tax.dto.js';
import { TaxRatesRepository } from './tax-rates.repository.js';

const invalid = (field: string, message: string) =>
  new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', [{ field, errors: [message] }]);

@Injectable()
export class TaxRatesService {
  constructor(
    private readonly db: Db,
    private readonly accounting: AccountingContext,
    private readonly taxRates: TaxRatesRepository,
    private readonly accounts: AccountsRepository,
    private readonly audit: AuditService,
  ) {}

  list(includeInactive = false): Promise<TaxRate[]> {
    return this.taxRates.list(includeInactive);
  }

  async get(id: string): Promise<TaxRate> {
    const rate = await this.taxRates.findById(id);
    if (!rate) throw AppException.notFound('Tax rate', id);
    return rate;
  }

  async create(dto: CreateTaxRateDto): Promise<TaxRate> {
    const rate = new Decimal(dto.rate);
    if (dto.category === 'STANDARD' ? rate.lte(0) || rate.gt(100) : !rate.isZero()) {
      throw invalid('rate', dto.category === 'STANDARD' ? 'a standard rate must be above 0 and at most 100' : `a ${dto.category} rate must be 0`);
    }
    await this.assertExemption(dto.category, dto.exemptionCode, dto.exemptionReason);

    return this.db.transaction(async () => {
      const accountId = await this.resolveAccount(dto.accountId);
      if (dto.isDefault) await this.taxRates.clearDefault();
      const created = await this.taxRates
        .create({
          code: dto.code,
          name: dto.name,
          nameAr: dto.nameAr ?? null,
          rate: rate.toFixed(4),
          category: dto.category,
          exemptionCode: dto.exemptionCode ?? null,
          exemptionReason: dto.exemptionReason ?? null,
          accountId,
          isDefault: dto.isDefault ?? false,
        })
        .catch((error: unknown) => {
          if (isUniqueViolation(error, 'code')) throw new AppException(ErrorCode.CONFLICT, `Code '${dto.code}' is already used`, { field: 'code' });
          throw error;
        });
      await this.audit.record({ action: 'tax_rate.created', entityType: 'tax_rate', entityId: created.id, metadata: { code: created.code } });
      return created;
    });
  }

  async update(id: string, dto: UpdateTaxRateDto): Promise<TaxRate> {
    return this.db.transaction(async () => {
      const current = await this.get(id);
      await this.assertExemption(
        current.category,
        dto.exemptionCode ?? current.exemptionCode ?? undefined,
        dto.exemptionReason ?? current.exemptionReason ?? undefined,
      );
      if (dto.isActive === false && (dto.isDefault ?? current.isDefault)) {
        throw invalid('isActive', 'the default tax rate cannot be deactivated; choose another default first');
      }
      const accountId = dto.accountId ? await this.resolveAccount(dto.accountId) : undefined;
      if (dto.isDefault && !current.isDefault) await this.taxRates.clearDefault();
      const updated = await this.taxRates.update(id, { ...dto, ...(accountId && { accountId }) });
      await this.audit.record({ action: 'tax_rate.updated', entityType: 'tax_rate', entityId: id, metadata: { changes: Object.keys(dto) } });
      return updated;
    });
  }

  private async assertExemption(category: TaxCategory, code: string | undefined, reason: string | undefined): Promise<void> {
    if (category === 'STANDARD') return;
    const { country } = await this.accounting.profile();
    if (COUNTRY_PROFILES[country].exemptionCodeRequired) {
      if (!code) throw invalid('exemptionCode', 'zero-rated, exempt and out-of-scope rates need the authority reason code');
      if (!reason) throw invalid('exemptionReason', 'zero-rated, exempt and out-of-scope rates need a reason');
    }
  }

  /** Output tax must land on an active, postable liability account. */
  private async resolveAccount(accountId: string | undefined): Promise<string> {
    const account = accountId
      ? await this.accounts.findById(accountId)
      : await this.accounts.findBySystemKey(SystemAccount.VAT_OUTPUT);
    if (!account) throw accountId ? AppException.notFound('Account', accountId) : AppException.notFound('VAT output account');
    if (account.isGroup || !account.isActive || account.type !== 'LIABILITY') {
      throw invalid('accountId', 'the tax account must be an active, postable liability account');
    }
    return account.id;
  }
}
