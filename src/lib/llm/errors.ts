export type Failure =
  /** Worth trying again: the network or the provider, not the request. */
  | { kind: "retryable"; message: string; retryAfterMs?: number }
  /** The endpoint won't accept response_format for this Model. */
  | { kind: "format_refused"; message: string }
  /** The same request would fail every time: a bad key, or an unknown Model. */
  | { kind: "configuration"; message: string };

const RETRYABLE_STATUS = new Set([408, 409, 425, 429]);

export function classifyFailure(err: unknown): Failure {
  const e = err as { status?: number; message?: string; headers?: { get?(name: string): string | null } };
  const message = e?.message ?? String(err);
  const status = e?.status;
  if (status === undefined || status >= 500 || RETRYABLE_STATUS.has(status)) {
    const seconds = Number(e?.headers?.get?.("retry-after"));
    return { kind: "retryable", message, retryAfterMs: seconds > 0 ? seconds * 1000 : undefined };
  }
  if (status === 400 && /response_format|json_schema|structured/i.test(message)) {
    return { kind: "format_refused", message };
  }
  return { kind: "configuration", message };
}

export const MAX_ATTEMPTS = 5;

export function backoffMs(attempt: number, baseMs: number, retryAfterMs?: number) {
  const exponential = baseMs * 2 ** (attempt - 1);
  return Math.max(exponential + Math.random() * baseMs, retryAfterMs ?? 0);
}
