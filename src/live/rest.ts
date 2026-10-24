// A fresh server read plus conditional write avoids treating the SDK's offline
// cache as an acknowledgement. An aborted request leaves the durable queue intact.
export function createDatabaseRest({
  databaseURL,
  credentials,
  emulator = false,
  request = fetch,
  timeoutMs = 12_000,
}: {
  databaseURL: string;
  credentials: () => Promise<{ uid: string; token: string }>;
  emulator?: boolean;
  request?: typeof fetch;
  timeoutMs?: number;
}) {
  async function run<T>(
    ownerUid: string,
    operation: (
      send: (path: string, init?: RequestInit) => Promise<Response>,
    ) => Promise<T>,
  ) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Cloud request timed out. Saved changes will retry.'));
      }, timeoutMs);
    });
    const work = async () => {
      const identity = await credentials();
      if (identity.uid !== ownerUid)
        throw new Error(
          'Sign in with the game owner’s Google account to sync.',
        );
      return operation(async (path, init = {}) => {
        if (controller.signal.aborted)
          throw new Error('Cloud request timed out.');
        const base = new URL(databaseURL);
        const url = emulator
          ? new URL('http://127.0.0.1:9000/')
          : new URL(base.origin + '/');
        url.pathname =
          path.split('/').map(encodeURIComponent).join('/') + '.json';
        if (emulator) url.searchParams.set('ns', base.hostname.split('.')[0]);
        // Firebase ID tokens are short-lived; never include request URLs in errors.
        url.searchParams.set('auth', identity.token);
        try {
          return await request(url.href, {
            ...init,
            cache: 'no-store',
            signal: controller.signal,
          });
        } catch {
          throw new Error(
            'Cloud connection interrupted. Saved changes will retry.',
          );
        }
      });
    };
    try {
      return await Promise.race([work(), deadline]);
    } finally {
      clearTimeout(timer!);
    }
  }
  return {
    read(path: string, ownerUid: string): Promise<unknown> {
      return run(ownerUid, async (send) => {
        const response = await send(path);
        if (!response.ok) throw new Error('Could not read the cloud record.');
        return response.json();
      });
    },
    update(
      path: string,
      ownerUid: string,
      change: (current: any) => unknown,
    ): Promise<{ committed: boolean; value: any }> {
      return run(ownerUid, async (send) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          const response = await send(path, {
            headers: { 'X-Firebase-ETag': 'true' },
          });
          if (!response.ok) throw new Error('Could not read the cloud record.');
          const current = await response.json();
          const value = change(current);
          if (value === undefined) return { committed: false, value: current };
          const etag = response.headers.get('ETag');
          if (!etag) throw new Error('Cloud record version unavailable.');
          const written = await send(path, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'if-match': etag },
            body: JSON.stringify(value),
          });
          if (written.status === 412) continue; // Another write won; re-read it.
          if (!written.ok)
            throw new Error(
              'Cloud update was not accepted. Saved changes will retry.',
            );
          return { committed: true, value: await written.json() };
        }
        throw new Error(
          'Cloud record changed during sync. Saved changes will retry.',
        );
      });
    },
  };
}
