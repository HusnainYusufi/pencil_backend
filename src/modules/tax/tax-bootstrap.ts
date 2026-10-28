import { parseDateOnly } from '../../common/helpers/date.js';
import { Decimal } from '../../common/helpers/money.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CountryCode } from '../../generated/prisma/enums.js';
import { defaultFilingFrequency, taxCodeTemplate, type TaxRateTemplate } from './tax-templates.js';

const rateKey = (percent: string, from: string, to?: string | null) => `${new Decimal(percent).toFixed(4)}|${from}|${to ?? ''}`;
const dateKey = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

const rateRows = (tenantId: string, rates: TaxRateTemplate[]) =>
  rates.map((r) => ({
    tenantId,
    ratePercent: new Decimal(r.percent).toFixed(4),
    effectiveFrom: parseDateOnly(r.from),
    effectiveTo: r.to ? parseDateOnly(r.to) : null,
  }));

/**
 * Brings a company's tax codes in line with its country template: adds
 * missing codes (mapped to the company's system accounts) and keeps the rate
 * history of system codes exactly as the law has it. A rate change is shipped
 * by adding a dated rate to the template; documents keep the rate they used.
 * Company-defined codes and the accounts a company re-mapped are left alone.
 */
export async function syncTaxCodes(
  client: Prisma.TransactionClient,
  tenant: { id: string; country: CountryCode },
): Promise<{ added: string[]; ratesUpdated: string[] }> {
  const [accounts, existing] = await Promise.all([
    client.account.findMany({ where: { tenantId: tenant.id, systemKey: { not: null } }, select: { id: true, systemKey: true } }),
    client.taxCode.findMany({ where: { tenantId: tenant.id }, include: { rates: true } }),
  ]);
  const accountId = (key?: string) => (key ? (accounts.find((a) => a.systemKey === key)?.id ?? null) : null);
  const added: string[] = [];
  const ratesUpdated: string[] = [];

  for (const [index, t] of taxCodeTemplate(tenant.country).entries()) {
    const current = existing.find((c) => c.code === t.code);
    if (!current) {
      await client.taxCode.create({
        data: {
          tenantId: tenant.id,
          code: t.code,
          name: t.name,
          nameAr: t.nameAr,
          kind: t.kind,
          treatment: t.treatment,
          einvoiceCategory: t.einvoiceCategory ?? null,
          reasonCode: t.reasonCode ?? null,
          reasonText: t.reasonText ?? null,
          taxAccountId: accountId(t.taxAccount),
          reverseChargeAccountId: accountId(t.reverseChargeAccount),
          recoverable: t.recoverable ?? true,
          returnBox: t.returnBox ?? null,
          isSystem: true,
          sortOrder: index,
          rates: { createMany: { data: rateRows(tenant.id, t.rates) } },
        },
      });
      added.push(t.code);
      continue;
    }
    if (!current.isSystem) continue;
    const want = t.rates.map((r) => rateKey(r.percent, r.from, r.to)).sort();
    const have = current.rates.map((r) => rateKey(r.ratePercent.toString(), dateKey(r.effectiveFrom)!, dateKey(r.effectiveTo))).sort();
    if (want.join() !== have.join()) {
      await client.taxRate.deleteMany({ where: { taxCodeId: current.id } });
      await client.taxRate.createMany({ data: rateRows(tenant.id, t.rates).map((r) => ({ ...r, taxCodeId: current.id })) });
      ratesUpdated.push(t.code);
    }
  }
  return { added, ratesUpdated };
}

/** Creates the company's tax profile once (registered when it has a VAT number / TIN). */
export async function ensureTaxProfile(
  client: Prisma.TransactionClient,
  tenant: { id: string; country: CountryCode; taxNumber?: string | null },
): Promise<boolean> {
  if (await client.companyTaxProfile.findUnique({ where: { tenantId: tenant.id }, select: { tenantId: true } })) return false;
  await client.companyTaxProfile.create({
    data: {
      tenantId: tenant.id,
      registration: tenant.country === 'SA' && !tenant.taxNumber ? 'NOT_REGISTERED' : 'REGISTERED',
      filingFrequency: defaultFilingFrequency(tenant.country),
    },
  });
  return true;
}
