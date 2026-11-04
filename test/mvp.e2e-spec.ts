import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { MailerService } from '../src/modules/email/mailer.service.js';
import { Api, createTestApp, platformLogin, signup, TEST_PASSWORD, uniqueEmail, type SignedUpTenant } from './helpers.js';

const YEAR = new Date().getUTCFullYear();
const d = (monthDay: string) => `${YEAR}-${monthDay}`;

interface Account {
  id: string;
  code: string;
}
interface TaxRate {
  id: string;
  code: string;
}

describe('MVP: purchases, statements, VAT return, invitations, password reset (e2e)', () => {
  let app: NestFastifyApplication;
  let api: Api;
  let mailer: MailerService;
  let owner: SignedUpTenant;
  let token: string;
  let acc: (code: string) => string;
  let rate: (code: string) => string;
  let customerId: string;
  let supplierId: string;

  const linkToken = (to: string) => {
    const mail = [...mailer.outbox].reverse().find((m) => m.to === to);
    const match = mail && /token=([^\s&"]+)/.exec(mail.text);
    if (!match) throw new Error(`no link emailed to ${to}`);
    return decodeURIComponent(match[1]!);
  };

  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
    mailer = app.get(MailerService);
    owner = await signup(api, { legalName: 'MVP Trading Co' });
    token = owner.accessToken;
    const accounts = new Map((await api.get<Account[]>('/accounts', { token })).body.map((a) => [a.code, a.id]));
    const rates = new Map((await api.get<TaxRate[]>('/tax-rates', { token })).body.map((r) => [r.code, r.id]));
    acc = (code) => accounts.get(code)!;
    rate = (code) => rates.get(code)!;
    customerId = (await api.post('/contacts', { token, body: { name: 'Retail Customer', type: 'INDIVIDUAL' } })).body.id;
    supplierId = (await api.post('/contacts', { token, body: { name: 'Office Supplier', isCustomer: false, isSupplier: true, taxNumber: '311111111100003' } })).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('purchases', () => {
    let billId: string;

    it('posts a bill (Dr expense + VAT input, Cr payable) and pays it', async () => {
      const bill = await api.post('/purchase-bills', {
        token,
        body: {
          contactId: supplierId,
          supplierReference: 'SUP-778',
          billDate: d('02-10'),
          lines: [{ description: 'Rent February', quantity: '1', unitPrice: '2000', taxRateId: rate('VAT15'), accountId: acc('5203') }],
          post: true,
        },
      });
      expect(bill.status).toBe(201);
      expect(bill.body).toMatchObject({ status: 'POSTED', number: `BILL-${YEAR}-000001`, taxTotal: '300.00', total: '2300.00', balanceDue: '2300.00' });
      billId = bill.body.id;

      const pay = await api.post('/supplier-payments', {
        token,
        body: { contactId: supplierId, date: d('02-20'), amount: '2300.00', accountId: acc('1102'), allocations: [{ billId, amount: '2300.00' }] },
      });
      expect(pay.status).toBe(201);
      expect(pay.body.number).toBe(`PAY-${YEAR}-000001`);
      expect((await api.get(`/purchase-bills/${billId}`, { token })).body.balanceDue).toBe('0.00');

      const voidBill = await api.post(`/purchase-bills/${billId}/void`, { token, body: { reason: 'try' } });
      expect(voidBill.status).toBe(409);
    });

    it('records an expense paid at once from cash', async () => {
      const expense = await api.post('/purchase-bills', {
        token,
        body: {
          type: 'EXPENSE',
          billDate: d('02-11'),
          paidFromAccountId: acc('1101'),
          pricesIncludeTax: true,
          lines: [{ description: 'Office supplies', quantity: '1', unitPrice: '115', taxRateId: rate('VAT15'), accountId: acc('5208') }],
          post: true,
        },
      });
      expect(expense.status).toBe(201);
      expect(expense.body).toMatchObject({ type: 'EXPENSE', number: `EXP-${YEAR}-000001`, taxTotal: '15.00', total: '115.00', balanceDue: '0.00' });
    });

    it('credits a bill from the supplier', async () => {
      const bill = await api.post('/purchase-bills', {
        token,
        body: { contactId: supplierId, billDate: d('02-12'), lines: [{ description: 'Stationery', quantity: '10', unitPrice: '10', taxRateId: rate('VAT15'), accountId: acc('5208') }], post: true },
      });
      const credit = await api.post('/purchase-bills', {
        token,
        body: {
          type: 'CREDIT_NOTE',
          contactId: supplierId,
          originalBillId: bill.body.id,
          billDate: d('02-13'),
          reason: 'Damaged items',
          lines: [{ description: 'Return', quantity: '2', unitPrice: '10', taxRateId: rate('VAT15'), accountId: acc('5208') }],
          post: true,
        },
      });
      expect(credit.body).toMatchObject({ number: `VCN-${YEAR}-000001`, total: '23.00', amountCredited: '23.00' });
      expect((await api.get(`/purchase-bills/${bill.body.id}`, { token })).body.balanceDue).toBe('92.00');
    });
  });

  describe('financial statements and VAT return', () => {
    beforeAll(async () => {
      // Sales: 1,000 standard rated, 500 zero-rated education (needs the customer's national ID in KSA only with ZATCA onboarded).
      const sale = await api.post('/sales-invoices', {
        token,
        body: {
          contactId: customerId,
          issueDate: d('02-15'),
          lines: [
            { description: 'Consulting', quantity: '1', unitPrice: '1000', taxRateId: rate('VAT15') },
            { description: 'Course', quantity: '1', unitPrice: '500', taxRateId: rate('ZR-EDUCATION') },
          ],
          issue: true,
        },
      });
      expect(sale.status).toBe(201);
      const cn = await api.post('/sales-invoices', {
        token,
        body: {
          type: 'CREDIT_NOTE',
          contactId: customerId,
          originalInvoiceId: sale.body.id,
          reason: 'Discount',
          issueDate: d('02-16'),
          lines: [{ description: 'Discount', quantity: '1', unitPrice: '100', taxRateId: rate('VAT15') }],
          issue: true,
        },
      });
      expect(cn.status).toBe(201);
    });

    it('builds the income statement from the ledger', async () => {
      const pl = await api.get(`/reports/income-statement?from=${d('01-01')}&to=${d('12-31')}&compare=true`, { token });
      expect(pl.status).toBe(200);
      const section = (key: string) => pl.body.sections.find((s: { key: string }) => s.key === key);
      // Revenue 1,500 - 100 credit = 1,400; expenses 2,000 rent + 100 (expense net) + 100 - 20 stationery = 2,180.
      expect(section('revenue').total).toBe('1400.00');
      expect(section('operatingExpenses').total).toBe('2180.00');
      expect(pl.body.netProfit).toBe('-780.00');
      expect(pl.body.previous.netProfit).toBe('0.00');
    });

    it('builds a balanced balance sheet with current-year profit in equity', async () => {
      const bs = await api.get(`/reports/balance-sheet?asOf=${d('12-31')}`, { token });
      expect(bs.status).toBe(200);
      expect(bs.body.balanced).toBe(true);
      const equity = bs.body.sections.find((s: { key: string }) => s.key === 'equity');
      expect(equity.lines.find((l: { accountId: string }) => l.accountId === 'current-year-profit').amount).toBe('-780.00');
      expect(bs.body.totalAssets).toBe(bs.body.totalLiabilitiesAndEquity);
    });

    it('fills the ZATCA VAT return boxes from documents', async () => {
      const vat = await api.get(`/reports/vat-return?from=${d('01-01')}&to=${d('03-31')}`, { token });
      expect(vat.status).toBe(200);
      expect(vat.body.format).toBe('ZATCA');
      const box = (n: string) => vat.body.boxes.find((b: { box: string }) => b.box === n);
      expect(box('1')).toMatchObject({ amount: '1000.00', adjustment: '-100.00', vat: '135.00' });
      expect(box('2')).toMatchObject({ amount: '500.00', vat: '0.00' });
      expect(box('7')).toMatchObject({ amount: '2200.00', adjustment: '-20.00', vat: '327.00' });
      expect(box('16').vat).toBe('-192.00');
      expect(vat.body).toMatchObject({ outputTax: '135.00', inputTax: '327.00', netVatDue: '-192.00' });
    });
  });

  describe('invitations and password reset', () => {
    it('invites a new member who sets a password and lands in the company', async () => {
      const roles = await api.get('/roles', { token });
      const accountant = roles.body.find((r: { key: string }) => r.key === 'accountant');
      const email = uniqueEmail('invitee');
      const invite = await api.post('/members/invite', { token, body: { email, fullName: 'New Accountant', roleId: accountant.id } });
      expect(invite.status).toBe(201);
      expect(invite.body).toMatchObject({ emailSent: true, member: { status: 'INVITED' } });

      const login = await api.post('/auth/login', { body: { email, password: TEST_PASSWORD } });
      expect(login.status).toBe(401);

      const link = linkToken(email);
      const info = await api.get(`/auth/invitation?token=${encodeURIComponent(link)}`);
      expect(info.body).toMatchObject({ email, needsPassword: true, company: { name: 'MVP Trading Co' } });

      const noPassword = await api.post('/auth/invitation/accept', { body: { token: link } });
      expect(noPassword.status).toBe(400);
      const accepted = await api.post('/auth/invitation/accept', { body: { token: link, password: TEST_PASSWORD } });
      expect(accepted.status).toBe(200);
      expect(accepted.body.activeTenantId).toBe(owner.tenantId);
      const again = await api.post('/auth/invitation/accept', { body: { token: link, password: TEST_PASSWORD } });
      expect(again.status).toBe(410);

      const me = await api.get('/me', { token: accepted.body.accessToken });
      expect(me.body.activeTenant.role.key).toBe('accountant');
    });

    it('resets a forgotten password and signs out other sessions', async () => {
      const forgot = await api.post('/auth/password/forgot', { body: { email: owner.email } });
      expect(forgot.status).toBe(202);
      const unknown = await api.post('/auth/password/forgot', { body: { email: uniqueEmail('nobody') } });
      expect(unknown.status).toBe(202);

      const link = linkToken(owner.email);
      const weak = await api.post('/auth/password/reset', { body: { token: link, password: 'short' } });
      expect(weak.status).toBe(400);
      const reset = await api.post('/auth/password/reset', { body: { token: link, password: 'NewPassw0rd2026' } });
      expect(reset.status).toBe(204);

      expect((await api.post('/auth/refresh', { body: { refreshToken: owner.refreshToken } })).status).toBe(401);
      expect((await api.post('/auth/login', { body: { email: owner.email, password: TEST_PASSWORD } })).status).toBe(401);
      expect((await api.post('/auth/login', { body: { email: owner.email, password: 'NewPassw0rd2026' } })).status).toBe(200);
    });

    it('onboards a company from the admin console with an emailed owner invitation', async () => {
      const admin = await platformLogin(api);
      const email = uniqueEmail('owner');
      const onboard = await api.post('/platform/tenants', {
        token: admin,
        body: { company: { legalName: 'Invited Owner Co', country: 'JO' }, owner: { email, fullName: 'Invited Owner' } },
      });
      expect(onboard.status).toBe(201);
      expect(onboard.body.ownerInvitationSent).toBe(true);
      const accepted = await api.post('/auth/invitation/accept', { body: { token: linkToken(email), password: TEST_PASSWORD } });
      expect(accepted.status).toBe(200);
      expect(accepted.body.tenants).toEqual([expect.objectContaining({ legalName: 'Invited Owner Co', role: expect.objectContaining({ key: 'owner' }) })]);
    });
  });
});
