import type { IDBPDatabase } from 'idb';
import { mutate, readSnapshot } from '../db';
import {
  applyCloudTeam,
  type CloudTeamRecord,
  type TeamQueueEntry,
} from './model';
export interface TeamTransport {
  publishTeam(
    entry: TeamQueueEntry,
    deviceId: string,
  ): Promise<CloudTeamRecord>;
}
export async function flushTeamQueue(
  db: IDBPDatabase,
  ownerUid: string,
  transport: TeamTransport,
  notify: () => void = () => {},
  isCurrent: () => boolean = () => true,
) {
  const entries = (await readSnapshot(db)).teamQueue.filter(
    (entry) => entry.ownerUid === ownerUid,
  );
  for (const queued of entries) {
    if (!isCurrent()) break;
    const state = await readSnapshot(db);
    if (state.teamSync.ownerUid !== ownerUid) break;
    const entry = state.teamQueue.find((entry) => entry.id === queued.id);
    if (!entry || entry.ownerUid !== ownerUid) continue;
    const remote = await transport.publishTeam(entry, state.teamSync.deviceId);
    if (!isCurrent()) break;
    await mutate(
      db,
      (data) => {
        if (isCurrent()) applyCloudTeam(data, ownerUid, entry.id, remote);
      },
      { queueTeams: false },
    );
    notify();
  }
}
