import { afterEach, expect, it, vi } from 'vitest';
import { analyticsAllowed, startAnalytics, watchingNow } from './analytics';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
it('watching now expires viewers even when no more heartbeats arrive', () => {
  const data = {
    viewers: 3,
    liveViewers: 3,
    peakWatching: 3,
    active: { a: 100_000, b: 190_000 },
  };
  expect(watchingNow(data, 190_000)).toBe(1);
  expect(watchingNow(data, 280_000)).toBe(0);
});
it('respects both Do Not Track and Global Privacy Control', () => {
  vi.stubGlobal('navigator', { doNotTrack: '1' });
  expect(analyticsAllowed()).toBe(false);
  vi.stubGlobal('navigator', { globalPrivacyControl: true });
  expect(analyticsAllowed()).toBe(false);
  vi.stubGlobal('navigator', { doNotTrack: '0' });
  expect(analyticsAllowed()).toBe(true);
});
it('local development never sends production analytics requests', () => {
  vi.stubEnv(
    'VITE_FIREBASE_CONFIG',
    JSON.stringify({
      apiKey: 'test',
      projectId: 'test',
      databaseURL: 'https://test.firebaseio.com',
      appId: 'test',
    }),
  );
  vi.stubEnv('VITE_FIREBASE_EMULATORS', 'false');
  vi.stubGlobal('location', { hostname: 'localhost' });
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const stop = startAnalytics('scorer');
  stop();
  expect(fetch).not.toHaveBeenCalled();
});
it('heartbeats pause when hidden or offline and cleanup removes timers and listeners', async () => {
  vi.useFakeTimers();
  vi.stubEnv(
    'VITE_FIREBASE_CONFIG',
    JSON.stringify({
      apiKey: 'test',
      projectId: 'demo-test',
      databaseURL: 'https://demo-test.firebaseio.com',
      appId: 'test',
    }),
  );
  vi.stubEnv('VITE_FIREBASE_EMULATORS', 'true');
  vi.stubGlobal('location', { hostname: 'localhost' });
  const doc = Object.assign(new EventTarget(), {
    baseURI: 'http://localhost/app/',
    visibilityState: 'visible',
  });
  const win = Object.assign(new EventTarget(), { setInterval, clearInterval });
  const nav = { onLine: true };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', nav);
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {} });
  const fetch = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetch);
  const stop = startAnalytics('scoreboard', 'game');
  await vi.advanceTimersByTimeAsync(30_000);
  expect(fetch).toHaveBeenCalledTimes(2);
  doc.visibilityState = 'hidden';
  await vi.advanceTimersByTimeAsync(90_000);
  expect(fetch).toHaveBeenCalledTimes(2);
  doc.visibilityState = 'visible';
  nav.onLine = false;
  doc.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(fetch).toHaveBeenCalledTimes(2);
  nav.onLine = true;
  win.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
    kind: 'game',
    publicId: 'game',
  });
  stop();
  win.dispatchEvent(new Event('online'));
  doc.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(90_000);
  expect(fetch).toHaveBeenCalledTimes(3);
});
