import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../src/core/database/prisma.service.js';
import { Api, createTestApp, signup, type SignedUpTenant } from './helpers.js';

const YEAR = new Date().getUTCFullYear();
const d = (monthDay: string, year = YEAR) => `${year}-${monthDay}`;

interface Account {
  id: string;
  code: string;
  systemKey: string | null;
  isGroup: boolean;
}

describe('Accounting core (e2e)', () => {
  let app: NestFastifyApplication;
  let api: Api;
  let owner: SignedUpTenant;
  let accounts: Map<string, Account>;

  const acc = (code: string) => accounts.get(code)!.id;
  const journal = (lines: Array<[string, 'debit' | 'credit', string]>, extra: Record<string, unknown> = {}) => ({
    date: d('03-15'),
    memo: 'test entry',
    lines: lines.map(([code, side, amount]) => ({ accountId: acc(code), [side]: amount })),
    ...extra,
  });

  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
    owner = await signup(api, { legalName: 'Ledger Co' });
    const list = await api.get<Account[]>('/accounts', { token: owner.accessToken });
    accounts = new Map(list.body.map((a) => [a.code, a]));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('company bootstrap', () => {
    it('provisions the country chart, a fiscal year and the main branch', async () => {
      expect(accounts.get('1103')).toMatchObject({ systemKey: 'accounts_receivable', isGroup: false });
      expect(accounts.get('11')?.isGroup).toBe(true);
      expect(accounts.size).toBeGreaterThan(50);

      const years = await api.get('/fiscal-years', { token: owner.accessToken });
      expect(years.body).toHaveLength(1);
      expect(years.body[0]).toMatchObject({ name: `FY ${YEAR}`, startDate: d('01-01'), endDate: d('12-31') });
      expect(years.body[0].periods).toHaveLength(12);

      const branches = await api.get('/branches', { token: owner.accessToken });
      expect(branches.body).toEqual([expect.objectContaining({ code: 'MAIN', isDefault: true })]);
    });
  });

  describe('journal lifecycle', () => {
    it('drafts, edits, posts with a gapless number, then freezes the entry', async () => {
      const draft = await api.post('/journal-entries', {
        token: owner.accessToken,
        body: journal([['1101', 'debit', '1000'], ['3101', 'credit', '1000']]),
      });
      expect(draft.status).toBe(201);
      expect(draft.body).toMatchObject({ status: 'DRAFT', number: null, totalAmount: '1000.00', currency: 'SAR' });

      const edited = await api.patch(`/journal-entries/${draft.body.id}`, {
        token: owner.accessToken,
        body: journal([['1101', 'debit', '1500.25'], ['3101', 'credit', '1500.25']], { reference: 'CAP-1' }),
      });
      expect(edited.body).toMatchObject({ totalAmount: '1500.25', reference: 'CAP-1' });

      const posted = await api.post(`/journal-entries/${draft.body.id}/post`, { token: owner.accessToken });
      expect(posted.status).toBe(200);
      expect(posted.body.status).toBe('POSTED');
      expect(posted.body.number).toMatch(new RegExp(`^JV-${YEAR}-\\d{6}$`));

      const editPosted = await api.patch(`/journal-entries/${draft.body.id}`, {
        token: owner.accessToken,
        body: journal([['1101', 'debit', '1'], ['3101', 'credit', '1']]),
      });
      expect(editPosted.status).toBe(409);
      expect(editPosted.body.error.code).toBe('ENTRY_NOT_EDITABLE');
      expect((await api.delete(`/journal-entries/${draft.body.id}`, { token: owner.accessToken })).status).toBe(409);
    });

    it('deletes drafts', async () => {
      const draft = await api.post('/journal-entries', {
        token: owner.accessToken,
        body: journal([['1101', 'debit', '5'], ['3101', 'credit', '5']]),
      });
      expect((await api.delete(`/journal-entries/${draft.body.id}`, { token: owner.accessToken })).status).toBe(204);
      expect((await api.get(`/journal-entries/${draft.body.id}`, { token: owner.accessToken })).status).toBe(404);
    });

    it('rejects unbalanced entries, group accounts and over-precise amounts', async () => {
      const unbalanced = await api.post('/journal-entries', {
        token: owner.accessToken,
        body: journal([['1101', 'debit', '100'], ['3101', 'credit', '90']]),
      });
      expect(unbalanced.status).toBe(422);
      expect(unbalanced.body.error).toMatchObject({ code: 'UNBALANCED_ENTRY', details: { difference: '10.00' } });

      const group = await api.post('/journal-entries', {
        token: owner.accessToken,
        body: journal([['11', 'debit', '100'], ['3101', 'credit', '100']]),
      });
      expect(group.status).toBe(422);
      expect(group.body.error.code).toBe('ACCOUNT_NOT_POSTABLE');

      const precise = await api.post('/journal-entries', {
        token: owner.accessToken,
        body: journal([['1101', 'debit', '1.005'], ['3101', 'credit', '1.005']]),
      });
      expect(precise.status).toBe(400);
    });
  });

  describe('reversal', () => {
    it('posts a linked mirror entry exactly once', async () => {
      const original = await api.post('/journal-entries', {
        token: owner.accessToken,
        body: journal([['5203', 'debit', '700'], ['1101', 'credit', '700']], { post: true }),
      });
      expect(original.body.status).toBe('POSTED');

      const reversal = await api.post(`/journal-entries/${original.body.id}/reverse`, {
        token: owner.accessToken,
        body: { date: d('03-20') },
      });
      expect(reversal.status).toBe(201);
      expect(reversal.body).toMatchObject({ source: 'REVERSAL', status: 'POSTED', reversalOf: { id: original.body.id } });
      expect(reversal.body.lines[0]).toMatchObject({ debit: '0.00', credit: '700.00' });

      const again = await api.post(`/journal-entries/${original.body.id}/reverse`, { token: owner.accessToken, body: {} });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('ENTRY_NOT_REVERSIBLE');

      const rent = await api.get(`/reports/account-statement/${acc('5203')}`, { token: owner.accessToken });
      expect(rent.body.closingBalance).toBe('0.00');
    });
  });

  describe('fiscal periods', () => {
    it('blocks postings into a closed period until it is reopened', async () => {
      const years = await api.get('/fiscal-years', { token: owner.accessToken });
      const february = years.body[0].periods.find((p: { number: number }) => p.number === 2);

      expect((await api.post(`/fiscal-periods/${february.id}/close`, { token: owner.accessToken })).body.status).toBe('CLOSED');
      const blocked = await api.post('/journal-entries', {
        token: owner.accessToken,
        body: journal([['1101', 'debit', '10'], ['3101', 'credit', '10']], { date: d('02-10'), post: true }),
      });
      expect(blocked.status).toBe(422);
      expect(blocked.body.error.code).toBe('FISCAL_PERIOD_CLOSED');

      await api.post(`/fiscal-periods/${february.id}/reopen`, { token: owner.accessToken });
      const allowed = await api.post('/journal-entries', {
        token: owner.accessToken,
        body: journal([['1101', 'debit', '10'], ['3101', 'credit', '10']], { date: d('02-10'), post: true }),
      });
      expect(allowed.status).toBe(201);
    });

    it('opens the next fiscal year automatically, but not years beyond it', async () => {
      const nextYear = await api.post('/journal-entries', {
        token: owner.accessToken,
        body: journal([['1101', 'debit', '20'], ['3101', 'credit', '20']], { date: d('01-05', YEAR + 1), post: true }),
      });
      expect(nextYear.status).toBe(201);
      expect(nextYear.body.number).toMatch(`JV-${YEAR + 1}-000001`);
      expect((await api.get('/fiscal-years', { token: owner.accessToken })).body).toHaveLength(2);

      const far = await api.post('/journal-entries', {
        token: owner.accessToken,
        body: journal([['1101', 'debit', '20'], ['3101', 'credit', '20']], { date: d('01-05', YEAR + 3), post: true }),
      });
      expect(far.status).toBe(422);
      expect(far.body.error.code).toBe('FISCAL_PERIOD_NOT_FOUND');
    });
  });

  describe('concurrency', () => {
    it('numbers concurrent postings gaplessly', async () => {
      const drafts = await Promise.all(
        Array.from({ length: 6 }, () =>
          api.post('/journal-entries', { token: owner.accessToken, body: journal([['1102', 'debit', '1'], ['3101', 'credit', '1']]) }),
        ),
      );
      const posted = await Promise.all(drafts.map((r) => api.post(`/journal-entries/${r.body.id}/post`, { token: owner.accessToken })));
      expect(posted.every((r) => r.status === 200)).toBe(true);
      const seq = posted.map((r) => Number(r.body.number.split('-')[2])).sort((a, b) => a - b);
      expect(new Set(seq).size).toBe(6);
      expect(seq[5]! - seq[0]!).toBe(5); // contiguous: no gaps, no duplicates
    });

    it('lets exactly one of two simultaneous posts win', async () => {
      const draft = await api.post('/journal-entries', {
        token: owner.accessToken,
        body: journal([['1102', 'debit', '3'], ['3101', 'credit', '3']]),
      });
      const results = await Promise.all([
        api.post(`/journal-entries/${draft.body.id}/post`, { token: owner.accessToken }),
        api.post(`/journal-entries/${draft.body.id}/post`, { token: owner.accessToken }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    });
  });

  describe('reports', () => {
    it('produces a balanced trial balance rolled up the account tree', async () => {
      const res = await api.get(`/reports/trial-balance?from=${d('01-01')}&to=${d('12-31')}`, { token: owner.accessToken });
      expect(res.status).toBe(200);
      expect(res.body.balanced).toBe(true);
      expect(res.body.totals.closing.debit).toBe(res.body.totals.closing.credit);

      const cash = res.body.rows.find((r: { code: string }) => r.code === '1101');
      const assets = res.body.rows.find((r: { code: string }) => r.code === '1');
      expect(cash.closing.debit).toBe('1510.25'); // 1500.25 + 10 + 700 - 700
      expect(assets.isGroup).toBe(true);
      expect(Number(assets.closing.debit)).toBeGreaterThanOrEqual(Number(cash.closing.debit));
    });

    it('returns an account statement with a running balance across pages', async () => {
      const first = await api.get(`/reports/account-statement/${acc('1101')}?from=${d('01-01')}&to=${d('12-31')}&limit=2`, {
        token: owner.accessToken,
      });
      expect(first.body.openingBalance).toBe('0.00');
      expect(first.body.items).toHaveLength(2);
      expect(first.body.nextCursor).toBeTruthy();

      const second = await api.get(
        `/reports/account-statement/${acc('1101')}?from=${d('01-01')}&to=${d('12-31')}&limit=50&cursor=${first.body.nextCursor}`,
        { token: owner.accessToken },
      );
      const last = second.body.items[second.body.items.length - 1];
      expect(last.balance).toBe(second.body.closingBalance);
      expect(second.body.closingBalance).toBe('1510.25');
    });

    it('starts income-statement accounts at zero in a new fiscal year', async () => {
      await api.post('/journal-entries', {
        token: owner.accessToken,
        body: journal([['1101', 'debit', '400'], ['4102', 'credit', '400']], { date: d('06-01'), post: true }),
      });
      const nextYear = await api.get(`/reports/trial-balance?from=${d('01-01', YEAR + 1)}&to=${d('01-31', YEAR + 1)}`, {
        token: owner.accessToken,
      });
      const revenue = nextYear.body.rows.find((r: { code: string }) => r.code === '4102');
      const retained = nextYear.body.rows.find((r: { code: string }) => r.code === '3103');
      expect(revenue).toBeUndefined();
      expect(retained.opening.credit).toBe('400.00');
      expect(nextYear.body.balanced).toBe(true);
    });
  });

  describe('chart of accounts rules', () => {
    it('creates, validates and protects accounts', async () => {
      const created = await api.post('/accounts', {
        token: owner.accessToken,
        body: { code: '5214', name: 'Software subscriptions', nameAr: 'اشتراكات البرمجيات', subtype: 'OPERATING_EXPENSE', parentId: acc('52') },
      });
      expect(created.status).toBe(201);
      expect(created.body.type).toBe('EXPENSE');

      const wrongParent = await api.post('/accounts', {
        token: owner.accessToken,
        body: { code: '1199', name: 'Odd', subtype: 'OPERATING_EXPENSE', parentId: acc('11') },
      });
      expect(wrongParent.status).toBe(400);

      const duplicate = await api.post('/accounts', { token: owner.accessToken, body: { code: '1101', name: 'Dup', subtype: 'CASH' } });
      expect(duplicate.status).toBe(409);

      const system = await api.delete(`/accounts/${acc('1103')}`, { token: owner.accessToken });
      expect(system.body.error.code).toBe('SYSTEM_ACCOUNT_PROTECTED');

      const used = await api.delete(`/accounts/${acc('5203')}`, { token: owner.accessToken });
      expect(used.body.error.code).toBe('ACCOUNT_IN_USE');

      expect((await api.delete(`/accounts/${created.body.id}`, { token: owner.accessToken })).status).toBe(204);
    });
  });

  describe('dimensions', () => {
    it("enforces the plan's branch limit and filters reports by cost center", async () => {
      const branch = await api.post('/branches', { token: owner.accessToken, body: { code: 'JED', name: 'Jeddah' } });
      expect(branch.status).toBe(403);
      expect(branch.body.error.code).toBe('PLAN_LIMIT_REACHED');

      const cc = await api.post('/cost-centers', { token: owner.accessToken, body: { code: 'MKT', name: 'Marketing' } });
      expect(cc.status).toBe(201);
      await api.post('/journal-entries', {
        token: owner.accessToken,
        body: {
          date: d('04-01'),
          post: true,
          lines: [
            { accountId: acc('5207'), debit: '250', costCenterId: cc.body.id },
            { accountId: acc('1101'), credit: '250' },
          ],
        },
      });
      const filtered = await api.get(`/reports/trial-balance?from=${d('01-01')}&to=${d('12-31')}&costCenterId=${cc.body.id}`, {
        token: owner.accessToken,
      });
      const codes = filtered.body.rows.filter((r: { isGroup: boolean }) => !r.isGroup).map((r: { code: string }) => r.code);
      expect(codes).toEqual(['5207']);
    });
  });

  describe('isolation & database invariants', () => {
    it("rejects another company's account ids", async () => {
      const other = await signup(api, { legalName: 'Other Co' });
      const res = await api.post('/journal-entries', {
        token: other.accessToken,
        body: journal([['1101', 'debit', '1'], ['3101', 'credit', '1']]),
      });
      expect(res.status).toBe(400);
      expect(res.body.error.details[0].errors).toEqual(['account not found']);

      const tb = await api.get('/reports/trial-balance', { token: other.accessToken });
      expect(tb.body.rows).toHaveLength(0);
    });

    it('keeps the ledger append-only and balanced even against direct SQL', async () => {
      const prisma = app.get(PrismaService);
      const scoped = (sql: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<unknown>) =>
        prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${owner.tenantId}, true)`;
          return sql(tx);
        });

      await expect(scoped((tx) => tx.$executeRaw`UPDATE ledger_entries SET debit = debit + 1`)).rejects.toThrow(/append-only/);
      await expect(scoped((tx) => tx.$executeRaw`DELETE FROM ledger_entries`)).rejects.toThrow(/append-only/);

      const entry = await api.post('/journal-entries', {
        token: owner.accessToken,
        body: journal([['1101', 'debit', '9'], ['3101', 'credit', '9']]),
      });
      const period = (await api.get('/fiscal-years', { token: owner.accessToken })).body
        .flatMap((y: { periods: Array<{ id: string; number: number; startDate: string }> }) => y.periods)
        .find((p: { startDate: string }) => p.startDate === d('03-01'));
      await expect(
        scoped(
          (tx) => tx.$executeRaw`
            INSERT INTO ledger_entries (id, tenant_id, journal_entry_id, account_id, fiscal_period_id, date, debit, credit, currency)
            VALUES (gen_random_uuid(), ${owner.tenantId}::uuid, ${entry.body.id}::uuid, ${acc('1101')}::uuid, ${period.id}::uuid, ${d('03-15')}::date, 9, 0, 'SAR')`,
        ),
      ).rejects.toThrow(/unbalanced/);
    });
  });

  describe('Jordan', () => {
    it('books in JOD with three decimals', async () => {
      const jo = await signup(api, { country: 'JO', legalName: 'Amman Traders' });
      const list = await api.get<Account[]>('/accounts', { token: jo.accessToken });
      const byCode = new Map(list.body.map((a) => [a.code, a.id]));
      const res = await api.post('/journal-entries', {
        token: jo.accessToken,
        body: {
          date: d('05-05'),
          post: true,
          lines: [
            { accountId: byCode.get('1101'), debit: '10.125' },
            { accountId: byCode.get('4101'), credit: '10.125' },
          ],
        },
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ currency: 'JOD', totalAmount: '10.125' });
    });
  });
});
