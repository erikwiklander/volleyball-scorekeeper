import type { IDBPDatabase } from 'idb';
import { readSnapshot } from '../db';
import { liveConfig } from './config';
import { flushQueue } from './queue';
import { syncRetry } from '../syncRetry';
let status = '';
const listeners = new Set<() => void>();
export const getLiveStatus = () => status;
export const subscribeLiveStatus = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function report(message: string) {
  if (status === message) return;
  status = message;
  listeners.forEach((listener) => listener());
}
export function startLiveWorker(db: IDBPDatabase) {
  if (!liveConfig()) return { wake() {}, stop() {} };
  let stopped = false,
    running = false,
    again = false,
    connected = false;
  let stopConnection: (() => void) | undefined;
  const retry = syncRetry();
  const channel =
    typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel('volleyball-scorekeeper')
      : undefined;
  function notify() {
    if (stopped) return;
    channel?.postMessage('changed');
    window.dispatchEvent(new Event('live-sync'));
  }
  async function wake() {
    if (stopped || !navigator.onLine || !retry.ready()) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        if (!(await readSnapshot(db)).syncQueue.length) {
          report('');
          break;
        }
        const transport = await import('./firebase');
        const sent = await flushQueue(db, transport, notify, () =>
          report('Updating live score…'),
        );
        if (stopped) break;
        if (!sent) {
          report('Saved here. Waiting for cloud backup…');
          break;
        }
        retry.reset();
        report('');
        again = (await readSnapshot(db)).syncQueue.length > 0;
      } while (again && !stopped && navigator.onLine);
    } catch (error) {
      if (!stopped) {
        console.error('Live score upload deferred', error);
        retry.fail();
        again = false;
        report(
          'Live upload pending. Saved on this device; retrying automatically.',
        );
      }
    } finally {
      running = false;
    }
  }
  const resume = () => {
    retry.reset();
    void wake();
  };
  const visible = () => {
    if (document.visibilityState === 'visible') void wake();
  };
  const timer = window.setInterval(() => void wake(), 10_000);
  window.addEventListener('online', resume);
  window.addEventListener('sync-retry', resume);
  window.addEventListener('live-auth-change', resume);
  window.addEventListener('library-sync', wake);
  document.addEventListener('visibilitychange', visible);
  if (channel) channel.onmessage = () => void wake();
  void import('./firebase')
    .then((api) => {
      if (stopped) return;
      stopConnection = api.watchConnection((value) => {
        const recovered = value && !connected;
        connected = value;
        if (recovered) resume();
      });
      void wake();
    })
    .catch(() => {
      if (!stopped)
        report(
          'Live upload pending. Saved on this device; retrying automatically.',
        );
    });
  return {
    wake,
    stop() {
      stopped = true;
      stopConnection?.();
      window.clearInterval(timer);
      window.removeEventListener('online', resume);
      window.removeEventListener('sync-retry', resume);
      window.removeEventListener('live-auth-change', resume);
      window.removeEventListener('library-sync', wake);
      document.removeEventListener('visibilitychange', visible);
      channel?.close();
    },
  };
}
