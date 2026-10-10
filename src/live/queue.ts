import type { IDBPDatabase } from 'idb';
import { mutate, readSnapshot } from '../db';
import type { SyncEntry } from './model';
import { libraryLink, canScoreGame } from '../library-sync/model';
export interface LiveTransport {
  publish(entry: SyncEntry): Promise<void>;
}

// Revisions protect against old in-flight uploads, including writes by another tab.
export async function flushQueue(
  db: IDBPDatabase,
  transport: LiveTransport,
  onSaved: () => void = () => {},
) {
  let sent = 0;
  const entries = (await readSnapshot(db)).syncQueue;
  for (let entry of entries) {
    const state = await readSnapshot(db);
    const current = state.syncQueue.find((queued) => queued.id === entry.id);
    if (!current) continue;
    entry = current;
    const link = libraryLink(state, 'games', entry.matchId);
    if (link) {
      if (
        !canScoreGame(state, entry.matchId) ||
        entry.scorerDeviceId !== link.scorerDeviceId ||
        entry.scorerEpoch !== link.scorerEpoch ||
        state.libraryQueue.some((e) => e.id === link.id)
      )
        continue;
    }
    await transport.publish(entry);
    await mutate(
      db,
      (data) => {
        data.syncQueue = data.syncQueue.filter(
          (current) =>
            current.id !== entry.id || current.revision !== entry.revision,
        );
        const broadcast = data.broadcasts.find((b) => b.publicId === entry.id);
        if (broadcast)
          broadcast.syncedRevision = Math.max(
            broadcast.syncedRevision,
            entry.revision,
          );
      },
      { queueLibrary: false, queueLive: false },
    );
    sent++;
    onSaved();
  }
  return sent;
}
