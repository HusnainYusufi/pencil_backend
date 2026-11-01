import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Api, createTestApp, signup, TEST_PASSWORD, uniqueEmail } from './helpers.js';

describe('Auth (e2e)', () => {
  let app: NestFastifyApplication;
  let api: Api;

  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('signup', () => {
    it('creates user + company + owner role + trial and signs in', async () => {
      const email = uniqueEmail();
      const res = await api.post('/auth/signup', {
        body: {
          fullName: 'Sara Al-Harbi',
          email: email.toUpperCase(),
          password: TEST_PASSWORD,
          company: { legalName: 'Al Noor Trading', country: 'SA', taxNumber: '300000000000003' },
        },
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ tokenType: 'Bearer', user: { email }, tenants: [{ role: { key: 'owner' }, baseCurrency: 'SAR' }] });
      expect(res.body.activeTenantId).toBe(res.body.tenants[0].id);
      expect(res.body.user).not.toHaveProperty('passwordHash');
      const cookie = String(res.headers['set-cookie']);
      expect(cookie).toMatch(/pencil_rt=/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Strict/);
    });

    it('derives currency & timezone from the country (Jordan -> JOD)', async () => {
      const owner = await signup(api, { country: 'JO' });
      const res = await api.get('/tenant', { token: owner.accessToken });
      expect(res.body).toMatchObject({ country: 'JO', baseCurrency: 'JOD', timezone: 'Asia/Amman' });
    });

    it('rejects a duplicate email', async () => {
      const owner = await signup(api);
      const res = await api.post('/auth/signup', {
        body: { fullName: 'Dup', email: owner.email, password: TEST_PASSWORD, company: { legalName: 'Dup Co', country: 'JO' } },
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EMAIL_TAKEN');
    });

    it('validates the KSA VAT number format', async () => {
      const res = await api.post('/auth/signup', {
        body: {
          fullName: 'Bad Vat',
          email: uniqueEmail(),
          password: TEST_PASSWORD,
          company: { legalName: 'Bad Vat Co', country: 'SA', taxNumber: '123456789012345' },
        },
      });
      expect(res.status).toBe(400);
      expect(res.body.error.details[0].field).toBe('company.taxNumber');
    });
  });

  describe('me', () => {
    it('returns permissions, plan and entitlements for the active company', async () => {
      const owner = await signup(api);
      const res = await api.get('/me', { token: owner.accessToken });
      expect(res.status).toBe(200);
      expect(res.body.permissions).toEqual(['*']);
      expect(res.body.plan).toBe('starter');
      expect(res.body.entitlements['tax.einvoicing']).toEqual({ enabled: true, limit: null });
      expect(res.body.entitlements['limits.users']).toEqual({ enabled: true, limit: 3 });
    });
  });

  describe('login', () => {
    it('signs in and auto-selects the only company', async () => {
      const owner = await signup(api);
      const res = await api.post('/auth/login', { body: { email: owner.email, password: TEST_PASSWORD } });
      expect(res.status).toBe(200);
      expect(res.body.activeTenantId).toBe(owner.tenantId);
    });

    it('gives the same answer for unknown email and wrong password', async () => {
      const owner = await signup(api);
      const wrong = await api.post('/auth/login', { body: { email: owner.email, password: 'nope-nope-1' } });
      const unknown = await api.post('/auth/login', { body: { email: uniqueEmail(), password: 'nope-nope-1' } });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('locks the account after repeated failures, even for the right password', async () => {
      const owner = await signup(api);
      for (let i = 0; i < 3; i++) {
        await api.post('/auth/login', { body: { email: owner.email, password: 'wrong-pass-1' } });
      }
      const res = await api.post('/auth/login', { body: { email: owner.email, password: TEST_PASSWORD } });
      expect(res.status).toBe(423);
      expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
    });
  });

  describe('refresh tokens', () => {
    it('rotates on every refresh; a just-used token is rejected without killing the session', async () => {
      const owner = await signup(api);
      const first = await api.post('/auth/refresh', { body: { refreshToken: owner.refreshToken } });
      expect(first.status).toBe(200);
      expect(first.body.refreshToken).not.toBe(owner.refreshToken);

      const replay = await api.post('/auth/refresh', { body: { refreshToken: owner.refreshToken } });
      expect(replay.status).toBe(401);
      expect(replay.body.error.code).toBe('INVALID_TOKEN');

      const second = await api.post('/auth/refresh', { body: { refreshToken: first.body.refreshToken } });
      expect(second.status).toBe(200);
    });

    it('accepts the refresh token from the httpOnly cookie', async () => {
      const owner = await signup(api);
      const res = await api.post('/auth/refresh', { body: {}, headers: { cookie: `pencil_rt=${owner.refreshToken}` } });
      expect(res.status).toBe(200);
    });

    it('revokes the whole session when a forged/old token is presented (theft detection)', async () => {
      const owner = await signup(api);
      await api.get('/me', { token: owner.accessToken }); // warm the access cache
      const sessionId = owner.refreshToken.split('.')[0];
      const forged = `${sessionId}.${'x'.repeat(43)}`;

      const attack = await api.post('/auth/refresh', { body: { refreshToken: forged } });
      expect(attack.body.error.code).toBe('SESSION_REVOKED');

      const legit = await api.post('/auth/refresh', { body: { refreshToken: owner.refreshToken } });
      expect(legit.body.error.code).toBe('SESSION_REVOKED');
      const me = await api.get('/me', { token: owner.accessToken });
      expect(me.status).toBe(401);
    });
  });

  describe('logout', () => {
    it('invalidates the access token immediately', async () => {
      const owner = await signup(api);
      expect((await api.get('/me', { token: owner.accessToken })).status).toBe(200);
      expect((await api.post('/auth/logout', { token: owner.accessToken })).status).toBe(204);
      const after = await api.get('/me', { token: owner.accessToken });
      expect(after.status).toBe(401);
      expect(after.body.error.code).toBe('SESSION_REVOKED');
    });
  });

  describe('token hygiene', () => {
    it('rejects missing, malformed and cross-realm tokens', async () => {
      const owner = await signup(api);
      expect((await api.get('/me')).body.error.code).toBe('UNAUTHENTICATED');
      expect((await api.get('/me', { token: 'not.a.jwt' })).body.error.code).toBe('INVALID_TOKEN');
      // A tenant token must never open the platform API.
      const crossRealm = await api.get('/platform/tenants', { token: owner.accessToken });
      expect(crossRealm.status).toBe(401);
      expect(crossRealm.body.error.code).toBe('INVALID_TOKEN');
    });

    it('echoes a request id on every response', async () => {
      const res = await api.get('/me', { headers: { 'x-request-id': 'trace-abc-12345' } });
      expect(res.headers['x-request-id']).toBe('trace-abc-12345');
      expect(res.body.error.requestId).toBe('trace-abc-12345');
    });
  });
});
