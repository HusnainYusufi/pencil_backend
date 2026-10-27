import { safeEqual } from '../../common/helpers/crypto.js';

export interface RotatableSession {
  tokenHash: string;
  previousTokenHash: string | null;
  rotatedAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
}

/**
 *  - valid:       presented token is current -> rotate it.
 *  - stale:       the token rotated moments ago (two tabs refreshing at once)
 *                 -> reject this call only; the session stays alive.
 *  - reuse:       an old token replayed outside the grace window -> treat as
 *                 theft and revoke the whole session (OAuth 2.0 BCP).
 *  - revoked / expired: session is over.
 */
export type RefreshVerdict = 'valid' | 'stale' | 'reuse' | 'revoked' | 'expired';

export const REFRESH_REUSE_GRACE_MS = 30_000;

export function evaluateRefresh(
  session: RotatableSession,
  presentedHash: string,
  now: Date = new Date(),
  graceMs: number = REFRESH_REUSE_GRACE_MS,
): RefreshVerdict {
  if (session.revokedAt) return 'revoked';
  if (session.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (safeEqual(presentedHash, session.tokenHash)) return 'valid';
  const recentlyRotated =
    session.previousTokenHash !== null &&
    session.rotatedAt !== null &&
    now.getTime() - session.rotatedAt.getTime() <= graceMs &&
    safeEqual(presentedHash, session.previousTokenHash);
  return recentlyRotated ? 'stale' : 'reuse';
}
