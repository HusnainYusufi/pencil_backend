import { Injectable } from '@nestjs/common';
import { TenantScopedRepository } from '../../core/database/base.repository.js';
import type { Prisma, TaxCodeKind } from '../../generated/prisma/client.js';

const TAX_CODE_DETAIL = {
  rates: { orderBy: { effectiveFrom: 'asc' } },
  taxAccount: { select: { id: true, code: true, name: true, nameAr: true } },
  reverseChargeAccount: { select: { id: true, code: true, name: true, nameAr: true } },
} satisfies Prisma.TaxCodeInclude;

export type TaxCodeDetail = Prisma.TaxCodeGetPayload<{ include: typeof TAX_CODE_DETAIL }>;

@Injectable()
export class TaxRepository extends TenantScopedRepository {
  listCodes(filter: { kind?: TaxCodeKind; includeInactive?: boolean } = {}): Promise<TaxCodeDetail[]> {
    return this.client.taxCode.findMany({
      where: {
        tenantId: this.tenantId,
        ...(filter.kind && { kind: filter.kind }),
        ...(!filter.includeInactive && { isActive: true }),
      },
      include: TAX_CODE_DETAIL,
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { code: 'asc' }],
    });
  }

  findCode(id: string): Promise<TaxCodeDetail | null> {
    return this.client.taxCode.findFirst({ where: { id, tenantId: this.tenantId }, include: TAX_CODE_DETAIL });
  }

  findCodeByCode(code: string): Promise<TaxCodeDetail | null> {
    return this.client.taxCode.findFirst({ where: { code, tenantId: this.tenantId }, include: TAX_CODE_DETAIL });
  }

  createCode(data: Omit<Prisma.TaxCodeUncheckedCreateInput, 'tenantId' | 'rates'>, rate: { ratePercent: string; effectiveFrom: Date }) {
    const tenantId = this.tenantId;
    return this.client.taxCode.create({
      data: { ...data, tenantId, rates: { create: { tenantId, ratePercent: rate.ratePercent, effectiveFrom: rate.effectiveFrom } } },
      include: TAX_CODE_DETAIL,
    });
  }

  updateCode(id: string, data: Prisma.TaxCodeUncheckedUpdateInput) {
    return this.client.taxCode.update({ where: { id, tenantId: this.tenantId }, data, include: TAX_CODE_DETAIL });
  }

  /** Closes the open-ended rate the day before `from` and starts the new one. */
  async appendRate(taxCodeId: string, ratePercent: string, from: Date): Promise<void> {
    const tenantId = this.tenantId;
    const dayBefore = new Date(from.getTime() - 86_400_000);
    await this.client.taxRate.updateMany({ where: { tenantId, taxCodeId, effectiveTo: null }, data: { effectiveTo: dayBefore } });
    await this.client.taxRate.create({ data: { tenantId, taxCodeId, ratePercent, effectiveFrom: from } });
  }

  getProfile() {
    return this.client.companyTaxProfile.findUnique({ where: { tenantId: this.tenantId } });
  }

  updateProfile(data: Prisma.CompanyTaxProfileUncheckedUpdateInput) {
    return this.client.companyTaxProfile.update({ where: { tenantId: this.tenantId }, data });
  }

  getCompany() {
    return this.client.tenant.findUnique({
      where: { id: this.tenantId },
      select: { id: true, legalName: true, tradeName: true, country: true, baseCurrency: true, taxNumber: true, commercialRegistration: true },
    });
  }

  updateCompany(data: { taxNumber?: string | null; commercialRegistration?: string | null }) {
    return this.client.tenant.update({ where: { id: this.tenantId }, data });
  }
}
