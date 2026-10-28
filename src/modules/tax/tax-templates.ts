import type { CountryCode, TaxCodeKind, TaxTreatment } from '../../generated/prisma/enums.js';
import { SystemAccount, type SystemAccountKey } from '../accounting/chart-of-accounts/system-accounts.js';

export interface TaxRateTemplate {
  percent: string;
  /** YYYY-MM-DD, inclusive. */
  from: string;
  to?: string;
}

export interface TaxCodeTemplate {
  code: string;
  name: string;
  nameAr: string;
  kind: TaxCodeKind;
  treatment: TaxTreatment;
  einvoiceCategory?: string;
  reasonCode?: string;
  reasonText?: string;
  taxAccount?: SystemAccountKey;
  reverseChargeAccount?: SystemAccountKey;
  recoverable?: boolean;
  returnBox?: string;
  rates: TaxRateTemplate[];
}

/** KSA VAT: 5% from 2018-01-01, 15% from 2020-07-01 (Royal Decree A/638). */
const KSA_STANDARD: TaxRateTemplate[] = [
  { percent: '5', from: '2018-01-01', to: '2020-06-30' },
  { percent: '15', from: '2020-07-01' },
];
const ZERO: TaxRateTemplate[] = [{ percent: '0', from: '2018-01-01' }];
/** Income Tax Law (Royal Decree M/1, effective 1425H / 30 July 2004). */
const ksaWithholding = (percent: string): TaxRateTemplate[] => [{ percent, from: '2004-07-30' }];

/**
 * ZATCA VAT codes. Categories and VATEX reason codes follow the ZATCA XML
 * Implementation Standard; return boxes follow the VAT return layout
 * (1 standard sales, 2 citizens' healthcare/education, 3 zero-rated domestic,
 * 4 exports, 5 exempt, 7 standard purchases, 8 imports at customs,
 * 9 reverse-charge imports, 10 zero-rated purchases, 11 exempt purchases).
 */
