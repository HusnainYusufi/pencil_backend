import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { Db } from '../src/core/database/db.service.js';
import { PrismaService } from '../src/core/database/prisma.service.js';
import { Api, createTestApp, signup, type SignedUpTenant } from './helpers.js';
import { TEST_ENV } from './setup-env.js';

describe('Tenant isolation & access control (e2e)', () => {
  let app: NestFastifyApplication;
  let api: Api;
  let tenantA: SignedUpTenant;
  let tenantB: SignedUpTenant;

  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
    tenantA = await signup(api, { legalName: 'Alpha Co' });
    tenantB = await signup(api, { legalName: 'Beta Co' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('seeds the four system roles per company', async () => {
    const res = await api.get('/roles', { token: tenantA.accessToken });
    expect(res.status).toBe(200);
    expect(res.body.map((r: { key: string }) => r.key).sort()).toEqual(['accountant', 'admin', 'owner', 'viewer']);
    expect(res.body.every((r: { tenantId: string }) => r.tenantId === tenantA.tenantId)).toBe(true);
  });

  it("cannot touch another company's records by id", async () => {
    const rolesOfA = (await api.get('/roles', { token: tenantA.accessToken })).body;
    // B holds roles.manage in its own company; A's role must simply not exist for B.
    const res = await api.delete(`/roles/${rolesOfA[0].id}`, { token: tenantB.accessToken });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    const members = await api.get('/members', { token: tenantB.accessToken });
    expect(members.body.items.map((m: { user: { id: string } }) => m.user.id)).toEqual([tenantB.userId]);
  });

  describe('database row-level security (second line of defence)', () => {
    it('scopes even unfiltered queries to the current tenant', async () => {
      const db = app.get(Db);
      const rolesSeenByB = await db.withTenant(tenantB.tenantId, () => db.client.role.findMany());
      expect(rolesSeenByB.length).toBe(4);
      expect(rolesSeenByB.every((r) => r.tenantId === tenantB.tenantId)).toBe(true);
    });

    it('fails fast when tenant data is queried without a scope', async () => {
      const db = app.get(Db);
      await expect(db.client.role.findMany()).rejects.toThrow(/Tenant scope required/);
    });

    it('returns nothing and rejects writes for a raw connection without context', async () => {
      const client = new pg.Client({ connectionString: TEST_ENV.DATABASE_URL });
      await client.connect();
      try {
        expect((await client.query('SELECT count(*)::int AS n FROM roles')).rows[0].n).toBe(0);
        await expect(
          client.query(
            `INSERT INTO roles (id, tenant_id, key, name, permissions, updated_at)
             VALUES (gen_random_uuid(), $1, 'evil', 'evil', '{}', now())`,
            [tenantA.tenantId],
          ),
        ).rejects.toThrow(/row-level security/);
      } finally {
        await client.end();
      }
    });

    it('keeps the audit trail append-only for the application role', async () => {
      const prisma = app.get(PrismaService);
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
          await tx.$executeRaw`UPDATE audit_logs SET action = 'tampered'`;
        }),
      ).rejects.toThrow(/append-only/);
    });
  });

  describe('plan entitlements', () => {
    it('blocks features the plan does not include', async () => {
      const createRole = await api.post('/roles', {
        token: tenantA.accessToken,
        body: { name: 'Cashier', permissions: ['invoices.read'] },
      });
      expect(createRole.status).toBe(403);
      expect(createRole.body.error).toMatchObject({ code: 'FEATURE_NOT_AVAILABLE', details: { feature: 'platform.custom_roles' } });

      const audit = await api.get('/audit-logs', { token: tenantA.accessToken });
      expect(audit.body.error.code).toBe('FEATURE_NOT_AVAILABLE');
    });
  });

  describe('company profile', () => {
    it('updates the profile and validates the tax number per country', async () => {
      const ok = await api.patch('/tenant', { token: tenantA.accessToken, body: { tradeName: 'Alpha', locale: 'en' } });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ tradeName: 'Alpha', locale: 'en' });

      const bad = await api.patch('/tenant', { token: tenantA.accessToken, body: { taxNumber: '1234' } });
      expect(bad.status).toBe(400);

      const tz = await api.patch('/tenant', { token: tenantA.accessToken, body: { timezone: 'Mars/Olympus' } });
      expect(tz.status).toBe(400);
    });
  });

  describe('member management', () => {
    it('prevents changing your own role', async () => {
      const members = (await api.get('/members', { token: tenantA.accessToken })).body.items;
      const roles = (await api.get('/roles', { token: tenantA.accessToken })).body;
      const viewer = roles.find((r: { key: string }) => r.key === 'viewer');
      const res = await api.patch(`/members/${members[0].id}/role`, {
        token: tenantA.accessToken,
        body: { roleId: viewer.id },
      });
      expect(res.status).toBe(403);
    });
  });
});
