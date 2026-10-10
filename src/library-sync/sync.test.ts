import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { openDB } from 'idb';
import { mutate, openDatabase, readSnapshot } from '../db';
import {
  emptySnapshot,
  startSet,
  scoreAction,
  setScore,
  deleteMatch,
  id,
} from '../domain';
import { gameBackup, importBackup, tournamentBackup } from '../export';
import { adoptLocalTeams } from '../team-sync/model';
import {
  adoptLocalLibrary,
  applyLibraryRecord,
  canScoreGame,
  gameBundle,
  inLibrary,
  libraryLink,
  type LibraryEntry,
  type LibraryRecord,
} from './model';
import { flushLibraryQueue } from './queue';
import { flushQueue } from '../live/queue';
const time = '2026-10-10T12:00:00.000Z';
function game(matchId = id(), tournamentId?: string) {
  return {
    id: matchId,
    tournamentId,
    homeTeam: 'Eagles',
    awayTeam: 'Falcons',
    homeColor: '#123456',
    awayColor: '#654321',
    status: 'not_started' as const,
    createdAt: time,
    updatedAt: time,
  };
}
function record(
  entry: LibraryEntry,
  deviceId: string,
  revision = entry.revision + 1,
): LibraryRecord {
  return {
    schemaVersion: 1,
    revision,
    mutationId: entry.mutationId,
    deviceId,
    deleted: entry.payload === null,
    updatedAt: Date.now(),
    ...(entry.payload ? { payload: entry.payload } : {}),
    scorerDeviceId: entry.scorerDeviceId,
    scorerEpoch: entry.scorerEpoch,
  };
}
async function fixture(live = false) {
  const name = id(),
    db = await openDatabase(name),
    match = game();
  await mutate(db, (d) => {
    d.matches.push(match);
    if (live)
      d.broadcasts.push({
        id: match.id,
        publicId: id(),
        ownerUid: 'owner',
        enabled: true,
        revision: 1,
        syncedRevision: 1,
      });
    adoptLocalTeams(d, 'owner');
    adoptLocalLibrary(d, 'owner');
  });
  const uploaded = (await readSnapshot(db)).libraryQueue.find(
    (e) => e.kind === 'games',
  )!;
  const remote = record(uploaded, (await readSnapshot(db)).teamSync.deviceId);
  await mutate(
    db,
    (d) => applyLibraryRecord(d, 'games', match.id, 'owner', remote),
    { queueLibrary: false, queueLive: false },
  );
  return { name, db, match, remote };
}
it('upgrades version 4 in place and keeps scoring data unbound until sign-in', async () => {
  const name = id(),
    match = game();
  const old = await openDB(name, 4, {
    upgrade(db) {
      for (const s of [
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
      ])
        db.createObjectStore(s, { keyPath: 'id' });
    },
  });
  await old.put('matches', match);
  old.close();
  const db = await openDatabase(name);
  const data = await readSnapshot(db);
  expect(data.matches).toEqual([match]);
  expect(data.libraryLinks).toEqual([]);
  expect(data.libraryQueue).toEqual([]);
  db.close();
});
it('adopts existing games once, keeps link ownership and separates all account histories', async () => {
  const d = emptySnapshot(),
    match = game();
  d.matches.push(match);
  d.teamSync.deviceId = id();
  d.broadcasts.push({
    id: match.id,
    publicId: id(),
    ownerUid: 'original',
    enabled: true,
    revision: 1,
    syncedRevision: 1,
  });
  adoptLocalTeams(d, 'other');
  adoptLocalLibrary(d, 'other');
  adoptLocalLibrary(d, 'other');
  expect(d.libraryQueue).toHaveLength(1);
  expect(libraryLink(d, 'games', match.id)?.ownerUid).toBe('original');
  expect(inLibrary(d, 'games', match.id)).toBe(false);
  adoptLocalTeams(d, 'original');
  expect(inLibrary(d, 'games', match.id)).toBe(true);
});
it('queues an entire offline history atomically, survives reopening and retains failed uploads', async () => {
  const { db, name, match } = await fixture();
  await mutate(db, (d) => startSet(d, match.id, Date.parse(time)));
  let s = (await readSnapshot(db)).sets[0];
  await mutate(db, (d) =>
    scoreAction(d, match.id, s.id, 'HOME_POINT', Date.parse(time) + 1),
  );
  await mutate(db, (d) =>
    scoreAction(d, match.id, s.id, 'UNDO', Date.parse(time) + 2),
  );
  db.close();
  const reopened = await openDatabase(name),
    before = await readSnapshot(reopened);
  expect(before.libraryQueue).toHaveLength(1);
  expect(JSON.parse(before.libraryQueue[0].payload!).events).toHaveLength(4);
  await expect(
    flushLibraryQueue(
      reopened,
      'owner',
      {
        publishLibrary: async () => {
          throw new Error('offline');
        },
      },
      () => {},
      () => true,
    ),
  ).rejects.toThrow('offline');
  expect((await readSnapshot(reopened)).libraryQueue).toEqual(
    before.libraryQueue,
  );
  await flushLibraryQueue(
    reopened,
    'owner',
    { publishLibrary: async (e, device) => record(e, device) },
    () => {},
    () => true,
  );
  expect((await readSnapshot(reopened)).libraryQueue).toHaveLength(0);
  reopened.close();
});
it('an older acknowledgement preserves points added while its upload is in flight', async () => {
  const { db, match } = await fixture();
  await mutate(db, (d) => startSet(d, match.id, Date.parse(time)));
  const before = await readSnapshot(db),
    entry = before.libraryQueue[0],
    s = before.sets[0];
  await mutate(db, (d) =>
    scoreAction(d, match.id, s.id, 'AWAY_POINT', Date.parse(time) + 1),
  );
  await mutate(
    db,
    (d) =>
      applyLibraryRecord(
        d,
        'games',
        match.id,
        'owner',
        record(entry, before.teamSync.deviceId),
      ),
    { queueLibrary: false, queueLive: false },
  );
  const after = await readSnapshot(db);
  expect(setScore(after, s.id).awayScore).toBe(1);
  expect(after.libraryQueue[0].revision).toBe(2);
  db.close();
});
it('remote takeover fences the old device and saves its unsynced points and undo references in a new game', async () => {
  const { db, match, remote } = await fixture(true);
  await mutate(db, (d) => startSet(d, match.id, Date.parse(time)));
  const s = (await readSnapshot(db)).sets[0];
  await mutate(db, (d) =>
    scoreAction(d, match.id, s.id, 'HOME_POINT', Date.parse(time) + 1),
  );
  await mutate(db, (d) =>
    scoreAction(d, match.id, s.id, 'UNDO', Date.parse(time) + 2),
  );
  const takeover = {
    ...remote,
    revision: 2,
    mutationId: id(),
    deviceId: id(),
    scorerDeviceId: id(),
    scorerEpoch: 2,
  };
  await mutate(
    db,
    (d) => applyLibraryRecord(d, 'games', match.id, 'owner', takeover),
    { queueLibrary: false, queueLive: false },
  );
  const after = await readSnapshot(db),
    copy = after.matches.find((m) => m.id !== match.id)!;
  expect(canScoreGame(after, match.id)).toBe(false);
  expect(copy.homeTeam).toContain('saved copy');
  expect(after.events.filter((e) => e.matchId === copy.id)).toHaveLength(4);
  expect(after.broadcasts.some((b) => b.id === copy.id)).toBe(false);
  expect(after.syncQueue.some((e) => e.matchId === match.id)).toBe(false);
  const restored = emptySnapshot();
  importBackup(gameBackup(after, copy.id), restored);
  expect(restored.events).toHaveLength(4);
  await expect(
    mutate(db, (d) => startSet(d, match.id, Date.parse(time) + 3)),
  ).rejects.toThrow('Another device');
  db.close();
});
it('cloud updates replace the full history and restore active-set references without echo uploads', async () => {
  const { db, match, remote } = await fixture();
  const other = emptySnapshot();
  other.matches.push(match);
  startSet(other, match.id, Date.parse(time));
  const s = other.sets[0];
  scoreAction(other, match.id, s.id, 'HOME_POINT', Date.parse(time) + 1);
  const next = {
    ...remote,
    revision: 2,
    mutationId: id(),
    deviceId: id(),
    payload: JSON.stringify(gameBundle(other, match.id)),
  };
  await mutate(
    db,
    (d) => {
      d.appState = { id: 'current', activeMatchId: match.id };
      applyLibraryRecord(d, 'games', match.id, 'owner', next);
    },
    { queueLibrary: false, queueLive: false },
  );
  const after = await readSnapshot(db);
  expect(after.appState.activeSetId).toBe(s.id);
  expect(setScore(after, s.id).homeScore).toBe(1);
  expect(after.libraryQueue).toHaveLength(0);
  await mutate(
    db,
    (d) => applyLibraryRecord(d, 'games', match.id, 'owner', remote),
    { queueLibrary: false, queueLive: false },
  );
  expect((await readSnapshot(db)).events).toHaveLength(3);
  db.close();
});
it('private deletion keeps a pending public stop until it is uploaded, including repeated cloud snapshots', async () => {
  const { db, match } = await fixture(true);
  await mutate(db, (d) => deleteMatch(d, match.id));
  const before = await readSnapshot(db),
    entry = before.libraryQueue[0],
    deleted = record(entry, before.teamSync.deviceId);
  for (let i = 0; i < 2; i++)
    await mutate(
      db,
      (d) => applyLibraryRecord(d, 'games', match.id, 'owner', deleted),
      { queueLibrary: false, queueLive: false },
    );
  const after = await readSnapshot(db);
  expect(after.syncQueue[0].match).toBeNull();
  expect(after.matches).toHaveLength(0);
  let publicStopped = false;
  await flushQueue(db, {
    publish: async (entry) => {
      publicStopped = entry.match === null;
    },
  });
  expect(publicStopped).toBe(true);
  expect((await readSnapshot(db)).syncQueue).toHaveLength(0);
  db.close();
});
it('private upload must complete before public publication; repeated cloud snapshots keep a pending public score', async () => {
  const { db, match } = await fixture(true);
  await mutate(db, (d) => startSet(d, match.id, Date.parse(time)));
  let sent = 0;
  await flushQueue(db, {
    publish: async () => {
      sent++;
    },
  });
  expect(sent).toBe(0);
  const state = await readSnapshot(db),
    entry = state.libraryQueue[0],
    remote = record(entry, state.teamSync.deviceId);
  for (let i = 0; i < 2; i++)
    await mutate(
      db,
      (d) => applyLibraryRecord(d, 'games', match.id, 'owner', remote),
      { queueLibrary: false, queueLive: false },
    );
  await flushQueue(db, {
    publish: async (e) => {
      expect(e.scorerEpoch).toBe(1);
      sent++;
    },
  });
  expect(sent).toBe(1);
  db.close();
});
it('account changes guard cached records and do not acknowledge an in-flight old-account upload', async () => {
  const { db, match } = await fixture();
  await mutate(db, (d) => startSet(d, match.id, Date.parse(time)));
  let current = true;
  await flushLibraryQueue(
    db,
    'owner',
    {
      publishLibrary: async (e, device) => {
        current = false;
        return record(e, device);
      },
    },
    () => {},
    () => current,
  );
  expect((await readSnapshot(db)).libraryQueue).toHaveLength(1);
  await mutate(db, (d) => {
    adoptLocalTeams(d, 'other');
    adoptLocalLibrary(d, 'other');
  });
  expect(inLibrary(await readSnapshot(db), 'games', match.id)).toBe(false);
  await expect(mutate(db, (d) => deleteMatch(d, match.id))).rejects.toThrow(
    'account changed',
  );
  db.close();
});
it('tournament backups accept game-local event sequences from different scoring devices', () => {
  const d = emptySnapshot(),
    t = { id: id(), name: 'Cup', createdAt: time, updatedAt: time };
  d.tournaments.push(t);
  for (let i = 0; i < 2; i++) {
    const one = emptySnapshot(),
      m = game(id(), t.id);
    one.matches.push(m);
    startSet(one, m.id, Date.parse(time));
    d.matches.push(...one.matches);
    d.sets.push(...one.sets);
    d.events.push(...one.events);
  }
  const restored = emptySnapshot();
  importBackup(tournamentBackup(d, t.id), restored);
  expect(restored.events).toHaveLength(4);
});
it('a game whose tournament was deleted remains exportable as a self-contained standalone game', () => {
  const d = emptySnapshot(),
    match = game(id(), id());
  d.matches.push(match);
  startSet(d, match.id, Date.parse(time));
  const backup = gameBackup(d, match.id),
    restored = emptySnapshot();
  expect(backup.matches[0].tournamentId).toBeUndefined();
  expect(backup.events[0].tournamentId).toBeUndefined();
  importBackup(backup, restored);
  expect(restored.events).toHaveLength(2);
  expect(restored.matches[0].tournamentId).toBeUndefined();
});
it('a pending offline deletion cannot delete a game after another device takes over', async () => {
  const { db, match, remote } = await fixture(true);
  await mutate(db, (d) => deleteMatch(d, match.id));
  const deviceB = id(),
    takeover = {
      ...remote,
      revision: 2,
      mutationId: id(),
      deviceId: deviceB,
      scorerDeviceId: deviceB,
      scorerEpoch: 2,
    };
  await mutate(
    db,
    (d) => applyLibraryRecord(d, 'games', match.id, 'owner', takeover),
    { queueLibrary: false, queueLive: false },
  );
  const after = await readSnapshot(db);
  expect(after.matches[0].id).toBe(match.id);
  expect(after.libraryQueue).toHaveLength(0);
  expect(after.syncQueue).toHaveLength(0);
  expect(canScoreGame(after, match.id)).toBe(false);
  expect(after.teamSync.libraryNotice).toContain('deletion was cancelled');
  db.close();
});
it('public flushing never rebinds a removed stale snapshot to a new scorer epoch', async () => {
  const { db, match } = await fixture(true),
    second = game();
  await mutate(db, (d) => {
    d.matches.push(second);
    d.broadcasts.push({
      id: second.id,
      publicId: id(),
      ownerUid: 'owner',
      enabled: true,
      revision: 0,
      syncedRevision: 0,
    });
  });
  await flushLibraryQueue(
    db,
    'owner',
    { publishLibrary: async (e, device) => record(e, device) },
    () => {},
    () => true,
  );
  const firstId = (await readSnapshot(db)).syncQueue[0].matchId;
  const revokedId = firstId === match.id ? second.id : match.id;
  let uploads = 0;
  await flushQueue(db, {
    publish: async (entry) => {
      uploads++;
      if (entry.matchId === firstId)
        await mutate(
          db,
          (d) => {
            libraryLink(d, 'games', revokedId)!.scorerEpoch!++;
            d.syncQueue = d.syncQueue.filter((e) => e.matchId !== revokedId);
          },
          { queueLibrary: false, queueLive: false },
        );
    },
  });
  expect(uploads).toBe(1);
  db.close();
});
