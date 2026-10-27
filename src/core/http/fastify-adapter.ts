import type { IncomingMessage } from 'node:http';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { resolveRequestId } from '../context/request-id.js';

/** Fastify (≈2-3x Express throughput) with hardened defaults. */
export function createFastifyAdapter(trustProxy: boolean | number): FastifyAdapter {
  return new FastifyAdapter({
    // A number means "trust this many proxy hops" (e.g. 1 behind an ALB).
    trustProxy: typeof trustProxy === 'number' ? (_address: string, hop: number) => hop < trustProxy : trustProxy,
    bodyLimit: 1_048_576, // 1 MiB; file uploads will get dedicated routes
    genReqId: (req: IncomingMessage) => resolveRequestId(req),
    return503OnClosing: true,
    connectionTimeout: 30_000,
    keepAliveTimeout: 72_000, // > typical load-balancer idle timeout (60s)
  });
}
