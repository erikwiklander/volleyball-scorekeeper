import { afterEach, expect, it, vi } from 'vitest';
import { createDatabaseRest } from './rest';
const credentials = async () => ({ uid: 'owner', token: 'private-test-token' });
afterEach(() => vi.useRealTimers());
it('a lost write acknowledgement is recovered from the server without writing twice', async () => {
  let current = { revision: 1, mutationId: 'old' },
    puts = 0;
  const api = createDatabaseRest({
    databaseURL: 'https://demo.firebaseio.com',
    credentials,
    request: async (_url, options) => {
      expect(options?.cache).toBe('no-store');
      if (options?.method === 'PUT') {
        puts++;
        current = JSON.parse(options.body as string);
        throw new TypeError('lost response');
      }
      return new Response(JSON.stringify(current), {
        headers: { ETag: '"version"' },
      });
    },
  });
  const write = () =>
    api.update('users/owner/games/game', 'owner', (value) =>
      value.mutationId === 'new'
        ? undefined
        : { revision: 2, mutationId: 'new' },
    );
  await expect(write()).rejects.toThrow('interrupted');
  expect((await write()).value).toEqual({ revision: 2, mutationId: 'new' });
  expect(puts).toBe(1);
});
it('conditional conflicts re-read the server and preserve the concurrent writer', async () => {
  let reads = 0;
  const api = createDatabaseRest({
    databaseURL: 'https://demo.firebaseio.com',
    credentials,
    request: async (_url, options) => {
      if (options?.method === 'PUT') return new Response('{}', { status: 412 });
      reads++;
      return new Response(JSON.stringify({ revision: reads }), {
        headers: { ETag: '"version"' },
      });
    },
  });
  const result = await api.update('matches/game', 'owner', (current) =>
    current.revision === 1 ? { revision: 2 } : undefined,
  );
  expect(result).toEqual({ committed: false, value: { revision: 2 } });
  expect(reads).toBe(2);
});
it('a stalled request is aborted and late auth cannot start a write after its deadline', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const api = createDatabaseRest({
    databaseURL: 'https://demo.firebaseio.com',
    credentials,
    timeoutMs: 100,
    request: async (_url, options) => {
      signal = options?.signal as AbortSignal;
      return new Promise(() => {});
    },
  });
  const stalled = expect(api.read('matches/game', 'owner')).rejects.toThrow(
    'timed out',
  );
  await vi.advanceTimersByTimeAsync(101);
  await stalled;
  expect(signal?.aborted).toBe(true);
  let finish!: (value: { uid: string; token: string }) => void;
  const request = vi.fn();
  const delayed = createDatabaseRest({
    databaseURL: 'https://demo.firebaseio.com',
    credentials: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    timeoutMs: 100,
    request,
  });
  const timeout = expect(delayed.read('matches/game', 'owner')).rejects.toThrow(
    'timed out',
  );
  await vi.advanceTimersByTimeAsync(101);
  await timeout;
  finish({ uid: 'owner', token: 'secret' });
  await Promise.resolve();
  await Promise.resolve();
  expect(request).not.toHaveBeenCalled();
});
it('wrong accounts never send a request and permission errors do not expose token URLs', async () => {
  const request = vi.fn(async () => new Response('{}', { status: 401 }));
  const api = createDatabaseRest({
    databaseURL: 'https://demo.firebaseio.com',
    credentials,
    request,
  });
  await expect(api.read('matches/game', 'other')).rejects.toThrow('owner');
  expect(request).not.toHaveBeenCalled();
  await expect(api.read('matches/game', 'owner')).rejects.toThrow(
    'Could not read',
  );
});
