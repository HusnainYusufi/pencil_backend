import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../src/core/database/prisma.service.js';
import { Api, createTestApp, signup, type SignedUpTenant } from './helpers.js';

/**
 * Auditor controls on the ledger: year-end close and reopen, lock dates,
 * opening balances, control accounts, immutability of posted vouchers.
 * Each scenario is what an external auditor would try.
 */
const YEAR = new Date().getUTCFullYear();
const PRIOR = YEAR - 1;
const d = (monthDay: string, year = YEAR) => `${year}-${monthDay}`;

interface Account {
  id: string;
  code: string;
}

describe('Ledger controls (e2e)', () => {
  let app: NestFastifyApplication;
  let api: Api;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  /** A fresh company with its chart of accounts loaded. */
  async function company(country: 'SA' | 'JO' = 'SA') {
    const tenant = await signup(api, { country, legalName: 'Audit Co' });
    const list = await api.get<Account[]>('/accounts', { token: tenant.accessToken });
    const codes = new Map(list.body.map((a) => [a.code, a.id]));
    const acc = (code: string) => codes.get(code)!;
    const post = (date: string, lines: Array<[string, 'debit' | 'credit', string]>, extra: Record<string, unknown> = {}) =>
      api.post('/journal-entries', {
        token: tenant.accessToken,
        body: { date, memo: 'audit test', post: true, lines: lines.map(([code, side, amount]) => ({ accountId: acc(code), [side]: amount })), ...extra },
      });
    return { tenant, acc, post };
  }

  /** Runs SQL as the company (row-level security applies, like the app). */
  const asTenant = (tenant: SignedUpTenant, sql: (tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0]) => Promise<unknown>) =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.tenantId}, true)`;
      return sql(tx);
    });

  /** Bootstrap opens the current year only; audits need a finished prior year. */
  async function addPriorYear(tenant: SignedUpTenant) {
    await asTenant(tenant, async (tx) => {
      const [year] = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date, status, updated_at)
        VALUES (gen_random_uuid(), ${tenant.tenantId}::uuid, ${`FY ${PRIOR}`}, ${d('01-01', PRIOR)}::date, ${d('12-31', PRIOR)}::date, 'OPEN', now())
        RETURNING id`;
      for (let month = 1; month <= 12; month++) {
        const start = new Date(Date.UTC(PRIOR, month - 1, 1)).toISOString().slice(0, 10);
        const end = new Date(Date.UTC(PRIOR, month, 0)).toISOString().slice(0, 10);
        await tx.$executeRaw`
          INSERT INTO fiscal_periods (id, tenant_id, fiscal_year_id, number, start_date, end_date, status, updated_at)
          VALUES (gen_random_uuid(), ${tenant.tenantId}::uuid, ${year!.id}::uuid, ${month}, ${start}::date, ${end}::date, 'OPEN', now())`;
      }
    });
    const years = await api.get('/fiscal-years', { token: tenant.accessToken });
    return {
      prior: years.body.find((y: { name: string }) => y.name === `FY ${PRIOR}`),
      current: years.body.find((y: { name: string }) => y.name === `FY ${YEAR}`),
    };
  }

  const row = (tb: { rows: Array<{ code: string }> }, code: string) =>
    tb.rows.find((r) => r.code === code) as unknown as Record<'opening' | 'movement' | 'closing', { debit: string; credit: string }> | undefined;

  describe('posted vouchers are permanent', () => {
    it('rejects changes to posted entries and their lines, even through direct SQL', async () => {
      const { tenant, post } = await company();
      const entry = await post(d('03-01'), [['1101', 'debit', '50'], ['3101', 'credit', '50']]);
      expect(entry.status).toBe(201);

      await expect(asTenant(tenant, (tx) => tx.$executeRaw`UPDATE journal_entries SET memo = 'tampered' WHERE id = ${entry.body.id}::uuid`)).rejects.toThrow(/posted/);
      await expect(asTenant(tenant, (tx) => tx.$executeRaw`UPDATE journal_lines SET debit = 999 WHERE journal_entry_id = ${entry.body.id}::uuid`)).rejects.toThrow(/posted/);
      await expect(asTenant(tenant, (tx) => tx.$executeRaw`DELETE FROM journal_entries WHERE id = ${entry.body.id}::uuid`)).rejects.toThrow(/posted/);

      const edit = await api.patch(`/journal-entries/${entry.body.id}`, {
        token: tenant.accessToken,
        body: { date: d('03-01'), lines: entry.body.lines.map((l: { account: { id: string }; debit: string; credit: string }) => ({ accountId: l.account.id, debit: l.debit === '0.00' ? undefined : l.debit, credit: l.credit === '0.00' ? undefined : l.credit })) },
      });
      expect(edit.body.error.code).toBe('ENTRY_NOT_EDITABLE');
    });

    it('keeps every ledger row identical to its voucher line under a concurrent edit and post', async () => {
      const { tenant, acc } = await company();
      const draft = await api.post('/journal-entries', {
        token: tenant.accessToken,
        body: { date: d('03-31'), lines: [{ accountId: acc('5203'), debit: '1000' }, { accountId: acc('1101'), credit: '1000' }] },
      });
      const [edit, postResult] = await Promise.all([
        api.patch(`/journal-entries/${draft.body.id}`, {
          token: tenant.accessToken,
          body: { date: d('04-02'), lines: [{ accountId: acc('5203'), debit: '1500' }, { accountId: acc('1101'), credit: '1500' }] },
        }),
        api.post(`/journal-entries/${draft.body.id}/post`, { token: tenant.accessToken }),
      ]);
      expect(postResult.status).toBe(200);
      expect([200, 409]).toContain(edit.status);

      const mismatches = (await asTenant(tenant, (tx) => tx.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n
        FROM ledger_entries l
        JOIN journal_lines jl ON jl.id = l.journal_line_id
        JOIN journal_entries je ON je.id = l.journal_entry_id
        WHERE l.debit <> jl.debit OR l.credit <> jl.credit OR l.account_id <> jl.account_id OR l.date <> je.date`)) as Array<{ n: number }>;
      expect(mismatches[0]!.n).toBe(0);
    });
  });

  describe('control accounts', () => {
    it('keeps manual journals off receivables, payables and VAT', async () => {
      const { post } = await company();
      for (const code of ['1103', '2101', '1107', '2102']) {
        const res = await post(d('03-05'), [[code, 'debit', '10'], ['3101', 'credit', '10']]);
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('ACCOUNT_NOT_POSTABLE');
      }
      expect((await post(d('03-05'), [['2103', 'debit', '10'], ['1102', 'credit', '10']])).status).toBe(201);
    });
  });

  describe('opening balances and cut-over', () => {
    it('dates opening balances on the cut-over date and reports them as opening, never as activity', async () => {
      const { tenant, acc } = await company();
      const customer = (await api.post('/contacts', { token: tenant.accessToken, body: { name: 'Opening customer', isCustomer: true } })).body;
      // Receivables name the customer (sub-ledger rule), so build the lines by hand.
      const ob = (date: string) =>
        api.post('/journal-entries', {
          token: tenant.accessToken,
          body: {
            date,
            source: 'OPENING_BALANCE',
            post: true,
            lines: [
              { accountId: acc('1102'), debit: '25000' },
              { accountId: acc('1103'), debit: '5000', contactId: customer.id },
              { accountId: acc('3105'), credit: '30000' },
            ],
          },
        });

      expect((await ob(d('01-01'))).body.error.code).toBe('VALIDATION_FAILED'); // no cut-over date yet
      const settings = await api.patch('/books', { token: tenant.accessToken, body: { openingBalanceDate: d('01-01') } });
      expect(settings.status).toBe(200);
      expect(settings.body.openingBalanceDate).toBe(d('01-01'));

      expect((await ob(d('01-02'))).status).toBe(400);
      const posted = await ob(d('01-01'));
      expect(posted.status).toBe(201); // receivables accept opening balances
      const early = await api.post('/journal-entries', {
        token: tenant.accessToken,
        body: { date: d('12-31', PRIOR), post: true, lines: [{ accountId: acc('1101'), debit: '1' }, { accountId: acc('3101'), credit: '1' }] },
      });
      expect(early.body.error.code).toBe('BOOKS_LOCKED');

      const tb = (await api.get(`/reports/trial-balance?from=${d('01-01')}&to=${d('12-31')}`, { token: tenant.accessToken })).body;
      expect(row(tb, '1102')!.opening.debit).toBe('25000.00');
      expect(row(tb, '1102')!.movement.debit).toBe('0.00');
      expect(tb.balanced).toBe(true);

      const statement = (await api.get(`/reports/account-statement/${acc('1102')}?from=${d('01-01')}&to=${d('12-31')}`, { token: tenant.accessToken })).body;
      expect(statement.openingBalance).toBe('25000.00');
      expect(statement.items).toHaveLength(0);

      // The opening-balance equity plug must be cleared before the migration is done.
      const books = (await api.get('/books', { token: tenant.accessToken })).body;
      expect(books.openingBalanceEquity.cleared).toBe(false);
      expect(books.openingBalanceEquity.balance).toBe('30000.00');

      const move = await api.patch('/books', { token: tenant.accessToken, body: { openingBalanceDate: d('02-01') } });
      expect(move.status).toBe(400);
    });
  });

  describe('lock dates', () => {
    it('freezes the past, and only loosens with a recorded reason', async () => {
      const { tenant, post } = await company();
      expect((await api.patch('/books', { token: tenant.accessToken, body: { lockDate: d('12-31', YEAR + 1) } })).status).toBe(400);
      expect((await api.patch('/books', { token: tenant.accessToken, body: { lockDate: d('01-31') } })).status).toBe(200);

      const locked = await post(d('01-15'), [['1101', 'debit', '10'], ['3101', 'credit', '10']]);
      expect(locked.status).toBe(422);
      expect(locked.body.error.code).toBe('BOOKS_LOCKED');
      expect((await post(d('02-01'), [['1101', 'debit', '10'], ['3101', 'credit', '10']])).status).toBe(201);

      const years = await api.get('/fiscal-years', { token: tenant.accessToken });
      const january = years.body[0].periods.find((p: { number: number }) => p.number === 1);
      await api.post(`/fiscal-periods/${january.id}/close`, { token: tenant.accessToken });
      const reopen = await api.post(`/fiscal-periods/${january.id}/reopen`, { token: tenant.accessToken, body: { reason: 'Correct a January accrual' } });
      expect(reopen.body.error.code).toBe('BOOKS_LOCKED');

      expect((await api.patch('/books', { token: tenant.accessToken, body: { lockDate: null } })).status).toBe(400);
      const cleared = await api.patch('/books', { token: tenant.accessToken, body: { lockDate: null, reason: 'Auditor requested January adjustment' } });
      expect(cleared.status).toBe(200);
      expect(cleared.body.lockDate).toBeNull();

      const audit = (await asTenant(tenant, (tx) => tx.$queryRaw<Array<{ metadata: { reason?: string } }>>`
        SELECT metadata FROM audit_logs WHERE tenant_id = ${tenant.tenantId}::uuid AND action = 'books.settings_updated' ORDER BY created_at`)) as Array<{ metadata: { reason?: string } }>;
      expect(audit.at(-1)!.metadata.reason).toBe('Auditor requested January adjustment');
    });

    it('keeps the tax lock date separate and enforces the later of the two', async () => {
      const { tenant, post } = await company();
      await api.patch('/books', { token: tenant.accessToken, body: { lockDate: d('01-31'), taxLockDate: d('03-31') } });
      expect((await post(d('03-15'), [['1101', 'debit', '10'], ['3101', 'credit', '10']])).body.error.code).toBe('BOOKS_LOCKED');
      expect((await post(d('04-01'), [['1101', 'debit', '10'], ['3101', 'credit', '10']])).status).toBe(201);
    });
  });

  describe('accounts that hold money', () => {
    it('cannot be deactivated or reclassified while they carry history', async () => {
      const { tenant, acc, post } = await company();
      await post(d('03-01'), [['5203', 'debit', '400'], ['1101', 'credit', '400']]);
      const deactivate = await api.patch(`/accounts/${acc('1101')}`, { token: tenant.accessToken, body: { isActive: false } });
      expect(deactivate.body.error.code).toBe('SYSTEM_ACCOUNT_PROTECTED');
      const rent = await api.patch(`/accounts/${acc('5203')}`, { token: tenant.accessToken, body: { isActive: false } });
      expect(rent.body.error.code).toBe('ACCOUNT_IN_USE');
      expect(rent.body.error.details.balance).toBe('400.00');
      const reclassify = await api.patch(`/accounts/${acc('5203')}`, { token: tenant.accessToken, body: { subtype: 'COST_OF_SALES' } });
      expect(reclassify.body.error.code).toBe('ACCOUNT_IN_USE');
    });
  });

  describe('year-end close', () => {
    it('closes into retained earnings, locks the year, and reopens with a full trail', async () => {
      const { tenant, acc, post } = await company();
      const { prior, current } = await addPriorYear(tenant);
      const token = tenant.accessToken;

      expect((await post(d('02-01', PRIOR), [['1101', 'debit', '10000'], ['3101', 'credit', '10000']])).body.number).toBe(`JV-${PRIOR}-000001`);
      await post(d('06-15', PRIOR), [['1101', 'debit', '3000'], ['4101', 'credit', '3000']]);
      await post(d('09-30', PRIOR), [['5203', 'debit', '1200'], ['1101', 'credit', '1200']]);
      const draft = await api.post('/journal-entries', {
        token,
        body: { date: d('11-01', PRIOR), lines: [{ accountId: acc('5208'), debit: '50' }, { accountId: acc('1101'), credit: '50' }] },
      });

      // The current year has not ended, and the prior year still has a draft.
      const notEnded = (await api.get(`/fiscal-years/${current.id}/close-preview`, { token })).body;
      expect(notEnded.blockers.map((b: { code: string }) => b.code)).toEqual(expect.arrayContaining(['YEAR_NOT_ENDED', 'EARLIER_YEAR_OPEN']));
      const blocked = await api.post(`/fiscal-years/${prior.id}/close`, { token });
      expect(blocked.body.error.code).toBe('YEAR_END_BLOCKED');
      expect(blocked.body.error.details.blockers[0].code).toBe('DRAFTS_IN_YEAR');
      await api.delete(`/journal-entries/${draft.body.id}`, { token });

      const preview = (await api.get(`/fiscal-years/${prior.id}/close-preview`, { token })).body;
      expect(preview).toMatchObject({ blockers: [], revenue: '3000.00', expenses: '1200.00', profit: '1800.00' });

      const closed = await api.post(`/fiscal-years/${prior.id}/close`, { token });
      expect(closed.status).toBe(200);
      expect(closed.body.status).toBe('CLOSED');
      expect(closed.body.profit).toBe('1800.00');
      expect(closed.body.closingEntryNumber).toBe(`JV-${PRIOR}-000004`);
      const years = (await api.get('/fiscal-years', { token })).body;
      const priorAfter = years.find((y: { id: string }) => y.id === prior.id);
      expect(priorAfter.periods.every((p: { status: string }) => p.status === 'CLOSED')).toBe(true);

      // Before closing (default) the year's result is visible; after closing it sits in retained earnings.
      const pre = (await api.get(`/reports/trial-balance?from=${d('01-01', PRIOR)}&to=${d('12-31', PRIOR)}`, { token })).body;
      expect(row(pre, '4101')!.closing.credit).toBe('3000.00');
      const postClose = (await api.get(`/reports/trial-balance?from=${d('01-01', PRIOR)}&to=${d('12-31', PRIOR)}&includeClosing=true`, { token })).body;
      expect(row(postClose, '4101')!.closing).toEqual({ debit: '0.00', credit: '0.00' });
      expect(row(postClose, '3103')!.closing.credit).toBe('1800.00');
      expect(postClose.balanced).toBe(true);

      // The next year opens with the result in retained earnings, and the statement agrees.
      const nextTb = (await api.get(`/reports/trial-balance?from=${d('01-01')}&to=${d('12-31')}`, { token })).body;
      expect(row(nextTb, '3103')!.opening.credit).toBe('1800.00');
      expect(nextTb.unclosedPriorResult).toBe('0.00');
      const reStatement = (await api.get(`/reports/account-statement/${acc('3103')}?from=${d('01-01')}&to=${d('12-31')}`, { token })).body;
      expect(reStatement.openingBalance).toBe('-1800.00');

      // A closed year accepts nothing, and its months cannot reopen.
      expect((await post(d('12-15', PRIOR), [['5203', 'debit', '300'], ['1101', 'credit', '300']])).body.error.code).toBe('FISCAL_PERIOD_CLOSED');
      const december = priorAfter.periods.find((p: { number: number }) => p.number === 12);
      expect((await api.post(`/fiscal-periods/${december.id}/reopen`, { token, body: { reason: 'Missing December invoice' } })).body.error.code).toBe('FISCAL_PERIOD_CLOSED');

      // Reopen: reason required; the closing entry is reversed, never deleted.
      expect((await api.post(`/fiscal-years/${prior.id}/reopen`, { token, body: {} })).status).toBe(400);
      const reopened = await api.post(`/fiscal-years/${prior.id}/reopen`, { token, body: { reason: 'Auditor adjustment: missing December rent' } });
      expect(reopened.body.status).toBe('OPEN');
      const closingEntries = (await api.get('/journal-entries?source=CLOSING', { token })).body.items;
      expect(closingEntries).toHaveLength(2);
      // Unclosed again: the statement and the trial balance still agree on retained earnings.
      const reopenedTb = (await api.get(`/reports/trial-balance?from=${d('01-01')}&to=${d('12-31')}`, { token })).body;
      expect(row(reopenedTb, '3103')!.opening.credit).toBe('1800.00');
      expect(reopenedTb.unclosedPriorResult).toBe('1800.00');
      expect((await api.get(`/reports/account-statement/${acc('3103')}?from=${d('01-01')}&to=${d('12-31')}`, { token })).body.openingBalance).toBe('-1800.00');

      // Adjust, then re-close: the new result flows through.
      await api.post(`/fiscal-periods/${december.id}/reopen`, { token, body: { reason: 'Missing December rent' } });
      expect((await post(d('12-15', PRIOR), [['5203', 'debit', '300'], ['1101', 'credit', '300']])).status).toBe(201);
      const reclosed = await api.post(`/fiscal-years/${prior.id}/close`, { token });
      expect(reclosed.body.profit).toBe('1500.00');
      const finalTb = (await api.get(`/reports/trial-balance?from=${d('01-01')}&to=${d('12-31')}`, { token })).body;
      expect(row(finalTb, '3103')!.opening.credit).toBe('1500.00');
      expect(row(finalTb, '4101')).toBeUndefined();

      // A year locked behind the lock date cannot be reopened.
      await api.patch('/books', { token, body: { lockDate: d('12-31', PRIOR) } });
      const lockedReopen = await api.post(`/fiscal-years/${prior.id}/reopen`, { token, body: { reason: 'Should not be possible' } });
      expect(lockedReopen.body.error.details.blockers.map((b: { code: string }) => b.code)).toContain('BOOKS_LOCKED');

      const trail = (await asTenant(tenant, (tx) => tx.$queryRaw<Array<{ action: string }>>`
        SELECT action FROM audit_logs WHERE tenant_id = ${tenant.tenantId}::uuid AND action LIKE 'fiscal_year.%' ORDER BY created_at`)) as Array<{ action: string }>;
      expect(trail.map((t) => t.action)).toEqual(['fiscal_year.closed', 'fiscal_year.reopened', 'fiscal_year.closed']);
    });

    it('rejects reports that mix two fiscal years', async () => {
      const { tenant } = await company();
      await addPriorYear(tenant);
      const res = await api.get(`/reports/trial-balance?from=${d('07-01', PRIOR)}&to=${d('06-30')}`, { token: tenant.accessToken });
      expect(res.status).toBe(400);
    });

    it('closes a Jordanian year in fils', async () => {
      const { tenant, post } = await company('JO');
      const { prior } = await addPriorYear(tenant);
      await post(d('05-05', PRIOR), [['1101', 'debit', '100.125'], ['4101', 'credit', '100.125']]);
      const closed = await api.post(`/fiscal-years/${prior.id}/close`, { token: tenant.accessToken });
      expect(closed.body.profit).toBe('100.125');
    });
  });
});
