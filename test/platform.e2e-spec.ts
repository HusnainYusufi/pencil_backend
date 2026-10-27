import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Api, createTestApp, signup, TEST_PASSWORD, uniqueEmail } from './helpers.js';

describe('Platform admin API (e2e)', () => {
  let app: NestFastifyApplication;
  let api: Api;
  let admin: string;

  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
    const login = await api.post('/platform/auth/login', { body: { email: 'root@pencil.test', password: 'PlatformRoot!2026' } });
    expect(login.status).toBe(200);
    admin = login.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('identifies the admin and rejects platform tokens on the tenant API', async () => {
    const me = await api.get('/platform/auth/me', { token: admin });
    expect(me.body).toMatchObject({ role: 'SUPER_ADMIN', permissions: ['*'] });
    const crossRealm = await api.get('/me', { token: admin });
    expect(crossRealm.status).toBe(401);
  });

  describe('onboarding with idempotency', () => {
    const body = () => ({
      company: { legalName: 'Gulf Contracting LLC', country: 'SA', taxNumber: '310000000000003' },
      owner: { email: ownerEmail, fullName: 'Khalid', password: TEST_PASSWORD },
      planCode: 'starter',
    });
    const ownerEmail = uniqueEmail('onboard');

    it('creates once and replays the stored response on retry', async () => {
      const headers = { 'idempotency-key': 'onboard-gulf-contracting-001' };
      const first = await api.post('/platform/tenants', { token: admin, body: body(), headers });
      expect(first.status).toBe(201);
      expect(first.body.subscription.plan.code).toBe('starter');

      const retry = await api.post('/platform/tenants', { token: admin, body: body(), headers });
      expect(retry.status).toBe(201);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.body.id).toBe(first.body.id);

      const misuse = await api.post('/platform/tenants', {
        token: admin,
        body: { ...body(), planCode: 'business' },
        headers,
      });
      expect(misuse.status).toBe(422);
      expect(misuse.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });
  });

  describe('tenant lifecycle', () => {
    it('upgrades the plan and the tenant gains features immediately', async () => {
      const owner = await signup(api);
      const blocked = await api.post('/roles', { token: owner.accessToken, body: { name: 'Cashier', permissions: ['invoices.read'] } });
      expect(blocked.status).toBe(403);

      const upgrade = await api.put(`/platform/tenants/${owner.tenantId}/subscription`, {
        token: admin,
        body: { planCode: 'professional', status: 'ACTIVE' },
      });
      expect(upgrade.status).toBe(200);
      expect(upgrade.body.subscription).toMatchObject({ status: 'ACTIVE', plan: { code: 'professional' } });

      const created = await api.post('/roles', {
        token: owner.accessToken,
        body: { name: 'Cashier', permissions: ['invoices.read', 'invoices.issue', 'contacts.*'] },
      });
      expect(created.status).toBe(201);
      expect(created.body.permissions).toEqual(['contacts.*', 'invoices.issue', 'invoices.read']);

      const invalid = await api.post('/roles', { token: owner.accessToken, body: { name: 'God', permissions: ['*'] } });
      expect(invalid.status).toBe(400);

      const audit = await api.get('/audit-logs', { token: owner.accessToken });
      expect(audit.status).toBe(200);
      const actions = audit.body.items.map((e: { action: string }) => e.action);
      expect(actions).toEqual(expect.arrayContaining(['role.created', 'subscription.changed', 'tenant.provisioned']));
    });

    it('per-tenant overrides beat the plan', async () => {
      const owner = await signup(api);
      await api.put(`/platform/tenants/${owner.tenantId}/subscription`, { token: admin, body: { planCode: 'professional' } });

      const override = await api.put(`/platform/tenants/${owner.tenantId}/features/roles.custom`, {
        token: admin,
        body: { enabled: false, reason: 'Abuse investigation' },
      });
      expect(override.status).toBe(200);
      const res = await api.post('/roles', { token: owner.accessToken, body: { name: 'X role', permissions: [] } });
      expect(res.body.error.code).toBe('FEATURE_NOT_AVAILABLE');

      const detail = await api.get(`/platform/tenants/${owner.tenantId}`, { token: admin });
      expect(detail.body.entitlements['roles.custom'].enabled).toBe(false);
      expect(detail.body.overrides).toHaveLength(1);

      expect((await api.delete(`/platform/tenants/${owner.tenantId}/features/roles.custom`, { token: admin })).status).toBe(204);
      expect((await api.post('/roles', { token: owner.accessToken, body: { name: 'X role', permissions: [] } })).status).toBe(201);
    });

    it('suspension locks the company out; reactivation restores access', async () => {
      const owner = await signup(api);
      expect((await api.get('/tenant', { token: owner.accessToken })).status).toBe(200);

      const noReason = await api.patch(`/platform/tenants/${owner.tenantId}/status`, { token: admin, body: { status: 'SUSPENDED' } });
      expect(noReason.status).toBe(400);

      await api.patch(`/platform/tenants/${owner.tenantId}/status`, {
        token: admin,
        body: { status: 'SUSPENDED', reason: 'Unpaid invoices' },
      });
      const suspended = await api.get('/tenant', { token: owner.accessToken });
      expect(suspended.status).toBe(403);
      expect(suspended.body.error.code).toBe('TENANT_SUSPENDED');

      await api.patch(`/platform/tenants/${owner.tenantId}/status`, { token: admin, body: { status: 'ACTIVE' } });
      expect((await api.get('/tenant', { token: owner.accessToken })).status).toBe(200);
    });

    it('a lapsed subscription makes the company read-only', async () => {
      const owner = await signup(api);
      await api.put(`/platform/tenants/${owner.tenantId}/subscription`, {
        token: admin,
        body: { planCode: 'professional', status: 'CANCELED' },
      });
      expect((await api.get('/tenant', { token: owner.accessToken })).status).toBe(200);
      const write = await api.patch('/tenant', { token: owner.accessToken, body: { tradeName: 'Nope' } });
      expect(write.status).toBe(402);
      expect(write.body.error.code).toBe('SUBSCRIPTION_INACTIVE');
    });
  });

  describe('catalog', () => {
    it('lists tenants with search and pagination', async () => {
      await signup(api, { legalName: 'Searchable Widgets Est' });
      const res = await api.get('/platform/tenants?search=searchable&pageSize=5', { token: admin });
      expect(res.status).toBe(200);
      expect(res.body.meta).toMatchObject({ page: 1, pageSize: 5 });
      expect(res.body.items[0].legalName).toBe('Searchable Widgets Est');
    });

    it('creates plans and validates feature keys and prices', async () => {
      const bad = await api.post('/platform/plans', {
        token: admin,
        body: { code: 'bad', name: 'Bad', features: [{ featureKey: 'does.not.exist', enabled: true }], prices: [] },
      });
      expect(bad.status).toBe(400);

      const ok = await api.post('/platform/plans', {
        token: admin,
        body: {
          code: `enterprise-${Date.now()}`,
          name: 'Enterprise',
          isPublic: false,
          trialDays: 0,
          features: [
            { featureKey: 'users.max', enabled: true, limitValue: null },
            { featureKey: 'api.access', enabled: true },
          ],
          prices: [{ currency: 'JOD', interval: 'YEARLY', amount: '4999.500' }],
        },
      });
      expect(ok.status).toBe(201);
      expect(ok.body.prices[0].amount).toBe('4999.5');
    });

    it('exposes a cross-tenant audit trail to platform staff', async () => {
      for (const action of ['tenant.status_changed', 'platform.auth.login', 'tenant.provisioned']) {
        const res = await api.get(`/platform/audit-logs?action=${action}&limit=5`, { token: admin });
        expect(res.status).toBe(200);
        expect(res.body.items.length).toBeGreaterThan(0);
        expect(res.body.items.every((e: { action: string }) => e.action === action)).toBe(true);
      }
    });
  });
});
