export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
  /** Additional attempts after the first. Default 3. */
  retries?: number;
  /** First backoff delay in ms; doubles each attempt (with jitter). Default 100. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

/** Exponential backoff with full jitter, for calls to flaky external systems. */
export async function retry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 3, baseDelayMs = 100, maxDelayMs = 5_000, shouldRetry = () => true } = options;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error, attempt)) throw error;
      const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      await sleep(Math.random() * ceiling);
    }
  }
}

/** Rejects if `promise` does not settle within `ms`. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
