import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppConfig } from '../../config/app-config.service.js';
import { PrismaClient } from '../../generated/prisma/client.js';

/**
 * The raw Prisma client (connection pool owner). Application code should not
 * inject this directly: use `Db` so tenant scoping and transactions apply.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly config: AppConfig) {
    const statementTimeout = config.get('DATABASE_STATEMENT_TIMEOUT_MS');
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL'),
        max: config.get('DATABASE_POOL_MAX'),
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
        // Guard rails against runaway queries and abandoned transactions.
        statement_timeout: statementTimeout > 0 ? statementTimeout : undefined,
        idle_in_transaction_session_timeout: 60_000,
        application_name: `pencil-api:${config.get('APP_CELL')}`,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.assertRestrictedRole();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Row-level security is silently skipped for superusers and BYPASSRLS
   * roles. Refuse to run production traffic under such a role.
   */
  private async assertRestrictedRole(): Promise<void> {
    const [role] = await this.$queryRaw<{ name: string; superuser: boolean; bypassrls: boolean }[]>`
      SELECT rolname AS name, rolsuper AS superuser, rolbypassrls AS bypassrls
      FROM pg_roles WHERE rolname = current_user`;
    if (!role || (!role.superuser && !role.bypassrls)) return;

    const message =
      `Database role "${role.name}" bypasses row-level security. ` +
      'Connect as the restricted application role (see scripts/db/init-roles.sql).';
    if (this.config.isProduction) throw new Error(message);
    this.logger.warn(`${message} Tenant isolation is NOT enforced by the database.`);
  }
}
