import type { AccountSubtype, CountryCode } from '../../../generated/prisma/enums.js';
import { SUBTYPE_TYPE, SystemAccount, type SystemAccountKey } from './system-accounts.js';

export interface AccountTemplate {
  code: string;
  name: string;
  nameAr: string;
  subtype: AccountSubtype;
  parent?: string;
  isGroup?: boolean;
  systemKey?: SystemAccountKey;
}

interface CountryTerms {
  taxEn: string;
  taxAr: string;
  socialInsuranceEn: string;
  socialInsuranceAr: string;
  statutoryReserveAr: string;
  incomeLevyEn: string;
  incomeLevyAr: string;
  incomeLevyPayableEn: string;
  incomeLevyPayableAr: string;
  governmentFeesAr: string;
}

const TERMS: Record<CountryCode, CountryTerms> = {
  SA: {
    taxEn: 'VAT',
    taxAr: 'ضريبة القيمة المضافة',
    socialInsuranceEn: 'Social insurance (GOSI)',
    socialInsuranceAr: 'التأمينات الاجتماعية',
    statutoryReserveAr: 'الاحتياطي النظامي',
    incomeLevyEn: 'Zakat',
    incomeLevyAr: 'الزكاة',
    incomeLevyPayableEn: 'Zakat payable',
    incomeLevyPayableAr: 'الزكاة المستحقة',
    governmentFeesAr: 'الرسوم الحكومية',
  },
  JO: {
    taxEn: 'Sales tax',
    taxAr: 'ضريبة المبيعات',
    socialInsuranceEn: 'Social security',
    socialInsuranceAr: 'الضمان الاجتماعي',
    statutoryReserveAr: 'الاحتياطي الإجباري',
    incomeLevyEn: 'Income tax',
    incomeLevyAr: 'ضريبة الدخل',
    incomeLevyPayableEn: 'Income tax payable',
    incomeLevyPayableAr: 'ضريبة الدخل المستحقة',
    governmentFeesAr: 'رسوم ورخص حكومية',
  },
};

/**
 * Default chart of accounts for a new company: a practical SME chart that
 * follows the IFRS-for-SMEs statement structure used in both countries.
 * Codes: 1 assets, 2 liabilities, 3 equity, 4 revenue, 5 expenses.
 */
