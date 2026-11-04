import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const csv = z
  .string()
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

/**
 * Single source of truth for runtime configuration. The process fails fast at
 * boot with a readable report if anything is missing or malformed.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4100),
    APP_CELL: z.string().min(1).default('local'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    /** `pretty` needs the pino-pretty dev dependency; containers always log JSON. */
    LOG_FORMAT: z.enum(['json', 'pretty']).optional(),
    TRUST_PROXY: z
      .string()
      .default('false')
      .transform((v): boolean | number => (/^\d+$/.test(v) ? Number(v) : v === 'true')),
    SWAGGER_ENABLED: bool.default(false),
    CORS_ORIGINS: csv.default([]),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(500).default(20),
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(15_000),

    JWT_ISSUER: z.string().min(1).default('pencil-api'),
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_PLATFORM_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    PLATFORM_REFRESH_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(12),
    COOKIE_SECURE: bool.default(true),

    AUTH_MAX_FAILED_LOGINS: z.coerce.number().int().min(3).max(20).default(5),
    AUTH_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

    THROTTLE_TTL_SECONDS: z.coerce.number().int().min(1).default(60),
    THROTTLE_LIMIT: z.coerce.number().int().min(1).default(300),

    /**
     * 32-byte key (base64) that encrypts secrets at rest: e-invoicing private
     * keys and authority credentials. Rotating it requires re-onboarding.
     */
    DATA_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64 encoded')
      .optional(),
    /** Public URL of the tenant web app (links in emails: invitations, password reset). */
    APP_URL: z.url().default('http://localhost:3000'),

    /** Outgoing email (SMTP). Without SMTP_HOST, emails are logged instead of sent (development). */
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    /** true = implicit TLS (port 465); false = STARTTLS (port 587). */
    SMTP_SECURE: bool.default(false),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    EMAIL_FROM: z.email().default('no-reply@pencil.local'),
    EMAIL_FROM_NAME: z.string().min(1).max(100).default('Pencil'),
    /** Reply-to / contact address shown in emails (receive-only). */
    SUPPORT_EMAIL: z.email().optional(),

    /** Background retries of pending e-invoice submissions. */
    EINVOICING_WORKER_ENABLED: bool.default(true),
    EINVOICING_WORKER_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),
  })
  .superRefine((env, ctx) => {
    if (env.JWT_ACCESS_SECRET === env.JWT_PLATFORM_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_PLATFORM_SECRET'],
        message: 'must differ from JWT_ACCESS_SECRET (separate trust domains)',
      });
    }
    if (env.NODE_ENV === 'production') {
      if (!env.COOKIE_SECURE) {
        ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'must be true in production' });
      }
      if (!env.SMTP_HOST) {
        ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'is required in production (invitations and password reset)' });
      }
      if (!env.APP_URL.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'must be https in production' });
      }
      if (!env.DATA_ENCRYPTION_KEY) {
        ctx.addIssue({ code: 'custom', path: ['DATA_ENCRYPTION_KEY'], message: 'is required in production' });
      }
      for (const key of ['JWT_ACCESS_SECRET', 'JWT_PLATFORM_SECRET'] as const) {
        if (env[key].startsWith('change-me')) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'placeholder secret in production' });
        }
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const report = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${report}`);
  }
  return result.data;
}
