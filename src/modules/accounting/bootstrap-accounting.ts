import { todayIn } from '../../common/helpers/date.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CountryCode } from '../../generated/prisma/enums.js';
import { CONTROL_ACCOUNTS } from './chart-of-accounts/system-accounts.js';
import { chartOfAccountsTemplate, templateLevels, typeOfTemplate, type AccountTemplate } from './chart-of-accounts/templates.js';
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
  const idByCode = await insertTemplateAccounts(client, tenant.id, chartOfAccountsTemplate(tenant.country), new Map());

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

/** One insert per tree level so children can reference parents. */
async function insertTemplateAccounts(
  client: Prisma.TransactionClient,
  tenantId: string,
  templates: AccountTemplate[],
  idByCode: Map<string, string>,
): Promise<Map<string, string>> {
  for (const level of templateLevels(templates)) {
    const rows = level.filter((t) => !idByCode.has(t.code) && (!t.parent || idByCode.has(t.parent)));
    if (rows.length === 0) continue;
    const created = await client.account.createManyAndReturn({
      data: rows.map((t) => ({
        tenantId,
        code: t.code,
        name: t.name,
        nameAr: t.nameAr,
        type: typeOfTemplate(t),
        subtype: t.subtype,
        isGroup: t.isGroup ?? false,
        systemKey: t.systemKey ?? null,
        allowManualPosting: !(t.systemKey && CONTROL_ACCOUNTS.has(t.systemKey)),
        parentId: t.parent ? idByCode.get(t.parent)! : null,
      })),
      select: { id: true, code: true },
    });
    for (const row of created) idByCode.set(row.code, row.id);
  }
  return idByCode;
}

/**
 * Brings an existing company's chart up to the current country template:
 * adds template accounts whose code is still free (under their template
 * parent, when it exists). Never renames, moves or re-purposes accounts the
 * company already has, except the one-off zakat/income-tax reclassification
 * of the template's code 5303.
 */
export async function syncChartTemplate(
  client: Prisma.TransactionClient,
  tenant: Pick<AccountingSeedTenant, 'id' | 'country'>,
): Promise<{ added: string[] }> {
  const existing = await client.account.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, code: true, subtype: true, systemKey: true },
  });
  const idByCode = new Map(existing.map((a) => [a.code, a.id]));
  const before = new Set(idByCode.keys());
  const templates = chartOfAccountsTemplate(tenant.country);
  await insertTemplateAccounts(client, tenant.id, templates, idByCode);

  // Zakat / income tax used to sit under "other expenses"; IFRS for SMEs
  // presents it below profit before tax, so the category must follow.
  const levy = existing.find((a) => a.code === '5303' && a.subtype === 'OTHER_EXPENSE' && a.systemKey === null);
  if (levy) await client.account.update({ where: { id: levy.id }, data: { subtype: 'ZAKAT_AND_INCOME_TAX' } });

  return { added: [...idByCode.keys()].filter((code) => !before.has(code)) };
}
