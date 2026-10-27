import type { FastifyReply, FastifyRequest } from 'fastify';
import { API_PREFIX } from '../../core/http/configure-app.js';

export interface RefreshCookieSpec {
  name: string;
  path: string;
}

export const USER_REFRESH_COOKIE: RefreshCookieSpec = { name: 'pencil_rt', path: `/${API_PREFIX}/v1/auth` };
export const PLATFORM_REFRESH_COOKIE: RefreshCookieSpec = {
  name: 'pencil_admin_rt',
  path: `/${API_PREFIX}/v1/platform/auth`,
};

/**
 * httpOnly (no JS access -> XSS cannot steal it), SameSite=Strict (no CSRF),
 * path-scoped (only sent to the auth endpoints).
 */
export function setRefreshCookie(
  reply: FastifyReply,
  spec: RefreshCookieSpec,
  token: string,
  expiresAt: Date,
  secure: boolean,
): void {
  void reply.setCookie(spec.name, token, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: spec.path,
    expires: expiresAt,
  });
}

export function clearRefreshCookie(reply: FastifyReply, spec: RefreshCookieSpec, secure: boolean): void {
  void reply.clearCookie(spec.name, { httpOnly: true, secure, sameSite: 'strict', path: spec.path });
}

export function readRefreshToken(request: FastifyRequest, spec: RefreshCookieSpec, bodyToken?: string): string | undefined {
  return bodyToken ?? request.cookies?.[spec.name];
}