const SAUDI: TaxCodeTemplate[] = [
  { code: 'S', name: 'Standard rate', nameAr: 'النسبة الأساسية', kind: 'SALES', treatment: 'STANDARD', einvoiceCategory: 'S', taxAccount: SystemAccount.VAT_OUTPUT, returnBox: '1', rates: KSA_STANDARD },
  { code: 'Z-HEA', name: 'Private healthcare to citizens', nameAr: 'الخدمات الصحية الخاصة للمواطنين', kind: 'SALES', treatment: 'ZERO_RATED', einvoiceCategory: 'Z', reasonCode: 'VATEX-SA-HEA', reasonText: 'Private healthcare to citizen', taxAccount: SystemAccount.VAT_OUTPUT, returnBox: '2', rates: ZERO },
  { code: 'Z-EDU', name: 'Private education to citizens', nameAr: 'التعليم الخاص للمواطنين', kind: 'SALES', treatment: 'ZERO_RATED', einvoiceCategory: 'Z', reasonCode: 'VATEX-SA-EDU', reasonText: 'Private education to citizen', taxAccount: SystemAccount.VAT_OUTPUT, returnBox: '2', rates: ZERO },
  { code: 'Z-TRN', name: 'International transport of goods', nameAr: 'النقل الدولي للبضائع', kind: 'SALES', treatment: 'ZERO_RATED', einvoiceCategory: 'Z', reasonCode: 'VATEX-SA-34-1', reasonText: 'The international transport of Goods', taxAccount: SystemAccount.VAT_OUTPUT, returnBox: '3', rates: ZERO },
  { code: 'Z-MED', name: 'Qualifying medicines and medical equipment', nameAr: 'الأدوية والمعدات الطبية المؤهلة', kind: 'SALES', treatment: 'ZERO_RATED', einvoiceCategory: 'Z', reasonCode: 'VATEX-SA-35', reasonText: 'Medicines and medical equipment', taxAccount: SystemAccount.VAT_OUTPUT, returnBox: '3', rates: ZERO },
  { code: 'Z-MTL', name: 'Qualifying metals', nameAr: 'المعادن المؤهلة', kind: 'SALES', treatment: 'ZERO_RATED', einvoiceCategory: 'Z', reasonCode: 'VATEX-SA-36', reasonText: 'Qualifying metals', taxAccount: SystemAccount.VAT_OUTPUT, returnBox: '3', rates: ZERO },
  { code: 'Z-MIL', name: 'Qualifying military goods', nameAr: 'السلع العسكرية المؤهلة', kind: 'SALES', treatment: 'ZERO_RATED', einvoiceCategory: 'Z', reasonCode: 'VATEX-SA-MLTRY', reasonText: 'Qualified Supply of Goods or Services to the Military', taxAccount: SystemAccount.VAT_OUTPUT, returnBox: '3', rates: ZERO },
  { code: 'Z-EXP-G', name: 'Export of goods', nameAr: 'تصدير السلع', kind: 'SALES', treatment: 'ZERO_RATED', einvoiceCategory: 'Z', reasonCode: 'VATEX-SA-32', reasonText: 'Export of goods', taxAccount: SystemAccount.VAT_OUTPUT, returnBox: '4', rates: ZERO },
  { code: 'Z-EXP-S', name: 'Export of services', nameAr: 'تصدير الخدمات', kind: 'SALES', treatment: 'ZERO_RATED', einvoiceCategory: 'Z', reasonCode: 'VATEX-SA-33', reasonText: 'Export of services', taxAccount: SystemAccount.VAT_OUTPUT, returnBox: '4', rates: ZERO },
  { code: 'E-FIN', name: 'Exempt financial services', nameAr: 'خدمات مالية معفاة', kind: 'SALES', treatment: 'EXEMPT', einvoiceCategory: 'E', reasonCode: 'VATEX-SA-29', reasonText: 'Financial services mentioned in Article 29 of the VAT Regulations', returnBox: '5', rates: ZERO },
  { code: 'E-LIFE', name: 'Exempt life insurance', nameAr: 'تأمين على الحياة معفى', kind: 'SALES', treatment: 'EXEMPT', einvoiceCategory: 'E', reasonCode: 'VATEX-SA-29-7', reasonText: 'Life insurance services mentioned in Article 29 of the VAT Regulations', returnBox: '5', rates: ZERO },
  { code: 'E-RES', name: 'Exempt residential real estate', nameAr: 'عقارات سكنية معفاة', kind: 'SALES', treatment: 'EXEMPT', einvoiceCategory: 'E', reasonCode: 'VATEX-SA-30', reasonText: 'Real estate transactions mentioned in Article 30 of the VAT Regulations', returnBox: '5', rates: ZERO },
  { code: 'O', name: 'Out of scope', nameAr: 'خارج نطاق الضريبة', kind: 'SALES', treatment: 'OUT_OF_SCOPE', einvoiceCategory: 'O', reasonCode: 'VATEX-SA-OOS', rates: ZERO },

  { code: 'P-S', name: 'Standard-rated purchases', nameAr: 'مشتريات خاضعة للنسبة الأساسية', kind: 'PURCHASE', treatment: 'STANDARD', taxAccount: SystemAccount.VAT_INPUT, returnBox: '7', rates: KSA_STANDARD },
  { code: 'P-S-NR', name: 'Standard-rated, not recoverable', nameAr: 'خاضعة للنسبة الأساسية - غير قابلة للاسترداد', kind: 'PURCHASE', treatment: 'STANDARD', recoverable: false, rates: KSA_STANDARD },
  { code: 'P-IMP', name: 'Imports, VAT paid at customs', nameAr: 'واردات دُفعت ضريبتها في الجمارك', kind: 'PURCHASE', treatment: 'IMPORT', taxAccount: SystemAccount.VAT_INPUT, returnBox: '8', rates: KSA_STANDARD },
  { code: 'P-RC', name: 'Imports under reverse charge', nameAr: 'واردات خاضعة للاحتساب العكسي', kind: 'PURCHASE', treatment: 'REVERSE_CHARGE', taxAccount: SystemAccount.VAT_INPUT, reverseChargeAccount: SystemAccount.VAT_OUTPUT, returnBox: '9', rates: KSA_STANDARD },
  { code: 'P-Z', name: 'Zero-rated purchases', nameAr: 'مشتريات خاضعة للنسبة الصفرية', kind: 'PURCHASE', treatment: 'ZERO_RATED', returnBox: '10', rates: ZERO },
  { code: 'P-E', name: 'Exempt purchases', nameAr: 'مشتريات معفاة', kind: 'PURCHASE', treatment: 'EXEMPT', returnBox: '11', rates: ZERO },
  { code: 'P-O', name: 'Out-of-scope purchases', nameAr: 'مشتريات خارج نطاق الضريبة', kind: 'PURCHASE', treatment: 'OUT_OF_SCOPE', rates: ZERO },

  { code: 'WHT-5', name: 'Withholding 5% (rent, technical services, freight, dividends)', nameAr: 'استقطاع 5% (إيجار، خدمات فنية، شحن، أرباح)', kind: 'WITHHOLDING', treatment: 'WITHHOLDING', taxAccount: SystemAccount.WITHHOLDING_TAX_PAYABLE, rates: ksaWithholding('5') },
  { code: 'WHT-15', name: 'Withholding 15% (royalties, other payments)', nameAr: 'استقطاع 15% (إتاوات ومدفوعات أخرى)', kind: 'WITHHOLDING', treatment: 'WITHHOLDING', taxAccount: SystemAccount.WITHHOLDING_TAX_PAYABLE, rates: ksaWithholding('15') },
  { code: 'WHT-20', name: 'Withholding 20% (management fees)', nameAr: 'استقطاع 20% (أتعاب إدارية)', kind: 'WITHHOLDING', treatment: 'WITHHOLDING', taxAccount: SystemAccount.WITHHOLDING_TAX_PAYABLE, rates: ksaWithholding('20') },
];

/**
 * Jordan GST (General Sales Tax Law No. 6 of 1994, as amended). JoFotara
 * categories: S standard, Z exempt, O zero-rated (note: Z and O are the
 * reverse of ZATCA's letters). Return boxes are named, not numbered, until
 * the ISTD return layout is confirmed. Rate history before 2019 is not loaded.
 */
