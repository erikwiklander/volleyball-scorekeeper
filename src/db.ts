import { openDB, type IDBPDatabase } from 'idb';
import { emptySnapshot, type Snapshot } from './domain';
const stores = [
  'teams',
  'tournaments',
  'matches',
  'sets',
  'events',
  'appState',
] as const;
export function openDatabase(name = 'volleyball-scorekeeper') {
  return openDB(name, 2, {
    upgrade(db, oldVersion) {
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
  const [teams, tournaments, matches, sets, events, state] = await Promise.all(
    stores.map((s) => tx.objectStore(s).getAll()),
  );
  await tx.done;
  return {
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
): Promise<Snapshot> {
  const tx = db.transaction([...stores], 'readwrite', { durability: 'strict' });
  try {
    const [teams, tournaments, matches, sets, events, state] =
      await Promise.all(stores.map((s) => tx.objectStore(s).getAll()));
    const data: Snapshot = {
      teams,
      tournaments,
      matches,
      sets,
      events,
      appState: state[0] ?? emptySnapshot().appState,
    };
    const before = structuredClone(data);
    change(data);
    for (const name of [
      'teams',
      'tournaments',
      'matches',
      'sets',
      'events',
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
