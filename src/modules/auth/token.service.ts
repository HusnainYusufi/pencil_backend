import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomToken, sha256Hex } from '../../common/helpers/crypto.js';
import { AppConfig } from '../../config/app-config.service.js';
import { AppException } from '../../core/errors/app.exception.js';
import { ErrorCode } from '../../core/errors/error-codes.js';

/** Separate audiences + secrets: a tenant token can never pass as a platform token. */
export const TENANT_AUDIENCE = 'pencil:tenant';
export const PLATFORM_AUDIENCE = 'pencil:platform';

export interface TenantAccessClaims {
  sub: string;
  sid: string;
  tid: string | null;
}

export interface PlatformAccessClaims {
  sub: string;
  sid: string;
}

export interface IssuedAccessToken {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  signTenantAccess(claims: TenantAccessClaims): Promise<IssuedAccessToken> {
    return this.sign({ sid: claims.sid, tid: claims.tid }, claims.sub, this.config.jwt.accessSecret, TENANT_AUDIENCE);
  }

  async verifyTenantAccess(token: string): Promise<TenantAccessClaims> {
    const payload = await this.verify(token, this.config.jwt.accessSecret, TENANT_AUDIENCE);
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') throw this.invalid();
    const tid = payload.tid;
    if (tid !== null && typeof tid !== 'string') throw this.invalid();
    return { sub: payload.sub, sid: payload.sid, tid };
  }

  signPlatformAccess(claims: PlatformAccessClaims): Promise<IssuedAccessToken> {
    return this.sign({ sid: claims.sid }, claims.sub, this.config.jwt.platformSecret, PLATFORM_AUDIENCE);
  }

  async verifyPlatformAccess(token: string): Promise<PlatformAccessClaims> {
    const payload = await this.verify(token, this.config.jwt.platformSecret, PLATFORM_AUDIENCE);
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') throw this.invalid();
    return { sub: payload.sub, sid: payload.sid };
  }

  /**
   * Refresh tokens are opaque: `<session uuid>.<256-bit secret>`. Only the
   * SHA-256 of the secret is stored, so a database leak yields no usable tokens.
   */
  newRefreshSecret(): { secret: string; hash: string } {
    const secret = randomToken(32);
    return { secret, hash: sha256Hex(secret) };
  }

  composeRefreshToken(sessionId: string, secret: string): string {
    return `${sessionId}.${secret}`;
  }

  parseRefreshToken(token: string): { sessionId: string; secretHash: string } | null {
    const dot = token.indexOf('.');
    if (dot < 0) return null;
    const sessionId = token.slice(0, dot);
    const secret = token.slice(dot + 1);
    if (!UUID.test(sessionId) || !/^[A-Za-z0-9_-]{40,64}$/.test(secret)) return null;
    return { sessionId, secretHash: sha256Hex(secret) };
  }

  private async sign(
    payload: Record<string, unknown>,
    subject: string,
    secret: string,
    audience: string,
  ): Promise<IssuedAccessToken> {
    const expiresIn = this.config.jwt.accessTtlSeconds;
    const accessToken = await this.jwt.signAsync(payload, {
      secret,
      algorithm: 'HS256',
      expiresIn,
      issuer: this.config.jwt.issuer,
      audience,
      subject,
    });
    return { accessToken, tokenType: 'Bearer', expiresIn };
  }

  private async verify(token: string, secret: string, audience: string): Promise<Record<string, unknown>> {
    try {
      return await this.jwt.verifyAsync<Record<string, unknown>>(token, {
        secret,
        algorithms: ['HS256'], // pinned: rejects `alg: none` and algorithm confusion
        issuer: this.config.jwt.issuer,
        audience,
      });
    } catch (error) {
      if ((error as Error).name === 'TokenExpiredError') {
        throw new AppException(ErrorCode.TOKEN_EXPIRED, 'Access token expired');
      }
      throw this.invalid();
    }
  }

  private invalid(): AppException {
    return new AppException(ErrorCode.INVALID_TOKEN, 'Invalid access token');
  }
}
