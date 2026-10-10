import type { IDBPDatabase } from 'idb';
import { readSnapshot } from '../db';
import { liveConfig } from './config';
import { flushQueue } from './queue';
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
  status = message;
  listeners.forEach((listener) => listener());
}
export function startLiveWorker(db: IDBPDatabase) {
  if (!liveConfig()) return { wake() {}, stop() {} };
  let stopped = false;
  let running = false;
  let again = false;
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
    if (stopped || !navigator.onLine) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        if (!(await readSnapshot(db)).syncQueue.length) break;
        report('Updating live score…');
        const transport = await import('./firebase');
        const sent = await flushQueue(db, transport, notify);
        report('');
        if (!sent) break;
        again = (await readSnapshot(db)).syncQueue.length > 0;
      } while (again && !stopped && navigator.onLine);
    } catch (error) {
      console.error('Live score upload deferred', error);
      report(
        'Live upload pending. Saved on this device; retrying when connected.',
      );
    } finally {
      running = false;
    }
  }
  const timer = window.setInterval(() => void wake(), 10_000);
  const visible = () => {
    if (document.visibilityState === 'visible') void wake();
  };
  window.addEventListener('online', wake);
  window.addEventListener('live-auth-change', wake);
  document.addEventListener('visibilitychange', visible);
  if (channel) channel.onmessage = wake;
  void wake();
  return {
    wake,
    stop() {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener('online', wake);
      window.removeEventListener('live-auth-change', wake);
      document.removeEventListener('visibilitychange', visible);
      channel?.close();
    },
  };
}
