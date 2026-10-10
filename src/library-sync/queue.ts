import type { IDBPDatabase } from 'idb';
import { mutate, readSnapshot } from '../db';
import {
  applyLibraryRecord,
  type LibraryEntry,
  type LibraryRecord,
} from './model';
export interface LibraryTransport {
  publishLibrary(entry: LibraryEntry, deviceId: string): Promise<LibraryRecord>;
}
export async function flushLibraryQueue(
  db: IDBPDatabase,
  ownerUid: string,
  api: LibraryTransport,
  notify: () => void,
  isCurrent: () => boolean,
) {
  const entries = (await readSnapshot(db)).libraryQueue.filter(
    (e) => e.ownerUid === ownerUid,
  );
  for (const queued of entries) {
    if (!isCurrent()) break;
    const state = await readSnapshot(db);
    if (state.teamSync.ownerUid !== ownerUid) break;
    const entry = state.libraryQueue.find((e) => e.id === queued.id);
    if (!entry || entry.ownerUid !== ownerUid) continue;
    const remote = await api.publishLibrary(entry, state.teamSync.deviceId);
    if (!isCurrent()) break;
    await mutate(
      db,
      (data) => {
        if (isCurrent() && data.teamSync.ownerUid === ownerUid)
          applyLibraryRecord(
            data,
            entry.kind,
            entry.recordId,
            ownerUid,
            remote,
          );
      },
      { queueLibrary: false, queueLive: false, queueTeams: false },
    );
    notify();
  }
}
