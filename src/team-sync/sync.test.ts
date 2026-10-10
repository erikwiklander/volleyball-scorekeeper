import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { openDB } from 'idb';
import { openDatabase, mutate, readSnapshot } from '../db';
import {
  deleteTeam,
  emptySnapshot,
  saveAppearance,
  type Team,
} from '../domain';
import { gameBackup, importBackup } from '../export';
import {
  adoptLocalTeams,
  applyCloudTeam,
  normalizedTeam,
  teamLibrary,
  type CloudTeamRecord,
  type TeamQueueEntry,
} from './model';
import { flushTeamQueue } from './queue';
const time = '2026-10-10T12:00:00.000Z';
const team = (): Team => ({
  id: crypto.randomUUID(),
  name: 'Eagles',
  primaryColor: '#123456',
  createdAt: time,
  updatedAt: time,
});
function record(
  entry: TeamQueueEntry,
  deviceId: string,
  revision = entry.baseRevision + 1,
): CloudTeamRecord {
  return {
    schemaVersion: 1,
    revision,
    mutationId: entry.mutationId,
    deviceId,
    deleted: !entry.team,
    updatedAt: Date.now(),
    ...(entry.team ? { team: normalizedTeam(entry.team) } : {}),
  };
}
async function fixture() {
  const name = crypto.randomUUID();
  const db = await openDatabase(name);
  const savedTeam = team();
  await mutate(db, (data) => {
    data.teams.push(savedTeam);
    adoptLocalTeams(data, 'owner');
  });
  return { db, name, savedTeam };
}
it('version 3 migration retains teams, games and events without assigning a cloud account', async () => {
  const name = crypto.randomUUID();
  const original = team();
  const legacy = await openDB(name, 3, {
    upgrade(db) {
      for (const store of [
        'broadcasts',
        'syncQueue',
        'teams',
        'tournaments',
        'matches',
        'sets',
        'events',
        'appState',
      ])
        db.createObjectStore(store, { keyPath: 'id' });
    },
  });
  await legacy.put('teams', original);
  await legacy.put('matches', {
    id: 'old-game',
    homeTeam: 'Eagles',
    awayTeam: 'Falcons',
    status: 'not_started',
    createdAt: time,
    updatedAt: time,
  });
  legacy.close();
  const db = await openDatabase(name);
  const data = await readSnapshot(db);
  expect(data.teams).toEqual([original]);
  expect(data.matches[0].id).toBe('old-game');
  expect(data.teamQueue).toEqual([]);
  expect(data.teamLinks).toEqual([]);
  expect(data.teamSync.ownerUid).toBeUndefined();
  db.close();
});
it('unbound teams remain local; first sign-in queues them once and another account cannot adopt them', async () => {
  const db = await openDatabase(crypto.randomUUID());
  await mutate(db, (data) => {
    data.teams.push(team());
  });
  expect((await readSnapshot(db)).teamQueue).toHaveLength(0);
  await mutate(db, (data) => adoptLocalTeams(data, 'first'));
  await mutate(db, (data) => adoptLocalTeams(data, 'first'));
  let data = await readSnapshot(db);
  expect(data.teamQueue).toHaveLength(1);
  await mutate(db, (data) => {
    data.teamSync.conflict = 'Private first-account notice';
  });
  await mutate(db, (data) => adoptLocalTeams(data, 'second'));
  data = await readSnapshot(db);
  expect(teamLibrary(data)).toEqual([]);
  expect(data.teamSync.conflict).toBeUndefined();
  expect(data.teamQueue[0].ownerUid).toBe('first');
  let sent = false;
  await flushTeamQueue(db, 'second', {
    publishTeam: async () => {
      sent = true;
      throw Error();
    },
  });
  expect(sent).toBe(false);
  await expect(
    mutate(db, (data) => {
      data.teams[0].name = 'Wrong account';
    }),
  ).rejects.toThrow('account changed');
  db.close();
});
it('offline edits coalesce, survive reopen, and failed uploads leave the queue intact', async () => {
  let { db, name, savedTeam } = await fixture();
  await mutate(db, (data) => {
    data.teams[0].name = 'Edited';
  });
  await mutate(db, (data) => {
    data.teams[0].primaryColor = '#abcdef';
  });
  db.close();
  db = await openDatabase(name);
  const data = await readSnapshot(db);
  expect(data.teamQueue).toHaveLength(1);
  expect(data.teamQueue[0].team).toMatchObject({
    id: savedTeam.id,
    name: 'Edited',
    primaryColor: '#abcdef',
  });
  await expect(
    flushTeamQueue(db, 'owner', {
      publishTeam: async () => {
        throw Error('offline');
      },
    }),
  ).rejects.toThrow();
  expect((await readSnapshot(db)).teamQueue).toEqual(data.teamQueue);
  db.close();
});
it('an old in-flight acknowledgement preserves and rebases a newer local edit', async () => {
  const { db } = await fixture();
  await flushTeamQueue(db, 'owner', {
    publishTeam: async (entry, deviceId) => {
      await mutate(db, (data) => {
        data.teams[0].name = 'Newer edit';
      });
      return record(entry, deviceId);
    },
  });
  let data = await readSnapshot(db);
  expect(data.teams[0].name).toBe('Newer edit');
  expect(data.teamQueue[0].baseRevision).toBe(1);
  await flushTeamQueue(db, 'owner', {
    publishTeam: async (entry, deviceId) => record(entry, deviceId),
  });
  data = await readSnapshot(db);
  expect(data.teamQueue).toHaveLength(0);
  expect(data.teamLinks[0].remoteRevision).toBe(2);
  db.close();
});
it('a later remote edit or deletion keeps unsynced local edits as a new copy', async () => {
  for (const deleted of [false, true]) {
    const { db, savedTeam } = await fixture();
    await mutate(db, (data) => {
      data.teams[0].name = 'Offline edit';
    });
    await mutate(
      db,
      (data) =>
        applyCloudTeam(data, 'owner', savedTeam.id, {
          schemaVersion: 1,
          revision: 1,
          deviceId: crypto.randomUUID(),
          mutationId: crypto.randomUUID(),
          deleted,
          updatedAt: 1,
          ...(deleted
            ? {}
            : { team: normalizedTeam({ ...savedTeam, name: 'Other device' }) }),
        }),
      { queueTeams: false },
    );
    const data = await readSnapshot(db);
    const copy = data.teams.find(
      (team) => team.name === 'Offline edit (saved copy)',
    )!;
    expect(copy.id).not.toBe(savedTeam.id);
    expect(data.teamQueue.map((entry) => entry.id)).toEqual([copy.id]);
    expect(data.teamSync.conflict).toContain('unsynced edits');
    expect(data.teams.some((team) => team.id === savedTeam.id)).toBe(!deleted);
    db.close();
  }
});
it('remote deletion clears tournament defaults and leaves existing games and backups intact', async () => {
  const { db, savedTeam } = await fixture();
  await flushTeamQueue(db, 'owner', {
    publishTeam: async (entry, deviceId) => record(entry, deviceId),
  });
  await mutate(db, (data) => {
    const home = saveAppearance(
      data,
      { ...savedTeam, teamId: savedTeam.id },
      time,
    );
    const away = saveAppearance(
      data,
      { name: 'Falcons', primaryColor: '#654321' },
      time,
    );
    data.matches.push({
      id: 'game',
      home,
      away,
      homeTeam: home.displayName,
      awayTeam: away.displayName,
      homeColor: home.color,
      awayColor: away.color,
      status: 'not_started',
      createdAt: time,
      updatedAt: time,
    });
    data.tournaments.push({
      id: 'tournament',
      name: 'Cup',
      defaultTeamId: savedTeam.id,
      defaultTeamName: savedTeam.name,
      createdAt: time,
      updatedAt: time,
    });
  });
  const before = await readSnapshot(db);
  const remote = {
    schemaVersion: 1 as const,
    revision: 2,
    deviceId: crypto.randomUUID(),
    mutationId: crypto.randomUUID(),
    deleted: true,
    updatedAt: 2,
  };
  await mutate(
    db,
    (data) => applyCloudTeam(data, 'owner', savedTeam.id, remote),
    { queueTeams: false },
  );
  const after = await readSnapshot(db);
  expect(after.matches).toEqual(before.matches);
  expect(after.tournaments[0].defaultTeamId).toBeUndefined();
  const backup = gameBackup(after, 'game');
  expect(JSON.stringify(backup)).not.toContain('ownerUid');
  expect(JSON.stringify(backup)).not.toContain('teamLinks');
  const restored = emptySnapshot();
  importBackup(backup, restored);
  expect(restored.teams.some((team) => team.name === 'Eagles')).toBe(true);
  expect(restored.teamLinks).toEqual([]);
  // Replayed older snapshots cannot resurrect the deleted library record.
  await mutate(
    db,
    (data) =>
      applyCloudTeam(data, 'owner', savedTeam.id, {
        ...remote,
        revision: 1,
        deleted: false,
        team: normalizedTeam(savedTeam),
      }),
    { queueTeams: false },
  );
  expect(
    (await readSnapshot(db)).teams.some((team) => team.id === savedTeam.id),
  ).toBe(false);
  db.close();
});
it('an offline delete is retried against the latest cloud revision without restoring the team', async () => {
  const { db, savedTeam } = await fixture();
  await flushTeamQueue(db, 'owner', {
    publishTeam: async (entry, deviceId) => record(entry, deviceId),
  });
  await mutate(db, (data) => deleteTeam(data, savedTeam.id));
  await flushTeamQueue(db, 'owner', {
    publishTeam: async (entry) => ({
      ...record(entry, crypto.randomUUID(), 2),
      mutationId: crypto.randomUUID(),
      deleted: false,
      team: normalizedTeam(savedTeam),
    }),
  });
  let data = await readSnapshot(db);
  expect(data.teams).toEqual([]);
  expect(data.teamQueue[0]).toMatchObject({ baseRevision: 2, team: null });
  await flushTeamQueue(db, 'owner', {
    publishTeam: async (entry, deviceId) => record(entry, deviceId),
  });
  data = await readSnapshot(db);
  expect(data.teamQueue).toEqual([]);
  expect(data.teamLinks[0].remoteRevision).toBe(3);
  db.close();
});
it('signing out during an upload does not acknowledge or leak the old account’s queue', async () => {
  const { db } = await fixture();
  let current = true;
  await flushTeamQueue(
    db,
    'owner',
    {
      publishTeam: async (entry, deviceId) => {
        current = false;
        return record(entry, deviceId);
      },
    },
    () => {},
    () => current,
  );
  expect((await readSnapshot(db)).teamQueue).toHaveLength(1);
  db.close();
});
it('remote optional field removal is reflected in the cached team', async () => {
  const { db, savedTeam } = await fixture();
  await mutate(db, (data) => {
    data.teams[0].secondaryColor = '#ffffff';
  });
  await flushTeamQueue(db, 'owner', {
    publishTeam: async (entry, deviceId) => record(entry, deviceId),
  });
  await mutate(
    db,
    (data) =>
      applyCloudTeam(data, 'owner', savedTeam.id, {
        schemaVersion: 1,
        revision: 2,
        mutationId: crypto.randomUUID(),
        deviceId: crypto.randomUUID(),
        deleted: false,
        team: normalizedTeam(savedTeam),
        updatedAt: 2,
      }),
    { queueTeams: false },
  );
  expect((await readSnapshot(db)).teams[0].secondaryColor).toBeUndefined();
  db.close();
});
