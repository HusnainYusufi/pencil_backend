import { todayIn } from '../../common/helpers/date.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CountryCode } from '../../generated/prisma/enums.js';
import { chartOfAccountsTemplate, templateLevels, typeOfTemplate } from './chart-of-accounts/templates.js';
import { fiscalYearContaining, fiscalYearName, monthlyPeriods } from './fiscal/fiscal-calendar.js';

export interface AccountingSeedTenant {
  id: string;
  country: CountryCode;
  timezone: string;
  fiscalYearStartMonth: number;
}

export interface AccountingSeedResult {
  accounts: number;
  fiscalYear: string;
}

/**
 * Makes a company ready to book transactions: the country chart of accounts,
 * the default branch and the current fiscal year with monthly periods.
 *
 * Pure data setup against a transaction client, shared by
 *  - tenant provisioning (AccountingBootstrapService, inside the provisioning tx), and
 *  - `prisma/backfill-accounting.ts` (companies created before the accounting module).
 * The caller must hold a scope that may write this tenant's rows (system scope).
 */
export async function bootstrapAccounting(
  client: Prisma.TransactionClient,
  tenant: AccountingSeedTenant,
): Promise<AccountingSeedResult> {
  // Accounts: one insert per tree level so children can reference parents.
  const idByCode = new Map<string, string>();
  for (const level of templateLevels(chartOfAccountsTemplate(tenant.country))) {
    const created = await client.account.createManyAndReturn({
      data: level.map((t) => ({
        tenantId: tenant.id,
        code: t.code,
        name: t.name,
        nameAr: t.nameAr,
        type: typeOfTemplate(t),
        subtype: t.subtype,
        isGroup: t.isGroup ?? false,
        systemKey: t.systemKey ?? null,
        parentId: t.parent ? idByCode.get(t.parent)! : null,
      })),
      select: { id: true, code: true },
    });
    for (const row of created) idByCode.set(row.code, row.id);
  }

  await client.branch.create({
    data: { tenantId: tenant.id, code: 'MAIN', name: 'Main branch', nameAr: 'الفرع الرئيسي', isDefault: true },
  });

  const year = fiscalYearContaining(todayIn(tenant.timezone), tenant.fiscalYearStartMonth);
  const name = fiscalYearName(year);
  await client.fiscalYear.create({
    data: {
      tenantId: tenant.id,
      name,
      startDate: year.start,
      endDate: year.end,
      periods: {
        createMany: {
          data: monthlyPeriods(year).map((p) => ({ tenantId: tenant.id, number: p.number, startDate: p.start, endDate: p.end })),
        },
      },
    },
  });

  return { accounts: idByCode.size, fiscalYear: name };
}
