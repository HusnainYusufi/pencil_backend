import type { CountryCode, TaxCategory } from '../../generated/prisma/enums.js';

export interface TaxRateTemplate {
  code: string;
  name: string;
  nameAr: string;
  /** Percentage as a decimal string. */
  rate: string;
  category: TaxCategory;
  exemptionCode?: string;
  exemptionReason?: string;
  isDefault?: boolean;
}

/**
 * Starting tax rates per country. Companies can add their own; these only
 * seed a new company. KSA zero-rating / exemption codes are ZATCA's VATEX
 * list (printed on e-invoices). A country without a template gets a single
 * "not taxable" rate so invoicing works anywhere from day one.
 */
const TEMPLATES: Partial<Record<CountryCode, TaxRateTemplate[]>> = {
  SA: [
    { code: 'VAT15', name: 'VAT 15%', nameAr: 'ضريبة القيمة المضافة 15%', rate: '15', category: 'STANDARD', isDefault: true },
    {
      code: 'ZR-EXPORT-GOODS',
      name: 'Zero-rated: export of goods',
      nameAr: 'خاضع للنسبة الصفرية: تصدير السلع',
      rate: '0',
      category: 'ZERO_RATED',
      exemptionCode: 'VATEX-SA-32',
      exemptionReason: 'Export of goods',
    },
    {
      code: 'ZR-EXPORT-SERVICES',
      name: 'Zero-rated: export of services',
      nameAr: 'خاضع للنسبة الصفرية: تصدير الخدمات',
      rate: '0',
      category: 'ZERO_RATED',
      exemptionCode: 'VATEX-SA-33',
      exemptionReason: 'Export of services',
    },
    {
      code: 'ZR-EDUCATION',
      name: 'Zero-rated: private education to citizens',
      nameAr: 'خاضع للنسبة الصفرية: التعليم الأهلي للمواطنين',
      rate: '0',
      category: 'ZERO_RATED',
      exemptionCode: 'VATEX-SA-EDU',
      exemptionReason: 'Private education to citizen',
    },
    {
      code: 'ZR-HEALTHCARE',
      name: 'Zero-rated: private healthcare to citizens',
      nameAr: 'خاضع للنسبة الصفرية: الرعاية الصحية الخاصة للمواطنين',
      rate: '0',
      category: 'ZERO_RATED',
      exemptionCode: 'VATEX-SA-HEA',
      exemptionReason: 'Private healthcare to citizen',
    },
    {
      code: 'ZR-MEDICINES',
      name: 'Zero-rated: medicines and medical equipment',
      nameAr: 'خاضع للنسبة الصفرية: الأدوية والمعدات الطبية',
      rate: '0',
      category: 'ZERO_RATED',
      exemptionCode: 'VATEX-SA-35',
      exemptionReason: 'Medicines and medical equipment',
    },
    {
      code: 'EX-FINANCIAL',
      name: 'Exempt: financial services',
      nameAr: 'معفى: الخدمات المالية',
      rate: '0',
      category: 'EXEMPT',
      exemptionCode: 'VATEX-SA-29',
      exemptionReason: 'Financial services mentioned in Article 29 of the VAT Regulations',
    },
    {
      code: 'EX-REAL-ESTATE',
      name: 'Exempt: residential real estate',
      nameAr: 'معفى: العقارات السكنية',
      rate: '0',
      category: 'EXEMPT',
      exemptionCode: 'VATEX-SA-30',
      exemptionReason: 'Real estate transactions mentioned in Article 30 of the VAT Regulations',
    },
    {
      code: 'OUT-OF-SCOPE',
      name: 'Out of scope of VAT',
      nameAr: 'خارج نطاق ضريبة القيمة المضافة',
      rate: '0',
      category: 'OUT_OF_SCOPE',
      exemptionCode: 'VATEX-SA-OOS',
      exemptionReason: 'Not subject to VAT',
    },
  ],
  JO: [
    { code: 'GST16', name: 'General sales tax 16%', nameAr: 'ضريبة المبيعات العامة 16%', rate: '16', category: 'STANDARD', isDefault: true },
    { code: 'GST4', name: 'Sales tax 4%', nameAr: 'ضريبة المبيعات 4%', rate: '4', category: 'STANDARD' },
    { code: 'ZERO', name: 'Zero-rated', nameAr: 'خاضع للنسبة الصفرية', rate: '0', category: 'ZERO_RATED', exemptionReason: 'Zero-rated supply' },
    { code: 'EXEMPT', name: 'Exempt', nameAr: 'معفى', rate: '0', category: 'EXEMPT', exemptionReason: 'Exempt supply' },
  ],
};

const FALLBACK: TaxRateTemplate[] = [
  { code: 'NO-TAX', name: 'Not taxable', nameAr: 'غير خاضع للضريبة', rate: '0', category: 'OUT_OF_SCOPE', isDefault: true },
];

export const taxRateTemplates = (country: CountryCode): readonly TaxRateTemplate[] => TEMPLATES[country] ?? FALLBACK;
