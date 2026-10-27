import { Injectable } from '@nestjs/common';
import { RequestContext } from '../context/request-context.service.js';
import { Db, type DbClient } from './db.service.js';

/**
 * Repositories are the only layer that talks to Prisma. Services depend on
 * repositories, never on the ORM, which keeps domain logic testable and lets
 * a query be optimised (raw SQL, caching, read replica) in one place.
 *
 * `client` automatically joins the caller's transaction, so a service can
 * compose several repositories inside `db.transaction()` without plumbing.
 */
@Injectable()
export abstract class BaseRepository {
  constructor(protected readonly db: Db) {}

  protected get client(): DbClient {
    return this.db.client;
  }
}

/**
 * Base for tenant-owned data. Always filter/stamp with `this.tenantId`
 * (application-level isolation); row-level security in Postgres is the
 * second, independent line of defence.
 */
@Injectable()
export abstract class TenantScopedRepository extends BaseRepository {
  constructor(
    db: Db,
    protected readonly ctx: RequestContext,
  ) {
    super(db);
  }

  protected get tenantId(): string {
    return this.ctx.requireTenantId();
  }
}
