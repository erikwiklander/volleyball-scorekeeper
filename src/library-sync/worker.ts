import { syncRetry } from '../syncRetry';
import type { IDBPDatabase } from 'idb';
import { mutate, readSnapshot } from '../db';
import { liveConfig } from '../live/config';
import {
  adoptLocalLibrary,
  applyLibraryRecord,
  libraryRecordsSchema,
  type LibraryKind,
} from './model';
import { flushLibraryQueue } from './queue';

type Status = {
  phase: 'local' | 'connecting' | 'pending' | 'syncing' | 'synced' | 'error';
  message: string;
  ownerUid?: string;
  ready: boolean;
};
let status: Status = {
  phase: 'local',
  message: 'Games and tournaments are saved on this device.',
  ready: false,
};
const listeners = new Set<() => void>();
export const getLibraryStatus = () => status;
export const subscribeLibrary = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function report(
  phase: Status['phase'],
  message: string,
  ownerUid?: string,
  ready = false,
) {
  if (
    status.phase === phase &&
    status.message === message &&
    status.ownerUid === ownerUid &&
    status.ready === ready
  )
    return;
  status = { phase, message, ownerUid, ready };
  listeners.forEach((listener) => listener());
}
export function startLibraryWorker(db: IDBPDatabase) {
  if (!liveConfig()) return { wake() {}, stop() {} };
  let stopped = false,
    generation = 0,
    connected = false,
    running = false,
    again = false;
  let ownerUid: string | undefined;
  let api: typeof import('../live/firebase') | undefined;
  let stopAuth: (() => void) | undefined,
    stopConnection: (() => void) | undefined;
  let stopRemote: (() => void)[] = [];
  const ready = new Set<LibraryKind>();
  const backoff = syncRetry();
  const channel =
    typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel('volleyball-scorekeeper')
      : undefined;
  const notify = () => {
    if (stopped) return;
    channel?.postMessage('changed');
    window.dispatchEvent(new Event('library-sync'));
  };
  async function wake() {
    if (stopped || !ownerUid || !api || !backoff.ready()) return;
    if (running) {
      again = true;
      return;
    }
    const uid = ownerUid,
      currentGeneration = generation;
    const isCurrent = () => !stopped && generation === currentGeneration;
    running = true;
    try {
      do {
        again = false;
        if (!isCurrent()) break;
        if (!navigator.onLine || !connected) {
          report(
            'pending',
            'Games and tournaments are saved here. Sync resumes when connected.',
            uid,
            ready.size === 2,
          );
          break;
        }
        if (ready.size !== 2) break;
        if (
          (await readSnapshot(db)).libraryQueue.some((e) => e.ownerUid === uid)
        ) {
          report('syncing', 'Backing up games and tournaments…', uid, true);
          const advanced = await flushLibraryQueue(
            db,
            uid,
            {
              publishLibrary: (entry, deviceId) =>
                api!.publishLibrary(entry, deviceId),
            },
            notify,
            isCurrent,
          );
          if (!advanced) {
            again = false;
            break;
          }
          backoff.reset();
        }
        if (!isCurrent()) break;
        again = (await readSnapshot(db)).libraryQueue.some(
          (e) => e.ownerUid === uid,
        );
        if (!again)
          report('synced', 'Games and tournaments are synced.', uid, true);
      } while (again && isCurrent());
    } catch {
      if (isCurrent()) {
        backoff.fail();
        again = false;
        report(
          'error',
          'Cloud backup is pending. Your games are safe on this device.',
          uid,
          ready.size === 2,
        );
      }
    } finally {
      running = false;
      if (again && !stopped && backoff.ready()) void wake();
    }
  }
  async function bind(uid?: string) {
    backoff.reset();
    const currentGeneration = ++generation;
    const isCurrent = () => !stopped && generation === currentGeneration;
    stopRemote.forEach((stop) => stop());
    stopRemote = [];
    ready.clear();
    ownerUid = uid;
    if (!uid || !api) {
      report(
        'local',
        'Games and tournaments are saved here. Sign in to sync.',
        undefined,
        false,
      );
      return;
    }
    report('connecting', 'Connecting your games and tournaments…', uid, false);
    try {
      await mutate(
        db,
        (data) => {
          if (!isCurrent()) return;
          if (data.teamSync.ownerUid !== uid) {
            delete data.teamSync.libraryNotice;
            delete data.teamSync.conflict;
          }
          data.teamSync.ownerUid = uid;
          adoptLocalLibrary(data, uid);
        },
        { queueLibrary: false, queueTeams: false },
      );
      if (!isCurrent()) return;
      notify();
      let pull = Promise.resolve();
      for (const kind of ['tournaments', 'games'] as const) {
        stopRemote.push(
          api.watchLibrary(
            uid,
            kind,
            (value) => {
              pull = pull
                .then(async () => {
                  if (!isCurrent()) return;
                  const records = libraryRecordsSchema.parse(value);
                  await mutate(
                    db,
                    (data) => {
                      if (!isCurrent() || data.teamSync.ownerUid !== uid)
                        return;
                      for (const [recordId, remote] of Object.entries(records))
                        applyLibraryRecord(data, kind, recordId, uid, remote);
                    },
                    {
                      queueLibrary: false,
                      queueLive: false,
                      queueTeams: false,
                    },
                  );
                  if (!isCurrent()) return;
                  ready.add(kind);
                  notify();
                  void wake();
                })
                .catch(() => {
                  if (isCurrent()) {
                    ready.delete(kind);
                    report(
                      'error',
                      'Could not read cloud history. Your local games are safe.',
                      uid,
                      false,
                    );
                  }
                });
            },
            () => {
              if (isCurrent()) {
                ready.delete(kind);
                report(
                  'error',
                  'Could not connect to cloud history. Your local games are safe.',
                  uid,
                  false,
                );
              }
            },
          ),
        );
      }
    } catch {
      if (isCurrent())
        report(
          'error',
          'Could not prepare cloud backup. Your local games are safe.',
          uid,
          false,
        );
    }
  }
  async function initialize() {
    try {
      api = await import('../live/firebase');
      if (stopped) return;
      stopConnection = api.watchConnection((value) => {
        const recovered = value && !connected;
        connected = value;
        if (recovered) backoff.reset();
        if (recovered && ownerUid && ready.size !== 2) void bind(ownerUid);
        else void wake();
      });
      stopAuth = api.watchPublisher(
        (user) =>
          void bind(
            user &&
              !user.isAnonymous &&
              user.providerData.some((p) => p.providerId === 'google.com')
              ? user.uid
              : undefined,
          ),
      );
    } catch {
      if (!stopped)
        report(
          'error',
          'Cloud backup could not load. Your local games are safe.',
          undefined,
          false,
        );
    }
  }
  const retry = () => {
    backoff.reset();
    if (api) void bind(ownerUid);
    else void initialize();
  };
  const visible = () => {
    if (document.visibilityState === 'visible') void wake();
  };
  const timer = window.setInterval(() => void wake(), 10_000);
  const online = () => {
    backoff.reset();
    if (ownerUid && ready.size !== 2) retry();
    else void wake();
  };
  window.addEventListener('online', online);
  window.addEventListener('sync-retry', retry);
  window.addEventListener('library-retry', retry);
  document.addEventListener('visibilitychange', visible);
  if (channel) channel.onmessage = () => void wake();
  void initialize();
  return {
    wake,
    stop() {
      stopped = true;
      generation++;
      stopAuth?.();
      stopConnection?.();
      stopRemote.forEach((stop) => stop());
      window.clearInterval(timer);
      window.removeEventListener('online', online);
      window.removeEventListener('sync-retry', retry);
      window.removeEventListener('library-retry', retry);
      document.removeEventListener('visibilitychange', visible);
      channel?.close();
    },
  };
}
