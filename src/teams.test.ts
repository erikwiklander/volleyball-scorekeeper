import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import {
  deleteTeam,
  emptySnapshot,
  saveAppearance,
  startSet,
  scoreAction,
} from './domain';
import { gameBackup, tournamentBackup, importBackup } from './export';
import { publicMatch } from './live/model';
import { openDatabase, mutate, readSnapshot } from './db';
it('team deletion persists while preserving game snapshots, live scores and importable backups', async () => {
  const db = await openDatabase('delete-team-' + crypto.randomUUID());
  const now = new Date().toISOString();
  let teamId = '';
  await mutate(db, (data) => {
    const home = saveAppearance(
      data,
      {
        name: 'Test team',
        primaryColor: '#123456',
        logo: 'data:image/png;base64,aGVsbG8=',
      },
      now,
    );
    teamId = home.teamId;
    const away = saveAppearance(
      data,
      { name: 'Keep me', primaryColor: '#654321' },
      now,
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
      createdAt: now,
      updatedAt: now,
    });
    data.tournaments.push({
      id: 't',
      name: 'Tournament',
      defaultTeamId: teamId,
      defaultTeamName: 'Test team',
      defaultTeamShortName: 'TEST',
      createdAt: now,
      updatedAt: now,
    });
    startSet(data, 'game', Date.now());
    scoreAction(data, 'game', data.sets[0].id, 'HOME_POINT', Date.now());
    data.broadcasts.push({
      id: 'game',
      publicId: 'live',
      ownerUid: 'owner',
      enabled: true,
      revision: 0,
      syncedRevision: 0,
    });
  });
  const before = await readSnapshot(db);
  await mutate(db, (data) => deleteTeam(data, teamId));
  const after = await readSnapshot(db);
  expect(after.teams.map((t) => t.name)).toEqual(['Keep me']);
  expect(after.matches).toEqual(before.matches);
  expect(after.events).toEqual(before.events);
  expect(after.syncQueue).toEqual(before.syncQueue);
  expect(publicMatch(after, 'game')).toEqual(publicMatch(before, 'game'));
  expect(after.tournaments[0].defaultTeamId).toBeUndefined();
  expect(after.tournaments[0].defaultTeamName).toBeUndefined();
  const restored = emptySnapshot();
  importBackup(JSON.parse(JSON.stringify(gameBackup(after, 'game'))), restored);
  expect(restored.matches[0].home?.logo).toBe(before.matches[0].home?.logo);
  expect(restored.teams.map((t) => t.name).sort()).toEqual([
    'Keep me',
    'Test team',
  ]);
  after.matches[0].tournamentId = 't';
  after.events.forEach((e) => (e.tournamentId = 't'));
  const tournamentRestored = emptySnapshot();
  importBackup(
    JSON.parse(JSON.stringify(tournamentBackup(after, 't'))),
    tournamentRestored,
  );
  expect(tournamentRestored.matches).toHaveLength(1);
  expect(() =>
    saveAppearance(
      after,
      { teamId, name: 'Test team', primaryColor: '#123456' },
      now,
    ),
  ).toThrow();
  expect(() => deleteTeam(after, teamId)).toThrow();
  db.close();
});
