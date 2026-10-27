import { Controller, Get, Injectable, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { withTimeout } from '../../common/helpers/async.js';
import { PrismaService } from '../database/prisma.service.js';
import { Public } from '../security/decorators.js';

@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly indicators: HealthIndicatorService,
  ) {}

  async check(key: string) {
    const indicator = this.indicators.check(key);
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, 2_000, 'database ping');
      return indicator.up();
    } catch (error) {
      return indicator.down({ message: (error as Error).message });
    }
  }
}

/**
 * Liveness: the process is up (restart if this fails).
 * Readiness: dependencies reachable (stop routing traffic if this fails).
 */
@ApiTags('Health')
@Public()
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([() => this.database.check('database')]);
  }
}
