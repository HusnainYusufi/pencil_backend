import { Injectable } from '@nestjs/common';
import { hash, verify, type Algorithm, type Options } from '@node-rs/argon2';

/**
 * Argon2id with OWASP-recommended parameters (19 MiB, t=2, p=1). Native
 * (Rust) implementation: runs off the event loop.
 */
const ARGON2_OPTIONS: Options = {
  algorithm: 2 as Algorithm, // Argon2id (const enum: not importable as a value)
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class PasswordService {
  private dummyHash?: Promise<string>;

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false; // malformed hash
    }
  }

  /**
   * Burns the same CPU time as a real verification, so "unknown email" and
   * "wrong password" are indistinguishable by response timing.
   */
  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash('pencil-timing-equalizer');
    await this.verify(await this.dummyHash, password);
  }
}
