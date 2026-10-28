import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Api, createTestApp, signup, uniqueEmail, TEST_PASSWORD } from './helpers.js';

/** Master data (stage 2): tax codes, tax profile, contacts and sub-ledgers, items. */
const YEAR = new Date().getUTCFullYear();
const d = (monthDay: string) => `${YEAR}-${monthDay}`;

interface TaxCode {
  id: string;
  code: string;
  kind: string;
  currentRate: string;
  einvoiceCategory: string | null;
  rates: Array<{ ratePercent: string; effectiveFrom: string; effectiveTo: string | null }>;
  taxAccount: { code: string } | null;
}

describe('Master data (e2e)', () => {
  let app: NestFastifyApplication;
  let api: Api;

  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
  });

  afterAll(async () => {
    await app.close();
  });

  async function company(country: 'SA' | 'JO' = 'SA') {
    const tenant = await signup(api, { country, legalName: 'Masters Co' });
    const token = tenant.accessToken;
    const accounts = (await api.get<Array<{ id: string; code: string }>>('/accounts', { token })).body;
    const acc = (code: string) => accounts.find((a) => a.code === code)!.id;
    const codes = (await api.get<TaxCode[]>('/tax-codes', { token })).body;
    const tax = (code: string) => codes.find((c) => c.code === code)!;
    return { tenant, token, acc, tax, codes };
  }

  describe('tax codes', () => {
    it('seeds the KSA codes with effective-dated rates and their accounts', async () => {
      const { codes, tax } = await company();
      expect(codes.length).toBeGreaterThanOrEqual(20);
      expect(tax('S')).toMatchObject({ kind: 'SALES', currentRate: '15', einvoiceCategory: 'S', taxAccount: { code: '2102' } });
      expect(tax('S').rates).toEqual([
        { ratePercent: '5', effectiveFrom: '2018-01-01', effectiveTo: '2020-06-30' },
        { ratePercent: '15', effectiveFrom: '2020-07-01', effectiveTo: null },
      ]);
      expect(tax('P-S').taxAccount?.code).toBe('1107');
      expect(tax('WHT-5').taxAccount?.code).toBe('2110');
    });

    it("seeds Jordan's GST codes with JoFotara categories", async () => {
      const { tax } = await company('JO');
      expect(tax('S').currentRate).toBe('16');
      expect(tax('EX').einvoiceCategory).toBe('Z');
      expect(tax('Z0').einvoiceCategory).toBe('O');
      expect(tax('R4').currentRate).toBe('4');
    });

    it('protects country rates and keeps company rate history append-only', async () => {
      const { token, tax, acc } = await company();
      const protectedRate = await api.post(`/tax-codes/${tax('S').id}/rates`, { token, body: { ratePercent: '16', effectiveFrom: d('12-01') } });
      expect(protectedRate.body.error.code).toBe('TAX_CODE_PROTECTED');

      const inconsistent = await api.post('/tax-codes', {
        token,
        body: { code: 'X-ZERO', name: 'Bad', nameAr: 'خطأ', kind: 'SALES', treatment: 'ZERO_RATED', taxAccountId: acc('2102'), rate: { ratePercent: '5', effectiveFrom: d('01-01') } },
      });
      expect(inconsistent.status).toBe(400);
      const wrongSide = await api.post('/tax-codes', {
        token,
        body: { code: 'X-LEVY', name: 'Levy', nameAr: 'رسم', kind: 'SALES', treatment: 'STANDARD', taxAccountId: acc('1107'), rate: { ratePercent: '5', effectiveFrom: d('01-01') } },
      });
      expect(wrongSide.body.error.details[0].field).toBe('taxAccountId');

      const created = await api.post('/tax-codes', {
        token,
        body: { code: 'X-LEVY', name: 'Local levy', nameAr: 'رسم محلي', kind: 'SALES', treatment: 'STANDARD', taxAccountId: acc('2102'), rate: { ratePercent: '5', effectiveFrom: d('01-01') } },
      });
      expect(created.status).toBe(201);
      expect((await api.post(`/tax-codes/${created.body.id}/rates`, { token, body: { ratePercent: '7', effectiveFrom: d('01-01') } })).status).toBe(400);
      const changed = await api.post(`/tax-codes/${created.body.id}/rates`, { token, body: { ratePercent: '7', effectiveFrom: d('02-01') } });
      expect(changed.body.rates).toEqual([
        { ratePercent: '5', effectiveFrom: d('01-01'), effectiveTo: d('01-31') },
        { ratePercent: '7', effectiveFrom: d('02-01'), effectiveTo: null },
      ]);
    });
  });

  describe('company tax profile', () => {
    it('reports what ZATCA still needs and validates the National Address', async () => {
      const { token } = await company();
      const initial = (await api.get('/tax-profile', { token })).body;
      expect(initial).toMatchObject({ registration: 'REGISTERED', filingFrequency: 'QUARTERLY' });
      expect(initial.einvoiceReadiness.missing).toEqual(['commercialRegistration', 'buildingNumber', 'street', 'district', 'city', 'postalCode']);

      expect((await api.patch('/tax-profile', { token, body: { buildingNumber: '12', postalCode: '1234' } })).status).toBe(400);
      expect((await api.patch('/tax-profile', { token, body: { filingFrequency: 'BIMONTHLY' } })).status).toBe(400);
      const complete = await api.patch('/tax-profile', {
        token,
        body: { commercialRegistration: '1010123456', buildingNumber: '2322', street: 'Prince Sultan St', district: 'Al Murabba', city: 'Riyadh', postalCode: '12613', additionalNumber: '7788' },
      });
      expect(complete.status).toBe(200);
      expect(complete.body.einvoiceReadiness).toEqual({ ready: true, missing: [] });
    });

    it('defaults an unregistered company to out-of-scope sales', async () => {
      const res = await api.post('/auth/signup', {
        body: { fullName: 'Small Trader', email: uniqueEmail('small'), password: TEST_PASSWORD, company: { legalName: 'Small Shop', country: 'SA' } },
      });
      const token = res.body.accessToken;
      expect((await api.get('/tax-profile', { token })).body.registration).toBe('NOT_REGISTERED');
      const item = await api.post('/items', { token, body: { code: 'TEA', type: 'GOODS', name: 'Tea' } });
      expect(item.body.salesTaxCode.code).toBe('O');
    });
  });

  describe('contacts and sub-ledgers', () => {
    it('validates Saudi buyer identification and reports e-invoice readiness', async () => {
      const { token, tax } = await company();
      const badVat = await api.post('/contacts', { token, body: { name: 'Bad VAT', isCustomer: true, taxNumber: '123456789012345' } });
      expect(badVat.body.error.details[0].field).toBe('taxNumber');
      const badIqama = await api.post('/contacts', { token, body: { name: 'Worker', isSupplier: true, type: 'INDIVIDUAL', idScheme: 'IQA', idNumber: '1234567890' } });
      expect(badIqama.body.error.details[0].field).toBe('idNumber');
      expect((await api.post('/contacts', { token, body: { name: 'Nobody' } })).status).toBe(400);

      const b2b = await api.post('/contacts', { token, body: { name: 'Al Noor Trading', nameAr: 'مؤسسة النور', isCustomer: true, taxNumber: '310000000000003' } });
      expect(b2b.status).toBe(201);
      expect(b2b.body.einvoiceReadiness).toMatchObject({ ready: false, invoiceType: 'STANDARD' });
      const person = await api.post('/contacts', { token, body: { name: 'Walk-in', type: 'INDIVIDUAL', isCustomer: true } });
      expect(person.body.einvoiceReadiness).toMatchObject({ ready: true, invoiceType: 'SIMPLIFIED' });

      const whtOnCustomer = await api.post('/contacts', { token, body: { name: 'X', isCustomer: true, withholdingTaxCodeId: tax('WHT-5').id } });
      expect(whtOnCustomer.status).toBe(400);
      const foreign = await api.post('/contacts', {
        token,
        body: { name: 'Global Consulting Ltd', isSupplier: true, country: 'GB', taxNumber: 'GB123456789', withholdingTaxCodeId: tax('WHT-5').id },
      });
      expect(foreign.status).toBe(201);
      expect(foreign.body.withholdingTaxCode.code).toBe('WHT-5');
    });

    it('requires a customer on receivables and a supplier on payables, and reconciles both', async () => {
      const { token, acc } = await company();
      await api.patch('/books', { token, body: { openingBalanceDate: d('01-01') } });
      const customer = (await api.post('/contacts', { token, body: { name: 'Riyadh Retail', isCustomer: true } })).body;
      const supplier = (await api.post('/contacts', { token, body: { name: 'Jeddah Supplies', isSupplier: true } })).body;
      const opening = (lines: Array<Record<string, unknown>>) =>
        api.post('/journal-entries', { token, body: { date: d('01-01'), source: 'OPENING_BALANCE', post: true, lines } });

      const anonymous = await opening([{ accountId: acc('1103'), debit: '5000' }, { accountId: acc('3105'), credit: '5000' }]);
      expect(anonymous.body.error.code).toBe('ACCOUNT_NOT_POSTABLE');
      const wrongRole = await opening([{ accountId: acc('1103'), debit: '5000', contactId: supplier.id }, { accountId: acc('3105'), credit: '5000' }]);
      expect(wrongRole.body.error.code).toBe('ACCOUNT_NOT_POSTABLE');

      const posted = await opening([
        { accountId: acc('1103'), debit: '5000', contactId: customer.id },
        { accountId: acc('2101'), credit: '1200', contactId: supplier.id },
        { accountId: acc('3105'), credit: '3800' },
      ]);
      expect(posted.status).toBe(201);
      expect(posted.body.lines[0].contact.name).toBe('Riyadh Retail');

      expect((await api.get(`/contacts/${customer.id}`, { token })).body.balances).toEqual({ receivable: '5000.00', payable: '0.00' });
      expect((await api.get(`/contacts/${supplier.id}`, { token })).body.balances).toEqual({ receivable: '0.00', payable: '1200.00' });
      const statement = (await api.get(`/contacts/${customer.id}/statement?from=${d('01-01')}&to=${d('12-31')}`, { token })).body;
      expect(statement.items).toHaveLength(1);
      expect(statement.closingBalance).toBe('5000.00');

      const recon = (await api.get('/contacts/reconciliation', { token })).body;
      expect(recon).toEqual([
        { ledger: 'receivables', control: '5000.00', subledger: '5000.00', unassigned: '0.00', reconciled: true },
        { ledger: 'payables', control: '1200.00', subledger: '1200.00', unassigned: '0.00', reconciled: true },
      ]);

      // A role with a balance stays; a used contact is deactivated, not deleted.
      expect((await api.patch(`/contacts/${customer.id}`, { token, body: { isCustomer: false, isSupplier: true } })).body.error.code).toBe('ACCOUNT_IN_USE');
      expect((await api.delete(`/contacts/${customer.id}`, { token })).body.error.code).toBe('ACCOUNT_IN_USE');
      expect((await api.patch(`/contacts/${customer.id}`, { token, body: { isActive: false } })).status).toBe(200);
    });
  });

  describe('items', () => {
    it('defaults accounts and tax codes and refuses control accounts', async () => {
      const { token, acc, tax } = await company();
      const goods = await api.post('/items', { token, body: { code: 'SKU-001', type: 'GOODS', name: 'Office chair', nameAr: 'كرسي مكتب', salePrice: '450.00' } });
      expect(goods.status).toBe(201);
      expect(goods.body).toMatchObject({
        unitCode: 'PCE',
        salePrice: '450',
        salesAccount: { code: '4101' },
        purchaseAccount: { code: '5101' },
        salesTaxCode: { code: 'S' },
        purchaseTaxCode: { code: 'P-S' },
      });
      const service = await api.post('/items', { token, body: { code: 'CONSULT', type: 'SERVICE', name: 'Consulting hour', unitCode: 'HUR' } });
      expect(service.body).toMatchObject({ salesAccount: { code: '4102' }, purchaseAccount: null, unitCode: 'HUR' });

      expect((await api.post('/items', { token, body: { code: 'BAD-1', type: 'GOODS', name: 'x', salesAccountId: acc('1103') } })).status).toBe(400);
      expect((await api.post('/items', { token, body: { code: 'BAD-2', type: 'GOODS', name: 'x', salesTaxCodeId: tax('P-S').id } })).status).toBe(400);
      expect((await api.post('/items', { token, body: { code: 'BAD-3', type: 'GOODS', name: 'x', unitCode: 'XYZ' } })).status).toBe(400);
      expect((await api.post('/items', { token, body: { code: 'SKU-001', type: 'GOODS', name: 'dup' } })).status).toBe(409);

      const export_ = await api.patch(`/items/${goods.body.id}`, { token, body: { salesTaxCodeId: tax('Z-EXP-G').id } });
      expect(export_.body.salesTaxCode.code).toBe('Z-EXP-G');
      expect((await api.get('/items?search=chair', { token })).body.items).toHaveLength(1);
    });
  });
});
