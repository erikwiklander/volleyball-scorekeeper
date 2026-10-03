import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { openDatabase, mutate, readSnapshot } from '../db';
import {
  startSet,
  scoreAction,
  endSet,
  completeMatch,
  deleteMatch,
  type Snapshot,
} from '../domain';
import { flushQueue } from './queue';
import { publicBroadcastSchema } from './model';
async function fixture() {
  const name = crypto.randomUUID();
  const db = await openDatabase(name);
  await mutate(db, (d) => {
    d.matches.push({
      id: 'm',
      homeTeam: 'Eagles',
      awayTeam: 'Falcons',
      status: 'not_started',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    startSet(d, 'm', Date.now());
    d.broadcasts.push({
      id: 'm',
      publicId: 'public',
      ownerUid: 'owner',
      enabled: true,
      revision: 0,
      syncedRevision: 0,
    });
  });
  return { db, name };
}
const point = (
  d: Snapshot,
  action: 'HOME_POINT' | 'AWAY_POINT' | 'UNDO' = 'HOME_POINT',
) => scoreAction(d, 'm', d.sets.at(-1)!.id, action, Date.now());
it('stores scores and a coalesced upload atomically, surviving restart and failed send', async () => {
  let { db, name } = await fixture();
  await mutate(db, (d) => {
    point(d);
    point(d, 'AWAY_POINT');
    point(d, 'UNDO');
  });
  await expect(
    mutate(db, (d) => {
      point(d);
      throw Error('disk failure');
    }),
  ).rejects.toThrow();
  db.close();
  db = await openDatabase(name);
  const saved = await readSnapshot(db);
  expect(saved.syncQueue).toHaveLength(1);
  expect(saved.syncQueue[0].revision).toBe(2);
  expect(saved.syncQueue[0].match?.sets.s1).toMatchObject({
    homeScore: 1,
    awayScore: 0,
  });
  await expect(
    flushQueue(db, {
      publish: async () => {
        throw Error('offline');
      },
    }),
  ).rejects.toThrow();
  expect((await readSnapshot(db)).syncQueue).toEqual(saved.syncQueue);
  db.close();
});
it('keeps a newer queued score when an older in-flight score is acknowledged', async () => {
  const { db } = await fixture();
  await flushQueue(db, {
    publish: async () => {
      await mutate(db, (d) => point(d));
    },
  });
  const state = await readSnapshot(db);
  expect(state.broadcasts[0].syncedRevision).toBe(1);
  expect(state.syncQueue[0].revision).toBe(2);
  expect(state.syncQueue[0].match?.sets.s1.homeScore).toBe(1);
  await flushQueue(db, { publish: async () => {} });
  expect((await readSnapshot(db)).syncQueue).toHaveLength(0);
  db.close();
});
it('publishes final set results and omits navigation-only changes', async () => {
  const { db } = await fixture();
  await mutate(db, (d) => {
    point(d);
    endSet(d, 'm', d.sets[0].id, Date.now());
    startSet(d, 'm', Date.now());
    point(d, 'AWAY_POINT');
    endSet(d, 'm', d.sets[1].id, Date.now());
    completeMatch(d, 'm', Date.now());
  });
  const entry = (await readSnapshot(db)).syncQueue[0];
  expect(entry.match?.result).toEqual({ home: 1, away: 1, tied: 0 });
  expect(entry.match?.status).toBe('completed');
  expect(
    publicBroadcastSchema.safeParse({
      schemaVersion: 1,
      ownerUid: 'owner',
      revision: entry.revision,
      published: true,
      updatedAt: Date.now(),
      match: entry.match,
    }).success,
  ).toBe(true);
  await mutate(db, (d) => {
    d.appState = { id: 'current' };
  });
  expect((await readSnapshot(db)).syncQueue[0].revision).toBe(entry.revision);
  db.close();
});
it('queues withdrawal on stop or deletion, and reuses increasing revisions on restart', async () => {
  const { db } = await fixture();
  await mutate(db, (d) => {
    d.broadcasts[0].enabled = false;
  });
  expect((await readSnapshot(db)).syncQueue[0]).toMatchObject({
    revision: 2,
    match: null,
  });
  await mutate(db, (d) => {
    d.broadcasts[0].enabled = true;
  });
  expect((await readSnapshot(db)).syncQueue[0]).toMatchObject({
    id: 'public',
    revision: 3,
  });
  await mutate(db, (d) => deleteMatch(d, 'm'));
  expect((await readSnapshot(db)).syncQueue[0]).toMatchObject({
    revision: 4,
    match: null,
  });
  await flushQueue(db, { publish: async () => {} });
  expect((await readSnapshot(db)).syncQueue).toEqual([]);
  db.close();
});
