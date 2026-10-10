import { queueBroadcastChanges } from './live/model';
import { queueTeamChanges } from './team-sync/model';
import { openDB, type IDBPDatabase } from 'idb';
import { emptySnapshot, type Snapshot } from './domain';
const stores = [
  'broadcasts',
  'syncQueue',
  'teams',
  'tournaments',
  'matches',
  'sets',
  'events',
  'appState',
  'teamLinks',
  'teamQueue',
  'teamSync',
] as const;
export function openDatabase(name = 'volleyball-scorekeeper') {
  return openDB(name, 4, {
    blocked() {
      if (typeof window !== 'undefined')
        window.dispatchEvent(new Event('storage-upgrade-blocked'));
    },
    blocking(_currentVersion, _blockedVersion, event) {
      (event.target as IDBDatabase).close();
      if (typeof window !== 'undefined')
        window.dispatchEvent(new Event('storage-upgrade-required'));
    },
    upgrade(db, oldVersion) {
      if (oldVersion < 4) {
        db.createObjectStore('teamLinks', { keyPath: 'id' });
        db.createObjectStore('teamQueue', { keyPath: 'id' });
        db.createObjectStore('teamSync', { keyPath: 'id' });
      }
      if (oldVersion < 3) {
        db.createObjectStore('broadcasts', { keyPath: 'id' });
        db.createObjectStore('syncQueue', { keyPath: 'id' });
      }
      if (oldVersion < 2) db.createObjectStore('teams', { keyPath: 'id' });
      if (oldVersion >= 1) return;
      db.createObjectStore('tournaments', { keyPath: 'id' });
      db.createObjectStore('matches', { keyPath: 'id' }).createIndex(
        'tournamentId',
        'tournamentId',
      );
      db.createObjectStore('sets', { keyPath: 'id' }).createIndex(
        'matchId',
        'matchId',
      );
      const events = db.createObjectStore('events', { keyPath: 'id' });
      for (const key of ['matchId', 'setId', 'timestamp', 'epochMs'])
        events.createIndex(key, key);
      db.createObjectStore('appState', { keyPath: 'id' });
    },
  });
}
export async function readSnapshot(db: IDBPDatabase): Promise<Snapshot> {
  const tx = db.transaction([...stores], 'readonly');
  const [
    broadcasts,
    syncQueue,
    teams,
    tournaments,
    matches,
    sets,
    events,
    state,
    teamLinks,
    teamQueue,
    teamState,
  ] = await Promise.all(stores.map((s) => tx.objectStore(s).getAll()));
  await tx.done;
  return {
    teamLinks,
    teamQueue,
    teamSync: teamState[0] ?? emptySnapshot().teamSync,
    broadcasts,
    syncQueue,
    teams,
    tournaments,
    matches,
    sets,
    events,
    appState: state[0] ?? emptySnapshot().appState,
  };
}
// Read and write in one serialized transaction, including across tabs. Events
// use add(), never put(): existing history cannot be accidentally rewritten.
export async function mutate(
  db: IDBPDatabase,
  change: (data: Snapshot) => void,
  options: { queueTeams?: boolean } = {},
): Promise<Snapshot> {
  const tx = db.transaction([...stores], 'readwrite', { durability: 'strict' });
  try {
    const [
      broadcasts,
      syncQueue,
      teams,
      tournaments,
      matches,
      sets,
      events,
      state,
      teamLinks,
      teamQueue,
      teamState,
    ] = await Promise.all(stores.map((s) => tx.objectStore(s).getAll()));
    const data: Snapshot = {
      teamLinks,
      teamQueue,
      teamSync: teamState[0] ?? emptySnapshot().teamSync,
      broadcasts,
      syncQueue,
      teams,
      tournaments,
      matches,
      sets,
      events,
      appState: state[0] ?? emptySnapshot().appState,
    };
    const before = structuredClone(data);
    change(data);
    queueBroadcastChanges(before, data);
    if (options.queueTeams !== false) queueTeamChanges(before, data);
    for (const name of [
      'broadcasts',
      'syncQueue',
      'teams',
      'tournaments',
      'matches',
      'sets',
      'events',
      'teamLinks',
      'teamQueue',
    ] as const) {
      const old = new Map(before[name].map((item) => [item.id, item]));
      const remaining = new Set(data[name].map((item) => item.id));
      for (const item of before[name])
        if (!remaining.has(item.id)) await tx.objectStore(name).delete(item.id);
      for (const item of data[name]) {
        if (!old.has(item.id)) await tx.objectStore(name).add(item);
        else if (JSON.stringify(item) !== JSON.stringify(old.get(item.id))) {
          if (name === 'events')
            throw new Error('Existing scoring events cannot be modified.');
          await tx.objectStore(name).put(item);
        }
      }
    }
    await tx.objectStore('appState').put(data.appState);
    await tx.objectStore('teamSync').put(data.teamSync);
    await tx.done;
    return data;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* Already aborted. */
    }
    await tx.done.catch(() => {});
    throw error;
  }
}
