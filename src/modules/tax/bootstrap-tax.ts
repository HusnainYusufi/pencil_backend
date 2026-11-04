import type { Prisma } from '../../generated/prisma/client.js';
import type { CountryCode } from '../../generated/prisma/enums.js';
import { SystemAccount } from '../accounting/chart-of-accounts/system-accounts.js';
import { taxRateTemplates } from './tax-templates.js';

/**
 * Seeds the country's tax rates for a company, posting to its `vat_output`
 * account. Runs after the chart of accounts exists: in the provisioning
 * transaction (system scope) and from the release backfill.
 */
export async function bootstrapTaxRates(
  client: Prisma.TransactionClient,
  tenant: { id: string; country: CountryCode },
): Promise<number> {
  const output = await client.account.findFirst({
    where: { tenantId: tenant.id, systemKey: SystemAccount.VAT_OUTPUT },
    select: { id: true },
  });
  if (!output) throw new Error(`Tenant ${tenant.id} has no ${SystemAccount.VAT_OUTPUT} account; bootstrap accounting first`);

  const { count } = await client.taxRate.createMany({
    data: taxRateTemplates(tenant.country).map((t) => ({
      tenantId: tenant.id,
      code: t.code,
      name: t.name,
      nameAr: t.nameAr,
      rate: t.rate,
      category: t.category,
      exemptionCode: t.exemptionCode ?? null,
      exemptionReason: t.exemptionReason ?? null,
      accountId: output.id,
      isDefault: t.isDefault ?? false,
    })),
  });
  return count;
}
