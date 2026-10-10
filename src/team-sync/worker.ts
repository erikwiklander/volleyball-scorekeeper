import type { IDBPDatabase } from 'idb';
import { mutate, readSnapshot } from '../db';
import { liveConfig } from '../live/config';
import { adoptLocalTeams, applyCloudTeam, cloudTeamsSchema } from './model';
import { flushTeamQueue } from './queue';

type Status = {
  phase: 'local' | 'connecting' | 'syncing' | 'synced' | 'pending' | 'error';
  message: string;
};
let status: Status = {
  phase: 'local',
  message: 'Teams are saved on this device.',
};
const listeners = new Set<() => void>();
export const getTeamSyncStatus = () => status;
export const subscribeTeamSync = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function report(phase: Status['phase'], message: string) {
  if (status.phase === phase && status.message === message) return;
  status = { phase, message };
  listeners.forEach((listener) => listener());
}
function bounded<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error('Team sync timed out.')),
      20_000,
    );
    promise.then(resolve, reject).finally(() => window.clearTimeout(timer));
  });
}
export function startTeamWorker(db: IDBPDatabase) {
  if (!liveConfig()) return { wake() {}, stop() {} };
  let stopped = false;
  let generation = 0;
  let ownerUid: string | undefined;
  let ready = false;
  let connected = false;
  let running = false;
  let again = false;
  let api: typeof import('../live/firebase') | undefined;
  let stopAuth: (() => void) | undefined;
  let stopConnection: (() => void) | undefined;
  let stopRemote: (() => void) | undefined;
  const channel =
    typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel('volleyball-scorekeeper')
      : undefined;
  const notify = () => {
    if (stopped) return;
    channel?.postMessage('changed');
    window.dispatchEvent(new Event('team-sync'));
  };
  async function wake() {
    if (stopped || !ownerUid || !api) return;
    if (running) {
      again = true;
      return;
    }
    const uid = ownerUid;
    const currentGeneration = generation;
    const isCurrent = () => !stopped && generation === currentGeneration;
    running = true;
    try {
      do {
        again = false;
        const data = await readSnapshot(db);
        if (!isCurrent()) break;
        const pending = data.teamQueue.some((entry) => entry.ownerUid === uid);
        if (!navigator.onLine || !connected) {
          report(
            'pending',
            'Teams are saved here. Sync resumes when connected.',
          );
          break;
        }
        if (!ready) break; // Pull cloud deletions and revisions before uploading.
        if (!pending) {
          report('synced', 'Teams are synced.');
          break;
        }
        report('syncing', 'Syncing teams…');
        await flushTeamQueue(
          db,
          uid,
          {
            publishTeam: (entry, deviceId) =>
              bounded(api!.publishTeam(entry, deviceId)),
          },
          notify,
          isCurrent,
        );
        if (!isCurrent()) break;
        again = (await readSnapshot(db)).teamQueue.some(
          (entry) => entry.ownerUid === uid,
        );
      } while (again && !stopped);
      if (
        isCurrent() &&
        ready &&
        navigator.onLine &&
        connected &&
        !(await readSnapshot(db)).teamQueue.some(
          (entry) => entry.ownerUid === uid,
        )
      )
        report('synced', 'Teams are synced.');
    } catch {
      if (isCurrent())
        report(
          'error',
          'Team sync is pending. Your teams are saved on this device.',
        );
    } finally {
      running = false;
      if (again && !stopped) void wake();
    }
  }
  async function bind(uid?: string) {
    const currentGeneration = ++generation;
    const isCurrent = () => !stopped && generation === currentGeneration;
    stopRemote?.();
    stopRemote = undefined;
    ownerUid = uid;
    ready = false;
    if (!uid || !api) {
      report('local', 'Teams are saved on this device. Sign in to sync.');
      return;
    }
    report('connecting', 'Connecting your team library…');
    try {
      await mutate(
        db,
        (data) => {
          if (isCurrent()) adoptLocalTeams(data, uid);
        },
        { queueTeams: false },
      );
      if (!isCurrent()) return;
      notify();
      let pull = Promise.resolve();
      stopRemote = api.watchTeams(
        uid,
        (value) => {
          pull = pull
            .then(async () => {
              if (!isCurrent()) return;
              const records = cloudTeamsSchema.parse(value);
              await mutate(
                db,
                (data) => {
                  if (!isCurrent()) return;
                  for (const [id, record] of Object.entries(records))
                    applyCloudTeam(data, uid, id, record);
                },
                { queueTeams: false },
              );
              if (!isCurrent()) return;
              ready = true;
              notify();
              void wake();
            })
            .catch(() => {
              if (isCurrent()) {
                ready = false;
                report(
                  'error',
                  'Could not read your cloud team library. Your local teams are safe.',
                );
              }
            });
        },
        () => {
          if (isCurrent()) {
            ready = false;
            report(
              'error',
              'Could not connect to your cloud team library. Your local teams are safe.',
            );
          }
        },
      );
      void wake();
    } catch {
      if (isCurrent())
        report(
          'error',
          'Could not prepare team sync. Your local teams are safe.',
        );
    }
  }
  async function initialize() {
    try {
      api = await import('../live/firebase');
      if (stopped) return;
      stopConnection = api.watchConnection((value) => {
        connected = value;
        void wake();
      });
      stopAuth = api.watchPublisher((user) => {
        const uid =
          user &&
          !user.isAnonymous &&
          user.providerData.some(
            (provider) => provider.providerId === 'google.com',
          )
            ? user.uid
            : undefined;
        void bind(uid);
      });
    } catch {
      if (!stopped)
        report(
          'error',
          'Team sign-in could not load. Your local teams are safe.',
        );
    }
  }
  const retry = () => {
    if (api) void bind(ownerUid);
    else void initialize();
  };
  const visible = () => {
    if (document.visibilityState === 'visible') void wake();
  };
  const timer = window.setInterval(() => void wake(), 10_000);
  window.addEventListener('online', wake);
  window.addEventListener('team-sync-retry', retry);
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
      stopRemote?.();
      window.clearInterval(timer);
      window.removeEventListener('online', wake);
      window.removeEventListener('team-sync-retry', retry);
      document.removeEventListener('visibilitychange', visible);
      channel?.close();
    },
  };
}
