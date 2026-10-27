import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { AppConfig } from './config/app-config.service.js';
import { envSchema } from './config/env.schema.js';
import { configureApp } from './core/http/configure-app.js';
import { createFastifyAdapter } from './core/http/fastify-adapter.js';

async function bootstrap(): Promise<void> {
  // Importing AppModule already loaded .env and validated the environment
  // (ConfigModule.forRoot); the adapter needs this one value before Nest starts.
  const trustProxy = envSchema.shape.TRUST_PROXY.parse(process.env.TRUST_PROXY);

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, createFastifyAdapter(trustProxy), {
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  await configureApp(app);

  const config = app.get(AppConfig);
  await app.listen({ port: config.get('PORT'), host: config.get('HOST') });
  logger.log(
    `Pencil API listening on ${await app.getUrl()}/api (env=${config.get('NODE_ENV')}, cell=${config.get('APP_CELL')})`,
    'Bootstrap',
  );
}

await bootstrap();
