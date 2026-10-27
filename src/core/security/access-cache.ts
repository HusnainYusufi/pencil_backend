import { Injectable } from '@nestjs/common';
import { LRUCache } from 'lru-cache';

/**
 * Short-lived cache of resolved access contexts (session + membership +
 * role + tenant status), so authenticated requests usually cost zero extra
 * queries. Domain code invalidates it on change; across instances, staleness
 * is bounded by the TTL. (Swap for Redis pub/sub invalidation when scaling
 * horizontally.)
 */
@Injectable()
export class AccessCache {
  static readonly TTL_MS = 30_000;

  private readonly cache = new LRUCache<string, object>({
    max: 20_000,
    ttl: AccessCache.TTL_MS,
  });

  get<T extends object>(key: string): T | undefined {
    return this.cache.get(key) as T | undefined;
  }

  set(key: string, value: object): void {
    this.cache.set(key, value);
  }

  /** Drops every entry whose key contains `:<segment>:` (see key builders). */
  invalidateMatching(segment: string): void {
    const needle = `:${segment}:`;
    for (const key of this.cache.keys()) {
      if (key.includes(needle)) this.cache.delete(key);
    }
  }

  invalidateSession(sessionId: string): void {
    this.invalidateMatching(sessionId);
  }

  invalidateUser(userId: string): void {
    this.invalidateMatching(userId);
  }

  invalidateTenant(tenantId: string): void {
    this.invalidateMatching(tenantId);
  }

  clear(): void {
    this.cache.clear();
  }

  /** Key embeds each id between colons so invalidation by any id works. */
  static userKey(sessionId: string, userId: string, tenantId: string | null): string {
    return `u:${sessionId}:${userId}:${tenantId ?? '-'}:`;
  }

  static platformKey(sessionId: string, adminId: string): string {
    return `p:${sessionId}:${adminId}:`;
  }
}