export function chartOfAccountsTemplate(country: CountryCode): AccountTemplate[] {
  const t = TERMS[country];
  return [
    { code: '1', name: 'Assets', nameAr: 'الأصول', subtype: 'OTHER_CURRENT_ASSET', isGroup: true },
    { code: '11', name: 'Current assets', nameAr: 'الأصول المتداولة', subtype: 'OTHER_CURRENT_ASSET', isGroup: true, parent: '1' },
    { code: '1101', name: 'Cash on hand', nameAr: 'النقدية في الصندوق', subtype: 'CASH', parent: '11', systemKey: SystemAccount.CASH },
    { code: '1102', name: 'Bank', nameAr: 'البنك', subtype: 'BANK', parent: '11', systemKey: SystemAccount.BANK },
    { code: '1103', name: 'Accounts receivable', nameAr: 'الذمم المدينة - العملاء', subtype: 'ACCOUNTS_RECEIVABLE', parent: '11', systemKey: SystemAccount.ACCOUNTS_RECEIVABLE },
    { code: '1104', name: 'Inventory', nameAr: 'المخزون', subtype: 'INVENTORY', parent: '11', systemKey: SystemAccount.INVENTORY },
    { code: '1105', name: 'Prepaid expenses', nameAr: 'مصروفات مدفوعة مقدماً', subtype: 'OTHER_CURRENT_ASSET', parent: '11' },
    { code: '1106', name: 'Employee advances', nameAr: 'سلف الموظفين', subtype: 'OTHER_CURRENT_ASSET', parent: '11' },
    { code: '1107', name: `${t.taxEn} input`, nameAr: `${t.taxAr} - المدخلات`, subtype: 'TAX_RECEIVABLE', parent: '11', systemKey: SystemAccount.VAT_INPUT },
    { code: '12', name: 'Non-current assets', nameAr: 'الأصول غير المتداولة', subtype: 'OTHER_NON_CURRENT_ASSET', isGroup: true, parent: '1' },
    { code: '1201', name: 'Property, plant and equipment', nameAr: 'الممتلكات والآلات والمعدات', subtype: 'FIXED_ASSET', parent: '12' },
    { code: '1202', name: 'Accumulated depreciation', nameAr: 'مجمع الإهلاك', subtype: 'ACCUMULATED_DEPRECIATION', parent: '12', systemKey: SystemAccount.ACCUMULATED_DEPRECIATION },
    { code: '1203', name: 'Intangible assets', nameAr: 'الأصول غير الملموسة', subtype: 'OTHER_NON_CURRENT_ASSET', parent: '12' },

    { code: '2', name: 'Liabilities', nameAr: 'الخصوم', subtype: 'OTHER_CURRENT_LIABILITY', isGroup: true },
    { code: '21', name: 'Current liabilities', nameAr: 'الخصوم المتداولة', subtype: 'OTHER_CURRENT_LIABILITY', isGroup: true, parent: '2' },
    { code: '2101', name: 'Accounts payable', nameAr: 'الذمم الدائنة - الموردون', subtype: 'ACCOUNTS_PAYABLE', parent: '21', systemKey: SystemAccount.ACCOUNTS_PAYABLE },
    { code: '2102', name: `${t.taxEn} output`, nameAr: `${t.taxAr} - المخرجات`, subtype: 'TAX_PAYABLE', parent: '21', systemKey: SystemAccount.VAT_OUTPUT },
    { code: '2103', name: `${t.taxEn} payable`, nameAr: `${t.taxAr} المستحقة`, subtype: 'TAX_PAYABLE', parent: '21', systemKey: SystemAccount.VAT_SETTLEMENT },
    { code: '2104', name: 'Accrued expenses', nameAr: 'مصروفات مستحقة', subtype: 'OTHER_CURRENT_LIABILITY', parent: '21' },
    { code: '2105', name: 'Salaries payable', nameAr: 'رواتب مستحقة', subtype: 'OTHER_CURRENT_LIABILITY', parent: '21' },
    { code: '2106', name: 'Unearned revenue', nameAr: 'إيرادات مؤجلة', subtype: 'OTHER_CURRENT_LIABILITY', parent: '21', systemKey: SystemAccount.UNEARNED_REVENUE },
    { code: '2107', name: 'Customer advances', nameAr: 'دفعات مقدمة من العملاء', subtype: 'OTHER_CURRENT_LIABILITY', parent: '21', systemKey: SystemAccount.CUSTOMER_ADVANCES },
    { code: '2108', name: t.incomeLevyPayableEn, nameAr: t.incomeLevyPayableAr, subtype: 'TAX_PAYABLE', parent: '21' },
    { code: '22', name: 'Non-current liabilities', nameAr: 'الخصوم غير المتداولة', subtype: 'NON_CURRENT_LIABILITY', isGroup: true, parent: '2' },
    { code: '2201', name: 'End-of-service benefits', nameAr: 'مخصص مكافأة نهاية الخدمة', subtype: 'NON_CURRENT_LIABILITY', parent: '22' },
    { code: '2202', name: 'Long-term loans', nameAr: 'قروض طويلة الأجل', subtype: 'NON_CURRENT_LIABILITY', parent: '22' },

    { code: '3', name: 'Equity', nameAr: 'حقوق الملكية', subtype: 'EQUITY', isGroup: true },
    { code: '3101', name: 'Capital', nameAr: 'رأس المال', subtype: 'EQUITY', parent: '3' },
    { code: '3102', name: 'Statutory reserve', nameAr: t.statutoryReserveAr, subtype: 'EQUITY', parent: '3' },
    { code: '3103', name: 'Retained earnings', nameAr: 'الأرباح المبقاة', subtype: 'RETAINED_EARNINGS', parent: '3', systemKey: SystemAccount.RETAINED_EARNINGS },
    { code: '3104', name: "Owner's drawings", nameAr: 'المسحوبات الشخصية', subtype: 'EQUITY', parent: '3' },
    { code: '3105', name: 'Opening balance equity', nameAr: 'أرصدة افتتاحية', subtype: 'EQUITY', parent: '3', systemKey: SystemAccount.OPENING_BALANCE_EQUITY },

    { code: '4', name: 'Revenue', nameAr: 'الإيرادات', subtype: 'OPERATING_REVENUE', isGroup: true },
    { code: '41', name: 'Operating revenue', nameAr: 'الإيرادات التشغيلية', subtype: 'OPERATING_REVENUE', isGroup: true, parent: '4' },
    { code: '4101', name: 'Sales', nameAr: 'المبيعات', subtype: 'OPERATING_REVENUE', parent: '41', systemKey: SystemAccount.SALES },
    { code: '4102', name: 'Service revenue', nameAr: 'إيرادات الخدمات', subtype: 'OPERATING_REVENUE', parent: '41', systemKey: SystemAccount.SERVICE_REVENUE },
    { code: '4103', name: 'Sales returns and discounts', nameAr: 'مردودات وخصومات المبيعات', subtype: 'OPERATING_REVENUE', parent: '41', systemKey: SystemAccount.SALES_RETURNS },
    { code: '42', name: 'Other income', nameAr: 'إيرادات أخرى', subtype: 'OTHER_REVENUE', isGroup: true, parent: '4' },
    { code: '4201', name: 'Miscellaneous income', nameAr: 'إيرادات متنوعة', subtype: 'OTHER_REVENUE', parent: '42' },
    { code: '4202', name: 'Foreign exchange gain', nameAr: 'أرباح فروقات العملة', subtype: 'OTHER_REVENUE', parent: '42', systemKey: SystemAccount.FX_GAIN },

    { code: '5', name: 'Expenses', nameAr: 'المصروفات', subtype: 'OPERATING_EXPENSE', isGroup: true },
    { code: '51', name: 'Cost of sales', nameAr: 'تكلفة المبيعات', subtype: 'COST_OF_SALES', isGroup: true, parent: '5' },
    { code: '5101', name: 'Cost of goods sold', nameAr: 'تكلفة البضاعة المباعة', subtype: 'COST_OF_SALES', parent: '51', systemKey: SystemAccount.COGS },
    { code: '52', name: 'Operating expenses', nameAr: 'المصروفات التشغيلية', subtype: 'OPERATING_EXPENSE', isGroup: true, parent: '5' },
    { code: '5201', name: 'Salaries and wages', nameAr: 'الرواتب والأجور', subtype: 'OPERATING_EXPENSE', parent: '52' },
    { code: '5202', name: t.socialInsuranceEn, nameAr: t.socialInsuranceAr, subtype: 'OPERATING_EXPENSE', parent: '52' },
    { code: '5203', name: 'Rent', nameAr: 'الإيجار', subtype: 'OPERATING_EXPENSE', parent: '52' },
    { code: '5204', name: 'Electricity and water', nameAr: 'الكهرباء والمياه', subtype: 'OPERATING_EXPENSE', parent: '52' },
    { code: '5205', name: 'Telecom and internet', nameAr: 'الاتصالات والإنترنت', subtype: 'OPERATING_EXPENSE', parent: '52' },
    { code: '5206', name: 'Government fees', nameAr: t.governmentFeesAr, subtype: 'OPERATING_EXPENSE', parent: '52' },
    { code: '5207', name: 'Marketing and advertising', nameAr: 'الدعاية والإعلان', subtype: 'OPERATING_EXPENSE', parent: '52' },
    { code: '5208', name: 'Office supplies', nameAr: 'مستلزمات مكتبية', subtype: 'OPERATING_EXPENSE', parent: '52' },
    { code: '5209', name: 'Professional fees', nameAr: 'أتعاب مهنية', subtype: 'OPERATING_EXPENSE', parent: '52' },
    { code: '5210', name: 'Maintenance and repairs', nameAr: 'الصيانة والإصلاحات', subtype: 'OPERATING_EXPENSE', parent: '52' },
    { code: '5211', name: 'Travel and transportation', nameAr: 'السفر والتنقلات', subtype: 'OPERATING_EXPENSE', parent: '52' },
    { code: '5212', name: 'Depreciation', nameAr: 'مصروف الإهلاك', subtype: 'OPERATING_EXPENSE', parent: '52', systemKey: SystemAccount.DEPRECIATION_EXPENSE },
    { code: '5213', name: 'Bank charges', nameAr: 'الرسوم البنكية', subtype: 'OPERATING_EXPENSE', parent: '52', systemKey: SystemAccount.BANK_CHARGES },
    { code: '53', name: 'Other expenses', nameAr: 'مصروفات أخرى', subtype: 'OTHER_EXPENSE', isGroup: true, parent: '5' },
    { code: '5301', name: 'Foreign exchange loss', nameAr: 'خسائر فروقات العملة', subtype: 'OTHER_EXPENSE', parent: '53', systemKey: SystemAccount.FX_LOSS },
    { code: '5302', name: 'Rounding differences', nameAr: 'فروقات التقريب', subtype: 'OTHER_EXPENSE', parent: '53', systemKey: SystemAccount.ROUNDING },
    { code: '5303', name: t.incomeLevyEn, nameAr: t.incomeLevyAr, subtype: 'OTHER_EXPENSE', parent: '53' },
  ];
}

/** Templates sorted parents-first, split into depth levels for bulk insert. */
export function templateLevels(templates: AccountTemplate[]): AccountTemplate[][] {
  const depth = new Map<string, number>();
  const byCode = new Map(templates.map((t) => [t.code, t]));
  const depthOf = (t: AccountTemplate): number => {
    const known = depth.get(t.code);
    if (known !== undefined) return known;
    const d = t.parent ? depthOf(byCode.get(t.parent)!) + 1 : 0;
    depth.set(t.code, d);
    return d;
  };
  const levels: AccountTemplate[][] = [];
  for (const t of templates) (levels[depthOf(t)] ??= []).push(t);
  return levels;
}

export const typeOfTemplate = (t: AccountTemplate) => SUBTYPE_TYPE[t.subtype];
