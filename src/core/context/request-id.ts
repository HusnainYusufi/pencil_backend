import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const REQUEST_ID = Symbol('pencil.requestId');
const VALID_ID = /^[A-Za-z0-9._-]{8,128}$/;

type RawRequest = IncomingMessage & { [REQUEST_ID]?: string };

/**
 * One request id per HTTP request, shared by Fastify, the pino logger and the
 * CLS context regardless of which of them asks first. A well-formed incoming
 * `x-request-id` (from the gateway / frontend) is honoured for tracing.
 */
export function resolveRequestId(req: IncomingMessage): string {
  const raw = req as RawRequest;
  if (raw[REQUEST_ID]) return raw[REQUEST_ID];
  const header = req.headers['x-request-id'];
  const candidate = Array.isArray(header) ? header[0] : header;
  const id = candidate && VALID_ID.test(candidate) ? candidate : randomUUID();
  raw[REQUEST_ID] = id;
  return id;
}
