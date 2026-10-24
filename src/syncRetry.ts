// Notifications from cloud listeners and other tabs must not bypass backoff.
export function syncRetry(now = Date.now) {
  let failures = 0,
    retryAt = 0;
  return {
    ready: () => now() >= retryAt,
    fail() {
      retryAt = now() + Math.min(30_000, 2_000 * 2 ** Math.min(failures++, 4));
    },
    reset() {
      failures = 0;
      retryAt = 0;
    },
  };
}
