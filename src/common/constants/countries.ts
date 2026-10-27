import type { CountryCode } from '../../generated/prisma/enums.js';

export interface CountryProfile {
  code: CountryCode;
  currency: string;
  timezone: string;
  defaultLocale: string;
  /** Standard indirect-tax rate as a decimal string (VAT KSA / GST Jordan). */
  standardTaxRate: string;
  taxAuthority: string;
  eInvoicingSystem: string;
  /** Format of the tax registration number. */
  taxNumberPattern: RegExp;
}

export const COUNTRY_PROFILES: Readonly<Record<CountryCode, CountryProfile>> = {
  SA: {
    code: 'SA',
    currency: 'SAR',
    timezone: 'Asia/Riyadh',
    defaultLocale: 'ar',
    standardTaxRate: '0.15',
    taxAuthority: 'ZATCA',
    eInvoicingSystem: 'FATOORA',
    // VAT registration number: 15 digits, starts and ends with 3.
    taxNumberPattern: /^3\d{13}3$/,
  },
  JO: {
    code: 'JO',
    currency: 'JOD',
    timezone: 'Asia/Amman',
    defaultLocale: 'ar',
    standardTaxRate: '0.16',
    taxAuthority: 'ISTD',
    eInvoicingSystem: 'JOFOTARA',
    // Tax identification number (numeric).
    taxNumberPattern: /^\d{6,15}$/,
  },
};
