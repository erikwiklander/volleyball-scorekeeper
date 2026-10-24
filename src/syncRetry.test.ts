import { expect, it } from 'vitest';
import { syncRetry } from './syncRetry';
it('notification storms cannot bypass backoff; successful reconnects reset it', () => {
  let now = 0;
  const retry = syncRetry(() => now);
  retry.fail();
  for (let n = 0; n < 100; n++) expect(retry.ready()).toBe(false);
  now = 2000;
  expect(retry.ready()).toBe(true);
  retry.fail();
  now = 4000;
  expect(retry.ready()).toBe(false);
  retry.reset();
  expect(retry.ready()).toBe(true);
  retry.fail();
  now = 6000;
  expect(retry.ready()).toBe(true);
});
