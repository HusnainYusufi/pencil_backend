import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import { VersioningType } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppConfig } from '../../config/app-config.service.js';

export const API_PREFIX = 'api';

/**
 * HTTP-level setup shared by main.ts and the e2e test harness, so tests
 * exercise exactly the production pipeline.
 */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  const config = app.get(AppConfig);
  const swagger = config.get('SWAGGER_ENABLED');

  await app.register(fastifyHelmet, {
    // The API serves JSON only; CSP matters just for the Swagger UI page.
    contentSecurityPolicy: swagger ? false : { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(fastifyCookie);

  // Echo the request id (Fastify's request.id = resolveRequestId) on every
  // response, including errors and 404s, so clients can quote it to support.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request, reply, done) => {
      void reply.header('x-request-id', request.id);
      done();
    });

  app.enableCors({
    origin: config.get('CORS_ORIGINS'),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept-Language', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed', 'Retry-After'],
    maxAge: 600,
  });

  app.setGlobalPrefix(API_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();

  if (swagger) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Pencil API')
        .setDescription(
          'Multi-tenant accounting API (KSA & Jordan).\n\n' +
            '- **tenant** bearer: tenant users (web/mobile apps).\n' +
            '- **platform** bearer: Pencil staff (pencil_admin).\n\n' +
            'Errors always have the shape `{ "error": { "code", "message", "details", "requestId" } }`.',
        )
        .setVersion('1')
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'tenant')
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'platform')
        .build(),
    );
    SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs/openapi.json' });
  }
}
