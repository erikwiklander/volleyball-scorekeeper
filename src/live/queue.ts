import type { IDBPDatabase } from 'idb';
import { mutate, readSnapshot } from '../db';
import type { SyncEntry } from './model';
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
  for (const entry of entries) {
    await transport.publish(entry);
    await mutate(db, (data) => {
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
    });
    sent++;
    onSaved();
  }
  return sent;
}
