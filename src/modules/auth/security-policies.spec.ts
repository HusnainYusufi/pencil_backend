import { hasPermission, missingPermissions } from '../../core/security/permissions.js';
import { isGrantablePermission } from '../access/permissions.js';
import { SYSTEM_ROLES } from '../access/system-roles.js';
import { isSubscriptionWritable } from './access-context.service.js';
import { evaluateRefresh, type RotatableSession } from './refresh-policy.js';

describe('permission matching', () => {
  const granted = new Set(['invoices.*', 'reports.read', 'platform.tenants.*']);

  it('supports exact, resource wildcard and namespaced wildcard grants', () => {
    expect(hasPermission(granted, 'invoices.issue')).toBe(true);
    expect(hasPermission(granted, 'reports.read')).toBe(true);
    expect(hasPermission(granted, 'platform.tenants.manage')).toBe(true);
    expect(hasPermission(granted, 'reports.export')).toBe(false);
    expect(hasPermission(granted, 'roles.manage')).toBe(false);
    expect(hasPermission(new Set(['*']), 'anything.at.all')).toBe(true);
  });

  it('reports exactly which permissions are missing', () => {
    expect(missingPermissions(granted, ['invoices.read', 'roles.manage'])).toEqual(['roles.manage']);
  });

  it('never lets custom roles grant the global wildcard', () => {
    expect(isGrantablePermission('*')).toBe(false);
    expect(isGrantablePermission('invoices.*')).toBe(true);
    expect(isGrantablePermission('invoices.issue')).toBe(true);
    expect(isGrantablePermission('nonsense.read')).toBe(false);
    expect(isGrantablePermission('platform.tenants.manage')).toBe(false);
  });

  it('defines only grantable permissions in non-owner system roles', () => {
    for (const role of SYSTEM_ROLES.filter((r) => r.key !== 'owner')) {
      for (const p of role.permissions) expect(isGrantablePermission(p), `${role.key}: ${p}`).toBe(true);
    }
  });
});

describe('refresh token rotation policy', () => {
  const now = new Date('2026-10-27T12:00:00Z');
  const base: RotatableSession = {
    tokenHash: 'a'.repeat(64),
    previousTokenHash: 'b'.repeat(64),
    rotatedAt: new Date(now.getTime() - 5_000),
    expiresAt: new Date(now.getTime() + 60_000),
    revokedAt: null,
  };

  it('accepts the current token', () => {
    expect(evaluateRefresh(base, 'a'.repeat(64), now)).toBe('valid');
  });

  it('tolerates a just-rotated token (parallel tabs) without revoking', () => {
    expect(evaluateRefresh(base, 'b'.repeat(64), now)).toBe('stale');
  });

  it('flags replay of an old token as reuse (theft)', () => {
    const later = new Date(now.getTime() + 60_000 - 1);
    expect(evaluateRefresh({ ...base, expiresAt: new Date(later.getTime() + 1_000) }, 'b'.repeat(64), later)).toBe('reuse');
    expect(evaluateRefresh(base, 'c'.repeat(64), now)).toBe('reuse');
  });

  it('rejects revoked and expired sessions first', () => {
    expect(evaluateRefresh({ ...base, revokedAt: now }, 'a'.repeat(64), now)).toBe('revoked');
    expect(evaluateRefresh({ ...base, expiresAt: now }, 'a'.repeat(64), now)).toBe('expired');
  });
});

describe('subscription write access', () => {
  const now = new Date('2026-10-27T12:00:00Z');
  it('allows active, past-due and unexpired trials; blocks the rest', () => {
    expect(isSubscriptionWritable({ status: 'ACTIVE', trialEndsAt: null }, now)).toBe(true);
    expect(isSubscriptionWritable({ status: 'PAST_DUE', trialEndsAt: null }, now)).toBe(true);
    expect(isSubscriptionWritable({ status: 'TRIALING', trialEndsAt: new Date('2026-11-01') }, now)).toBe(true);
    expect(isSubscriptionWritable({ status: 'TRIALING', trialEndsAt: new Date('2026-10-01') }, now)).toBe(false);
    expect(isSubscriptionWritable({ status: 'CANCELED', trialEndsAt: null }, now)).toBe(false);
    expect(isSubscriptionWritable(null, now)).toBe(false);
  });
});
