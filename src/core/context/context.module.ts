import { Global, Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { resolveRequestId } from './request-id.js';
import { RequestContext } from './request-context.service.js';

@Global()
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      // Middleware wraps the whole pipeline (guards, interceptors, handlers).
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req) => resolveRequestId(req),
      },
    }),
  ],
  providers: [RequestContext],
  exports: [RequestContext],
})
export class ContextModule {}
