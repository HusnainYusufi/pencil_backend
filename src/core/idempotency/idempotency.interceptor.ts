import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { catchError, from, mergeMap, Observable, of, throwError } from 'rxjs';
import { sha256Hex, stableStringify } from '../../common/helpers/crypto.js';
import { RequestContext } from '../context/request-context.service.js';
import { AppException } from '../errors/app.exception.js';
import { ErrorCode } from '../errors/error-codes.js';
import { IdempotencyRepository } from './idempotency.repository.js';
import { IDEMPOTENCY_OPTIONS, type IdempotencyOptions } from './idempotent.decorator.js';

const KEY_FORMAT = /^[A-Za-z0-9_\-:.]{8,255}$/;
const LOCK_MS = 60_000;
const TTL_MS = 24 * 3_600_000;

/**
 * Exactly-once semantics for unsafe requests carrying `Idempotency-Key`:
 *  - first request executes and its response is stored (24h);
 *  - a retry with the same key + same payload replays the stored response;
 *  - same key + different payload -> 422; concurrent duplicate -> 409.
 * Failed requests release the key so the client can retry.
 *
 * Note: the response is recorded after the handler commits. For flows where
 * a crash between commit and record must be impossible (posting ledgers),
 * also enforce a natural unique key in the domain table.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly repository: IdempotencyRepository,
    private readonly ctx: RequestContext,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const options = this.reflector.get<IdempotencyOptions>(IDEMPOTENCY_OPTIONS, context.getHandler()) ?? {};
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const header = request.headers['idempotency-key'];
    const key = Array.isArray(header) ? header[0] : header;
    if (!key) {
      if (options.required) {
        throw new AppException(ErrorCode.BAD_REQUEST, 'Idempotency-Key header is required for this operation');
      }
      return next.handle();
    }
    if (!KEY_FORMAT.test(key)) {
      throw new AppException(ErrorCode.BAD_REQUEST, 'Idempotency-Key must be 8-255 chars of [A-Za-z0-9_-:.]');
    }

    const path = request.url.split('?')[0] ?? request.url;
    const requestHash = sha256Hex(`${request.method} ${path}\n${stableStringify(request.body ?? null)}`);
    const result = await this.repository.acquire({
      scope: this.scope(request),
      key,
      method: request.method,
      path,
      requestHash,
      lockMs: LOCK_MS,
      ttlMs: TTL_MS,
    });

    if (result.acquired) return this.execute(result.id, context, next);

    const existing = result.existing;
    if (existing.requestHash !== requestHash) {
      throw new AppException(
        ErrorCode.IDEMPOTENCY_KEY_REUSED,
        'This Idempotency-Key was already used with a different request',
      );
    }
    if (existing.status === 'COMPLETED') {
      void reply.header('Idempotent-Replayed', 'true');
      return of(existing.responseBody);
    }
    if (await this.repository.takeOver(existing.id, LOCK_MS)) {
      return this.execute(existing.id, context, next);
    }
    void reply.header('Retry-After', '2');
    throw new AppException(ErrorCode.IDEMPOTENCY_IN_PROGRESS, 'An identical request is still being processed');
  }

  private execute(id: string, context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const status = this.successStatus(context);
    return next.handle().pipe(
      mergeMap(async (body: unknown) => {
        // Store exactly what the client receives (JSON-serialized form).
        const stored: unknown = body === undefined ? undefined : JSON.parse(JSON.stringify(body));
        await this.repository.complete(id, status, stored);
        return body;
      }),
      catchError((error: unknown) =>
        from(this.repository.release(id)).pipe(mergeMap(() => throwError(() => error))),
      ),
    );
  }

  private successStatus(context: ExecutionContext): number {
    const explicit = this.reflector.get<number>(HTTP_CODE_METADATA, context.getHandler());
    if (explicit) return explicit;
    return context.switchToHttp().getRequest<FastifyRequest>().method === 'POST'
      ? HttpStatus.CREATED
      : HttpStatus.OK;
  }

  private scope(request: FastifyRequest): string {
    const actor = this.ctx.actor;
    switch (actor?.type) {
      case 'user':
        return `user:${actor.userId}:tenant:${actor.tenantId ?? '-'}`;
      case 'platform_admin':
        return `admin:${actor.adminId}`;
      default:
        return `anon:${request.ip}`;
    }
  }
}
