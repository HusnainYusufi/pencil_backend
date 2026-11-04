import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service.js';
import { AppException } from '../errors/app.exception.js';
import { ErrorCode } from '../errors/error-codes.js';

const VERSION = 'v1';

/**
 * Authenticated encryption (AES-256-GCM) for secrets stored in the database:
 * e-invoicing private keys and authority credentials. Ciphertext format:
 * `v1.<iv>.<tag>.<data>` (base64url). The key never leaves the API process.
 */
@Injectable()
export class SecretBox {
  private readonly key: Buffer | null;

  constructor(config: AppConfig) {
    const raw = config.get('DATA_ENCRYPTION_KEY');
    this.key = raw ? Buffer.from(raw, 'base64') : null;
  }

  get available(): boolean {
    return this.key !== null;
  }

  encrypt(plaintext: string): string {
    const key = this.requireKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
  }

  decrypt(ciphertext: string): string {
    const key = this.requireKey();
    const [version, iv, tag, data] = ciphertext.split('.');
    if (version !== VERSION || !iv || !tag || data === undefined) throw new Error('SecretBox: unsupported ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new AppException(
        ErrorCode.EINVOICING_NOT_READY,
        'Secret storage is not configured on this server (DATA_ENCRYPTION_KEY)',
      );
    }
    return this.key;
  }
}
