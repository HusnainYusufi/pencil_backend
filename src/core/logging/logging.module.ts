import type { IncomingMessage, ServerResponse } from 'node:http';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfig } from '../../config/app-config.service.js';
import { resolveRequestId } from '../context/request-id.js';

/**
 * Structured JSON logs (pino: the fastest Node logger), one line per request
 * with request id, tenant and user attached by AuthGuard. Pretty-printed
 * locally only.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        assignResponse: true,
        pinoHttp: {
          level: config.get('LOG_LEVEL'),
          base: { cell: config.get('APP_CELL') },
          genReqId: (req: IncomingMessage) => resolveRequestId(req),
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
              '*.password',
              '*.refreshToken',
              '*.accessToken',
            ],
            censor: '[REDACTED]',
          },
          serializers: {
            req: (req: { id: string; method: string; url: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url,
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
          customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) =>
            err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
          autoLogging: {
            ignore: (req: IncomingMessage) => req.url?.startsWith('/api/health') ?? false,
          },
          transport:
            (config.get('LOG_FORMAT') ?? (config.isProduction || config.isTest ? 'json' : 'pretty')) === 'json'
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: { singleLine: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname,cell' },
                },
        },
      }),
    }),
  ],
})
export class LoggingModule {}
