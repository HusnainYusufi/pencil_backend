import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Db } from '../src/core/database/db.service.js';
import { EInvoiceSubmissionWorker } from '../src/modules/einvoicing/einvoicing.worker.js';
import { parseQr } from '../src/modules/einvoicing/zatca/qr.js';
import { ZATCA_GATEWAY_FACTORY } from '../src/modules/einvoicing/zatca/zatca-gateway.js';
import { FIRST_PREVIOUS_HASH } from '../src/modules/einvoicing/zatca/zatca.types.js';
import { Api, createTestApp, signup, type SignedUpTenant } from './helpers.js';
import { FakeZatca } from './zatca-fake.js';

const YEAR = new Date().getUTCFullYear();
const d = (monthDay: string) => `${YEAR}-${monthDay}`;

interface Account {
  id: string;
  code: string;
}
interface TaxRate {
  id: string;
  code: string;
  rate: string;
  isDefault: boolean;
}

const BUYER_ADDRESS = {
  addressStreet: 'Olaya St',
  addressBuildingNumber: '7788',
  addressDistrict: 'Al Olaya',
  addressCity: 'Riyadh',
  addressPostalCode: '12611',
};

describe('Sales, payments and ZATCA e-invoicing (e2e)', () => {
  let app: NestFastifyApplication;
  let api: Api;
  const zatca = new FakeZatca();
  let owner: SignedUpTenant;
  let token: string;
  let accounts: Map<string, Account>;
  let rates: Map<string, TaxRate>;
  let customerId: string;

  const closing = async (code: string) => {
    const tb = await api.get(`/reports/trial-balance?from=${d('01-01')}&to=${d('12-31')}`, { token });
    expect(tb.body.balanced).toBe(true);
    const row = tb.body.rows.find((r: { code: string }) => r.code === code);
    return row ? { debit: row.closing.debit as string, credit: row.closing.credit as string } : { debit: '0.00', credit: '0.00' };
  };
  const invoiceBody = (extra: Record<string, unknown> = {}) => ({
    contactId: customerId,
    issueDate: d('03-15'),
    lines: [
      { description: 'Consulting', quantity: '2', unitPrice: '500', taxRateId: rates.get('VAT15')!.id },
      { description: 'Export service', quantity: '1', unitPrice: '200', taxRateId: rates.get('ZR-EXPORT-SERVICES')!.id },
    ],
    ...extra,
  });

  beforeAll(async () => {
    app = await createTestApp((b) => b.overrideProvider(ZATCA_GATEWAY_FACTORY).useValue(zatca.factory));
    api = new Api(app);
    owner = await signup(api, { legalName: 'Pencil Sales Co' });
    token = owner.accessToken;
    accounts = new Map((await api.get<Account[]>('/accounts', { token })).body.map((a) => [a.code, a]));
    rates = new Map((await api.get<TaxRate[]>('/tax-rates', { token })).body.map((r) => [r.code, r]));
    const customer = await api.post('/contacts', {
      token,
      body: { name: 'Al Noor Trading', type: 'BUSINESS', taxNumber: '311111111100003', ...BUYER_ADDRESS, paymentTermsDays: 30 },
    });
    expect(customer.status).toBe(201);
    customerId = customer.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('setup', () => {
    it('seeds the KSA tax rates with VAT 15% as default', () => {
      expect(rates.get('VAT15')).toMatchObject({ rate: '15.00', isDefault: true });
      expect(rates.get('ZR-EDUCATION')).toBeDefined();
      expect(rates.size).toBe(9);
    });

    it('validates contacts (KSA VAT format, id scheme pairs)', async () => {
      const bad = await api.post('/contacts', { token, body: { name: 'X', taxNumber: '123' } });
      expect(bad.status).toBe(400);
      const noScheme = await api.post('/contacts', { token, body: { name: 'X', idNumber: '1234567890' } });
      expect(noScheme.status).toBe(400);
    });
  });

  describe('invoices without a ZATCA device (Phase 1)', () => {
    let invoiceId: string;

    it('drafts, then issues with a gapless number, a ledger posting and a Phase 1 QR', async () => {
      const draft = await api.post('/sales-invoices', { token, body: invoiceBody() });
      expect(draft.status).toBe(201);
      expect(draft.body).toMatchObject({ status: 'DRAFT', kind: 'STANDARD', number: null, subtotal: '1200.00', taxTotal: '150.00', total: '1350.00' });
      expect(draft.body.dueDate).toBe(d('04-14'));
      invoiceId = draft.body.id;

      const issued = await api.post(`/sales-invoices/${invoiceId}/issue`, { token });
      expect(issued.status).toBe(200);
      expect(issued.body.number).toBe(`INV-${YEAR}-000001`);
      expect(issued.body).toMatchObject({ status: 'ISSUED', balanceDue: '1350.00', einvoice: null });
      expect(issued.body.journalEntry.number).toMatch(/^JV-/);
      expect([...parseQr(issued.body.qrCode).keys()]).toEqual([1, 2, 3, 4, 5]);

      expect(await closing('1103')).toMatchObject({ debit: '1350.00' });
      expect(await closing('4101')).toMatchObject({ credit: '1200.00' });
      expect(await closing('2102')).toMatchObject({ credit: '150.00' });

      const edit = await api.patch(`/sales-invoices/${invoiceId}`, { token, body: invoiceBody() });
      expect(edit.status).toBe(409);
      expect(edit.body.error.code).toBe('DOCUMENT_NOT_EDITABLE');
    });

    it('takes partial and full payments, refuses over-allocation, and voids a payment', async () => {
      const pay = (amount: string) =>
        api.post('/customer-payments', {
          token,
          body: { contactId: customerId, date: d('03-20'), amount, accountId: accounts.get('1102')!.id, method: 'BANK_TRANSFER', allocations: [{ invoiceId, amount }] },
        });
      const first = await pay('350.00');
      expect(first.status).toBe(201);
      expect(first.body.number).toBe(`RCPT-${YEAR}-000001`);

      const over = await pay('1000.01');
      expect(over.status).toBe(422);
      expect(over.body.error.code).toBe('ALLOCATION_EXCEEDS_BALANCE');

      let doc = await api.get(`/sales-invoices/${invoiceId}`, { token });
      expect(doc.body).toMatchObject({ amountPaid: '350.00', balanceDue: '1000.00' });

      const voided = await api.post(`/customer-payments/${first.body.id}/void`, { token });
      expect(voided.body.status).toBe('VOID');
      doc = await api.get(`/sales-invoices/${invoiceId}`, { token });
      expect(doc.body.balanceDue).toBe('1350.00');

      const rest = await pay('1350.00');
      expect(rest.status).toBe(201);
      doc = await api.get(`/sales-invoices/${invoiceId}`, { token });
      expect(doc.body.balanceDue).toBe('0.00');
      expect(await closing('1103')).toMatchObject({ debit: '0.00', credit: '0.00' });

      const balance = await api.get(`/contacts/${customerId}`, { token });
      expect(balance.body.balance).toBe('0.0000');
    });

    it('credits an invoice (applied to its balance) and caps the credit', async () => {
      const inv = await api.post('/sales-invoices', { token, body: invoiceBody({ issue: true }) });
      expect(inv.body.number).toBe(`INV-${YEAR}-000002`);

      const tooMuch = await api.post('/sales-invoices', {
        token,
        body: {
          type: 'CREDIT_NOTE',
          contactId: customerId,
          originalInvoiceId: inv.body.id,
          reason: 'Returned',
          issueDate: d('03-16'),
          lines: [{ description: 'Return', quantity: '3', unitPrice: '500', taxRateId: rates.get('VAT15')!.id }],
          issue: true,
        },
      });
      expect(tooMuch.status).toBe(400);

      const cn = await api.post('/sales-invoices', {
        token,
        body: {
          type: 'CREDIT_NOTE',
          contactId: customerId,
          originalInvoiceId: inv.body.id,
          reason: 'Discount agreed after delivery',
          issueDate: d('03-16'),
          lines: [{ description: 'Discount', quantity: '1', unitPrice: '100', taxRateId: rates.get('VAT15')!.id }],
          issue: true,
        },
      });
      expect(cn.status).toBe(201);
      expect(cn.body).toMatchObject({ number: `CN-${YEAR}-000001`, total: '115.00', amountCredited: '115.00', balanceDue: '0.00' });

      const original = await api.get(`/sales-invoices/${inv.body.id}`, { token });
      expect(original.body).toMatchObject({ amountCredited: '115.00', balanceDue: '1235.00' });
      expect(original.body.adjustments).toEqual([expect.objectContaining({ type: 'CREDIT_NOTE', number: `CN-${YEAR}-000001` })]);

      const voidOriginal = await api.post(`/sales-invoices/${inv.body.id}/void`, { token, body: { reason: 'Mistake' } });
      expect(voidOriginal.status).toBe(409);

      // Voiding the credit note releases it; then the invoice can be voided.
      expect((await api.post(`/sales-invoices/${cn.body.id}/void`, { token, body: { reason: 'Wrong amount' } })).body.status).toBe('VOID');
      const voided = await api.post(`/sales-invoices/${inv.body.id}/void`, { token, body: { reason: 'Duplicate' } });
      expect(voided.status).toBe(200);
      expect(voided.body.status).toBe('VOID');
      expect(await closing('1103')).toMatchObject({ debit: '0.00', credit: '0.00' });
    });

    it('supports tax-inclusive simplified sales without a customer', async () => {
      const sale = await api.post('/sales-invoices', {
        token,
        body: {
          issueDate: d('03-17'),
          pricesIncludeTax: true,
          paymentMeans: 'CASH',
          lines: [{ description: 'Notebook', quantity: '1', unitPrice: '115', taxRateId: rates.get('VAT15')!.id }],
          issue: true,
        },
      });
      expect(sale.status).toBe(201);
      expect(sale.body).toMatchObject({ kind: 'SIMPLIFIED', taxableAmount: '100.00', taxTotal: '15.00', total: '115.00' });
    });
  });

  describe('ZATCA Phase 2', () => {
    it('refuses onboarding until the company profile is complete, then onboards', async () => {
      const early = await api.post('/einvoicing/units/zatca', { token, body: { environment: 'SIMULATION', otp: '123456' } });
      expect(early.status).toBe(422);
      expect(early.body.error.code).toBe('EINVOICING_NOT_READY');
      expect(early.body.error.details.map((e: { field: string }) => e.field)).toContain('company.addressStreet');

      const profile = await api.patch('/tenant', {
        token,
        body: { commercialRegistration: '1010010000', addressStreet: 'King Fahd Rd', addressBuildingNumber: '1234', addressDistrict: 'Al Olaya', addressCity: 'Riyadh', addressPostalCode: '12345' },
      });
      expect(profile.status).toBe(200);

      const badOtp = await api.post('/einvoicing/units/zatca', { token, body: { environment: 'SIMULATION', otp: '000000' } });
      expect(badOtp.status).toBe(422);
      expect(badOtp.body.error.code).toBe('EINVOICING_ONBOARDING_FAILED');

      const unit = await api.post('/einvoicing/units/zatca', { token, body: { environment: 'SIMULATION', otp: '123456' } });
      expect(unit.status).toBe(201);
      expect(unit.body).toMatchObject({ status: 'ACTIVE', provider: 'ZATCA', lastIcv: 0 });
      expect(unit.body).not.toHaveProperty('privateKey');
      expect(zatca.submissions.filter((s) => s.kind === 'compliance')).toHaveLength(6);

      const status = await api.get('/einvoicing/status', { token });
      expect(status.body).toMatchObject({ provider: 'ZATCA', required: true, activeUnit: { status: 'ACTIVE' } });
    });

    it('clears standard and reports simplified invoices on one hash chain', async () => {
      const std = await api.post('/sales-invoices', { token, body: invoiceBody({ issue: true }) });
      expect(std.status).toBe(201);
      expect(std.body.einvoice).toMatchObject({ status: 'CLEARED', submissionType: 'CLEARANCE', icv: 1, attempts: 1 });
      expect(parseQr(std.body.qrCode).has(8)).toBe(true);

      const xml = await api.get(`/sales-invoices/${std.body.id}/einvoice/xml`, { token });
      expect(xml.body.xml).toContain(`<cbc:ID>${std.body.number}</cbc:ID>`);
      expect(xml.body.xml).toContain(`<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${FIRST_PREVIOUS_HASH}</cbc:EmbeddedDocumentBinaryObject>`);

      const simple = await api.post('/sales-invoices', {
        token,
        body: { issueDate: d('03-18'), lines: [{ description: 'Pen', quantity: '1', unitPrice: '10', taxRateId: rates.get('VAT15')!.id }], issue: true },
      });
      expect(simple.body.einvoice).toMatchObject({ status: 'REPORTED', submissionType: 'REPORTING', icv: 2 });
      const simpleXml = await api.get(`/sales-invoices/${simple.body.id}/einvoice/xml`, { token });
      expect(simpleXml.body.xml).toContain(`>${std.body.einvoice.invoiceHash}</cbc:EmbeddedDocumentBinaryObject>`);

      const accepted = await api.post(`/sales-invoices/${std.body.id}/void`, { token, body: { reason: 'Try' } });
      expect(accepted.status).toBe(409);
    });

    it('rejects documents that break ZATCA rules before consuming a number', async () => {
      const bare = await api.post('/contacts', { token, body: { name: 'No Address LLC', type: 'BUSINESS', taxNumber: '322222222200003' } });
      const draft = await api.post('/sales-invoices', { token, body: invoiceBody({ contactId: bare.body.id }) });
      const issue = await api.post(`/sales-invoices/${draft.body.id}/issue`, { token });
      expect(issue.status).toBe(422);
      expect(issue.body.error.code).toBe('EINVOICING_NOT_READY');
      expect(issue.body.error.details.map((e: { field: string }) => e.field)).toContain('customer.addressStreet');

      const next = await api.post('/sales-invoices', { token, body: invoiceBody({ issue: true }) });
      expect(next.body.einvoice.icv).toBe(3);
      const numbers = (await api.get('/sales-invoices?type=INVOICE&status=ISSUED&pageSize=100', { token })).body.items.map((i: { number: string }) => i.number);
      expect(numbers).toContain(next.body.number);
    });

    it('needs the national ID for zero-rated private education', async () => {
      const parent = await api.post('/contacts', { token, body: { name: 'Parent', type: 'INDIVIDUAL' } });
      const fee = await api.post('/sales-invoices', {
        token,
        body: { contactId: parent.body.id, issueDate: d('03-19'), lines: [{ description: 'Tuition', quantity: '1', unitPrice: '5000', taxRateId: rates.get('ZR-EDUCATION')!.id }], issue: true },
      });
      expect(fee.status).toBe(422);
      expect(fee.body.error.details.map((e: { field: string }) => e.field)).toContain('customer.idNumber');

      await api.patch(`/contacts/${parent.body.id}`, { token, body: { idScheme: 'NAT', idNumber: '1012345678' } });
      const ok = await api.post('/sales-invoices', {
        token,
        body: { contactId: parent.body.id, issueDate: d('03-19'), lines: [{ description: 'Tuition', quantity: '1', unitPrice: '5000', taxRateId: rates.get('ZR-EDUCATION')!.id }], issue: true },
      });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ kind: 'SIMPLIFIED', taxTotal: '0.00', total: '5000.00', einvoice: { status: 'REPORTED' } });
    });

    it('keeps outage submissions pending for the worker, and lets rejected ones be voided', async () => {
      zatca.mode = 'outage';
      const pending = await api.post('/sales-invoices', { token, body: invoiceBody({ issue: true }) });
      expect(pending.status).toBe(201);
      expect(pending.body.einvoice).toMatchObject({ status: 'PENDING', attempts: 1 });
      expect((await api.post(`/sales-invoices/${pending.body.id}/void`, { token, body: { reason: 'Try' } })).status).toBe(409);

      zatca.mode = 'accept';
      const retried = await api.post(`/sales-invoices/${pending.body.id}/einvoice/retry`, { token });
      expect(retried.body.einvoice).toMatchObject({ status: 'CLEARED', attempts: 2 });

      zatca.mode = 'outage';
      const queued = await api.post('/sales-invoices', { token, body: invoiceBody({ issue: true }) });
      expect(queued.body.einvoice.status).toBe('PENDING');
      zatca.mode = 'accept';
      // Make it due now (the backoff put it a minute out), then run one worker pass.
      const db = app.get(Db);
      await db.asSystem(() => db.client.eInvoiceDocument.updateMany({ where: { invoiceId: queued.body.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } }));
      expect(await app.get(EInvoiceSubmissionWorker).tick()).toBeGreaterThanOrEqual(1);
      const afterWorker = await api.get(`/sales-invoices/${queued.body.id}`, { token });
      expect(afterWorker.body.einvoice).toMatchObject({ status: 'CLEARED', attempts: 2 });

      zatca.mode = 'reject';
      const rejected = await api.post('/sales-invoices', { token, body: invoiceBody({ issue: true }) });
      expect(rejected.body.einvoice).toMatchObject({ status: 'REJECTED' });
      expect(rejected.body.einvoice.errors[0].code).toBe('BR-KSA-TEST');
      const voided = await api.post(`/sales-invoices/${rejected.body.id}/void`, { token, body: { reason: 'Rejected by ZATCA' } });
      expect(voided.body.status).toBe('VOID');
      zatca.mode = 'accept';
    });
  });

  describe('other countries', () => {
    it('invoices in Jordan with GST 16%, three decimals and no ZATCA', async () => {
      const jo = await signup(api, { country: 'JO', legalName: 'Amman Books' });
      const joRates = (await api.get<TaxRate[]>('/tax-rates', { token: jo.accessToken })).body;
      expect(joRates.find((r) => r.isDefault)).toMatchObject({ code: 'GST16', rate: '16.00' });
      const customer = await api.post('/contacts', { token: jo.accessToken, body: { name: 'Zaid', type: 'INDIVIDUAL' } });
      const inv = await api.post('/sales-invoices', {
        token: jo.accessToken,
        body: {
          contactId: customer.body.id,
          issueDate: d('03-15'),
          lines: [{ description: 'Book', quantity: '1', unitPrice: '10.555', taxRateId: joRates.find((r) => r.code === 'GST16')!.id }],
          issue: true,
        },
      });
      expect(inv.status).toBe(201);
      expect(inv.body).toMatchObject({ currency: 'JOD', taxTotal: '1.689', total: '12.244', qrCode: null, einvoice: null });
      const status = await api.get('/einvoicing/status', { token: jo.accessToken });
      expect(status.body).toMatchObject({ provider: null, required: false });
    });
  });
});