const JO_FROM = '2019-01-01';
const joRate = (percent: string): TaxRateTemplate[] => [{ percent, from: JO_FROM }];
const reduced = (percent: string): TaxCodeTemplate => ({
  code: `R${percent}`,
  name: `Reduced rate ${percent}%`,
  nameAr: `نسبة مخفضة ${percent}%`,
  kind: 'SALES',
  treatment: 'STANDARD',
  einvoiceCategory: 'S',
  taxAccount: SystemAccount.VAT_OUTPUT,
  returnBox: 'sales_reduced',
  rates: joRate(percent),
});

const JORDAN: TaxCodeTemplate[] = [
  { code: 'S', name: 'General sales tax 16%', nameAr: 'ضريبة المبيعات العامة 16%', kind: 'SALES', treatment: 'STANDARD', einvoiceCategory: 'S', taxAccount: SystemAccount.VAT_OUTPUT, returnBox: 'sales_standard', rates: joRate('16') },
  reduced('10'),
  reduced('5'),
  reduced('4'),
  reduced('2'),
  reduced('1'),
  { code: 'Z0', name: 'Zero-rated (exports, free and development zones)', nameAr: 'خاضع بنسبة الصفر (تصدير، مناطق حرة وتنموية)', kind: 'SALES', treatment: 'ZERO_RATED', einvoiceCategory: 'O', taxAccount: SystemAccount.VAT_OUTPUT, returnBox: 'sales_zero', rates: joRate('0') },
  { code: 'EX', name: 'Exempt', nameAr: 'معفى', kind: 'SALES', treatment: 'EXEMPT', einvoiceCategory: 'Z', returnBox: 'sales_exempt', rates: joRate('0') },
  { code: 'O', name: 'Out of scope', nameAr: 'خارج نطاق الضريبة', kind: 'SALES', treatment: 'OUT_OF_SCOPE', rates: joRate('0') },

  { code: 'P-S', name: 'Local purchases 16%', nameAr: 'مشتريات محلية 16%', kind: 'PURCHASE', treatment: 'STANDARD', taxAccount: SystemAccount.VAT_INPUT, returnBox: 'purchases_local', rates: joRate('16') },
  { code: 'P-S-NR', name: 'Purchases 16%, not deductible', nameAr: 'مشتريات 16% غير قابلة للخصم', kind: 'PURCHASE', treatment: 'STANDARD', recoverable: false, rates: joRate('16') },
  { code: 'P-IMP', name: 'Imports, tax paid at customs', nameAr: 'مستوردات دُفعت ضريبتها في الجمارك', kind: 'PURCHASE', treatment: 'IMPORT', taxAccount: SystemAccount.VAT_INPUT, returnBox: 'purchases_import', rates: joRate('16') },
  { code: 'P-RC', name: 'Imported services, reverse charge', nameAr: 'خدمات مستوردة - احتساب عكسي', kind: 'PURCHASE', treatment: 'REVERSE_CHARGE', taxAccount: SystemAccount.VAT_INPUT, reverseChargeAccount: SystemAccount.VAT_OUTPUT, returnBox: 'reverse_charge', rates: joRate('16') },
  { code: 'P-Z0', name: 'Zero-rated purchases', nameAr: 'مشتريات خاضعة بنسبة الصفر', kind: 'PURCHASE', treatment: 'ZERO_RATED', returnBox: 'purchases_zero', rates: joRate('0') },
  { code: 'P-EX', name: 'Exempt purchases', nameAr: 'مشتريات معفاة', kind: 'PURCHASE', treatment: 'EXEMPT', returnBox: 'purchases_exempt', rates: joRate('0') },
  { code: 'P-O', name: 'Out-of-scope purchases', nameAr: 'مشتريات خارج نطاق الضريبة', kind: 'PURCHASE', treatment: 'OUT_OF_SCOPE', rates: joRate('0') },

  { code: 'WHT-5', name: 'Withholding 5% (resident professional services)', nameAr: 'اقتطاع 5% (خدمات مهنية لمقيمين)', kind: 'WITHHOLDING', treatment: 'WITHHOLDING', taxAccount: SystemAccount.WITHHOLDING_TAX_PAYABLE, rates: joRate('5') },
  { code: 'WHT-10', name: 'Withholding 10% (non-resident services)', nameAr: 'اقتطاع 10% (خدمات غير المقيمين)', kind: 'WITHHOLDING', treatment: 'WITHHOLDING', taxAccount: SystemAccount.WITHHOLDING_TAX_PAYABLE, rates: joRate('10') },
];

export function taxCodeTemplate(country: CountryCode): TaxCodeTemplate[] {
  return country === 'SA' ? SAUDI : JORDAN;
}

/** Default filing frequency for a new company (KSA quarterly below SAR 40m; Jordan bi-monthly). */
export const defaultFilingFrequency = (country: CountryCode) => (country === 'SA' ? 'QUARTERLY' : 'BIMONTHLY');
