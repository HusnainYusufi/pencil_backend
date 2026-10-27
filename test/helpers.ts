import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/core/http/configure-app.js';
import { createFastifyAdapter } from '../src/core/http/fastify-adapter.js';
import { TEST_PLATFORM_ADMIN } from './setup-env.js';

/** Boots the real application (same pipeline as production) on Fastify inject. */
export async function createTestApp(): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(false), { logger: false });
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

export interface ApiResponse<T = any> {
  status: number;
  body: T;
  headers: Record<string, string | string[] | number | undefined>;
}

export interface RequestOptions {
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export class Api {
  constructor(private readonly app: NestFastifyApplication) {}

  async request<T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    const response = await this.app.inject({
      method,
      url: `/api/v1${url}`,
      headers: {
        ...(options.token && { authorization: `Bearer ${options.token}` }),
        ...(options.body !== undefined && { 'content-type': 'application/json' }),
        ...options.headers,
      },
      payload: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    return {
      status: response.statusCode,
      body: response.body ? (JSON.parse(response.body) as T) : (undefined as T),
      headers: response.headers,
    };
  }

  get = <T = any>(url: string, options?: RequestOptions) => this.request<T>('GET', url, options);
  post = <T = any>(url: string, options?: RequestOptions) => this.request<T>('POST', url, options);
  put = <T = any>(url: string, options?: RequestOptions) => this.request<T>('PUT', url, options);
  patch = <T = any>(url: string, options?: RequestOptions) => this.request<T>('PATCH', url, options);
  delete = <T = any>(url: string, options?: RequestOptions) => this.request<T>('DELETE', url, options);
}

export const uniqueEmail = (prefix = 'user') => `${prefix}-${randomUUID().slice(0, 8)}@pencil.test`;
export const TEST_PASSWORD = 'Str0ngPassw0rd';
export const VALID_SA_VAT = '300000000000003';

export interface SignedUpTenant {
  email: string;
  userId: string;
  tenantId: string;
  accessToken: string;
  refreshToken: string;
}

export async function signup(api: Api, overrides: { email?: string; country?: 'SA' | 'JO'; legalName?: string } = {}): Promise<SignedUpTenant> {
  const email = overrides.email ?? uniqueEmail('owner');
  const res = await api.post('/auth/signup', {
    body: {
      fullName: 'Test Owner',
      email,
      password: TEST_PASSWORD,
      company: {
        legalName: overrides.legalName ?? 'Test Trading Co',
        country: overrides.country ?? 'SA',
        ...(overrides.country !== 'JO' && { taxNumber: VALID_SA_VAT }),
      },
    },
  });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    email,
    userId: res.body.user.id,
    tenantId: res.body.activeTenantId,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
  };
}

export async function platformLogin(api: Api): Promise<string> {
  const res = await api.post('/platform/auth/login', { body: TEST_PLATFORM_ADMIN });
  if (res.status !== 200) throw new Error(`platform login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.accessToken;
}
