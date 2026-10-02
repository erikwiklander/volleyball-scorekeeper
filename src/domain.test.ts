import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import {
  activePoints,
  calculateScore,
  completeMatch,
  emptySnapshot,
  endSet,
  orderedEvents,
  scoreAction,
  setScore,
  startSet,
  syncMarker,
  saveAppearance,
  matchResult,
  type Snapshot,
} from './domain';
import { gameBackup, importBackup, matchCsv, tournamentBackup } from './export';
import { mutate, openDatabase, readSnapshot } from './db';
let data: Snapshot;
const at = 1789258472183;
function fixture() {
  const d = emptySnapshot();
  const time = new Date(at).toISOString();
  d.tournaments.push({
    id: 't',
    name: 'Classic, "Austin"',
    createdAt: time,
    updatedAt: time,
  });
  d.matches.push({
    id: 'm',
    tournamentId: 't',
    homeTeam: 'Home, "A"',
    awayTeam: 'Away',
    status: 'not_started',
    createdAt: time,
    updatedAt: time,
  });
  return d;
}
beforeEach(() => {
  data = fixture();
  startSet(data, 'm', at);
});
const point = (
  action: 'HOME_POINT' | 'AWAY_POINT' | 'UNDO' | 'SYNC_MARKER',
  time = at,
) => scoreAction(data, 'm', data.sets.at(-1)!.id, action, time);
describe('scoring and immutable corrections', () => {
  it.each([
    ['HOME_POINT', 1, 0],
    ['AWAY_POINT', 0, 1],
  ] as const)('%s adds one point', (action, homeScore, awayScore) => {
    point(action);
    expect(calculateScore(data.events)).toEqual({ homeScore, awayScore });
  });
  it('repeated undo reverses latest active points and preserves history', () => {
    point('HOME_POINT');
    point('AWAY_POINT');
    point('AWAY_POINT');
    point('UNDO');
    point('UNDO');
    expect(calculateScore(data.events)).toEqual({ homeScore: 1, awayScore: 0 });
    point('UNDO');
    expect(calculateScore(data.events)).toEqual({ homeScore: 0, awayScore: 0 });
    expect(() => point('UNDO')).toThrow();
    point('AWAY_POINT');
    expect(activePoints(data.events)).toHaveLength(1);
    expect(data.events.filter((e) => e.action === 'UNDO')).toHaveLength(3);
    expect(data.events.filter((e) => e.action === 'HOME_POINT')).toHaveLength(
      1,
    );
  });
  it('keeps undo correct when the device clock moves backwards', () => {
    point('HOME_POINT', at + 1000);
    point('UNDO', at - 1000);
    expect(calculateScore(data.events).homeScore).toBe(0);
  });
  it('retains milliseconds and resolves timestamp ties by sequence', () => {
    point('HOME_POINT');
    point('AWAY_POINT');
    expect(data.events.at(-1)!.timestamp).toBe(new Date(at).toISOString());
    expect(data.events.at(-1)!.epochMs).toBe(at);
    expect(orderedEvents([...data.events].reverse())).toEqual(data.events);
  });
});
describe('sets and match lifecycle', () => {
  it('isolates set scores and assigns events to the correct set', () => {
    const first = data.sets[0].id;
    point('HOME_POINT');
    endSet(data, 'm', first, at);
    startSet(data, 'm', at);
    const second = data.sets[1].id;
    expect(setScore(data, second)).toEqual({ homeScore: 0, awayScore: 0 });
    point('AWAY_POINT');
    expect(setScore(data, first)).toEqual({ homeScore: 1, awayScore: 0 });
    expect(data.events.at(-1)!.setId).toBe(second);
    expect(data.events.at(-1)!.setNumber).toBe(2);
  });
  it('rejects duplicate starts, completed-set scoring and premature completion', () => {
    expect(() => startSet(data, 'm', at)).toThrow();
    expect(() => completeMatch(data, 'm', at)).toThrow();
    endSet(data, 'm', data.sets[0].id, at);
    expect(() => point('HOME_POINT')).toThrow();
    completeMatch(data, 'm', at);
    expect(data.matches[0].status).toBe('completed');
    expect(() => startSet(data, 'm', at)).toThrow();
  });
});
describe('exports and restore', () => {
  it('exports exact timestamps, escaped names, undo targets and sync markers', () => {
    point('HOME_POINT');
    const target = data.events.at(-1)!.id;
    point('UNDO');
    point('SYNC_MARKER');
    const csv = matchCsv(data, 'm');
    expect(csv).toContain('"Classic, ""Austin"""');
    expect(csv).toContain('"Home, ""A"""');
    expect(csv).toContain(new Date(at).toISOString());
    expect(csv).toContain(String(at));
    expect(csv).toContain('"UNDO"');
    expect(csv).toContain(`"${target}"`);
    expect(csv).toContain('"SYNC_MARKER"');
    expect(csv.split('\r\n')).toHaveLength(data.events.length + 2);
  });
  it('imports a full backup without overwriting and remaps undo references', () => {
    point('HOME_POINT');
    point('UNDO');
    const backup = tournamentBackup(data, 't');
    const importedId = importBackup(backup, data);
    expect(importedId).not.toBe('t');
    expect(data.tournaments).toHaveLength(2);
    const imported = data.events.filter((e) => e.tournamentId === importedId);
    expect(calculateScore(imported)).toEqual({ homeScore: 0, awayScore: 0 });
    expect(imported.find((e) => e.action === 'UNDO')?.targetEventId).toBe(
      imported.find((e) => e.action === 'HOME_POINT')?.id,
    );
  });
  it('rejects malformed backups and broken references without changes', () => {
    const before = structuredClone(data);
    expect(() => importBackup({}, data)).toThrow();
    const backup = tournamentBackup(data, 't');
    backup.events[0] = { ...backup.events[0], matchId: 'missing' };
    expect(() => importBackup(backup, data)).toThrow();
    expect(data).toEqual(before);
  });
});
describe('IndexedDB recovery and transactions', () => {
  it('restores active match, set and score after closing and reopening the database', async () => {
    const name = crypto.randomUUID();
    let db = await openDatabase(name);
    await mutate(db, (d) => Object.assign(d, data));
    await mutate(db, (d) =>
      scoreAction(d, 'm', d.sets[0].id, 'HOME_POINT', at),
    );
    db.close();
    db = await openDatabase(name);
    const restored = await readSnapshot(db);
    expect(restored.appState.activeMatchId).toBe('m');
    expect(restored.appState.activeSetId).toBe(restored.sets[0].id);
    expect(setScore(restored, restored.sets[0].id).homeScore).toBe(1);
    await mutate(db, (d) => {
      endSet(d, 'm', d.sets[0].id, at);
      completeMatch(d, 'm', at);
    });
    db.close();
    db = await openDatabase(name);
    expect((await readSnapshot(db)).matches[0].status).toBe('completed');
    db.close();
  });
  it('serializes simultaneous actions across connections without dropping points', async () => {
    const name = crypto.randomUUID();
    const a = await openDatabase(name);
    const b = await openDatabase(name);
    await mutate(a, (d) => Object.assign(d, data));
    await Promise.all([
      mutate(a, (d) => scoreAction(d, 'm', d.sets[0].id, 'HOME_POINT', at)),
      mutate(b, (d) => scoreAction(d, 'm', d.sets[0].id, 'AWAY_POINT', at)),
    ]);
    const restored = await readSnapshot(a);
    expect(calculateScore(restored.events)).toEqual({
      homeScore: 1,
      awayScore: 1,
    });
    expect(new Set(restored.events.map((e) => e.sequence)).size).toBe(
      restored.events.length,
    );
    a.close();
    b.close();
  });
  it('rolls back a failed write instead of presenting an unsaved point', async () => {
    const db = await openDatabase(crypto.randomUUID());
    await mutate(db, (d) => Object.assign(d, data));
    await expect(
      mutate(db, (d) => {
        scoreAction(d, 'm', d.sets[0].id, 'HOME_POINT', at);
        throw new Error('Storage failure');
      }),
    ).rejects.toThrow();
    expect(calculateScore((await readSnapshot(db)).events).homeScore).toBe(0);
    db.close();
  });
});

describe('numbered camera markers and team colors', () => {
  it('numbers markers across sets without changing scores, including legacy markers', () => {
    point('HOME_POINT');
    const first = syncMarker(data, 'm', at);
    expect(first.syncNumber).toBe(1);
    expect(first.homeScore).toBe(1);
    delete first.syncNumber; // An older backup has unnumbered markers.
    endSet(data, 'm', data.sets[0].id, at);
    expect(() => syncMarker(data, 'm', at)).toThrow();
    startSet(data, 'm', at);
    expect(syncMarker(data, 'm', at).syncNumber).toBe(2);
    const third = syncMarker(data, 'm', at);
    expect(third.syncNumber).toBe(3);
    expect(third.homeScore).toBe(0);
  });
  it('preserves colors and marker numbers in backups and supports old backups', () => {
    data.matches[0].homeColor = '#ffcc00';
    data.matches[0].awayColor = '#003399';
    syncMarker(data, 'm', at);
    const restored = emptySnapshot();
    importBackup(tournamentBackup(data, 't'), restored);
    expect(restored.matches[0].homeColor).toBe('#ffcc00');
    expect(
      restored.events.find((e) => e.action === 'SYNC_MARKER')?.syncNumber,
    ).toBe(1);
    expect(syncMarker(restored, restored.matches[0].id, at).syncNumber).toBe(2);
    const legacy = fixture();
    expect(() =>
      importBackup(tournamentBackup(legacy, 't'), emptySnapshot()),
    ).not.toThrow();
  });
  it('requires an active set for new syncs and rejects completed matches', () => {
    const pending = fixture();
    expect(() => syncMarker(pending, 'm', at)).toThrow();
    expect(pending.matches[0].status).toBe('not_started');
    endSet(data, 'm', data.sets[0].id, at);
    completeMatch(data, 'm', at);
    expect(() => syncMarker(data, 'm', at)).toThrow();
  });
});

describe('standalone games', () => {
  it('scores, syncs, exports and restores without any tournament record', () => {
    const standalone = fixture();
    standalone.tournaments = [];
    delete standalone.matches[0].tournamentId;
    startSet(standalone, 'm', at);
    scoreAction(standalone, 'm', standalone.sets[0].id, 'HOME_POINT', at);
    syncMarker(standalone, 'm', at);
    endSet(standalone, 'm', standalone.sets[0].id, at);
    completeMatch(standalone, 'm', at);
    const csv = matchCsv(standalone, 'm');
    expect(csv).toContain('HOME_POINT');
    expect(csv).toContain('SYNC_MARKER');
    expect(csv).not.toContain('undefined');
    const restored = emptySnapshot();
    const newId = importBackup(gameBackup(standalone, 'm'), restored);
    expect(restored.tournaments).toHaveLength(0);
    expect(restored.matches[0].id).toBe(newId);
    expect(restored.matches[0].tournamentId).toBeUndefined();
    expect(restored.matches[0].status).toBe('completed');
    expect(calculateScore(restored.events).homeScore).toBe(1);
  });
  it('rejects standalone backups with dangling tournament references', () => {
    const standalone = fixture();
    delete standalone.matches[0].tournamentId;
    const backup = gameBackup(standalone, 'm');
    backup.matches[0].tournamentId = 'missing';
    expect(() => importBackup(backup, emptySnapshot())).toThrow();
  });
});

describe('reusable teams and version 2 backups', () => {
  const logo = 'data:image/png;base64,aGVsbG8=';
  function appearance() {
    const home = saveAppearance(
      data,
      {
        name: 'Roots',
        shortName: 'ROOTS',
        primaryColor: '#008000',
        secondaryColor: '#ffffff',
        logo,
      },
      new Date(at).toISOString(),
    );
    Object.assign(data.matches[0], {
      home,
      homeTeam: home.displayName,
      homeColor: home.color,
    });
    data.tournaments[0].defaultTeamId = home.teamId;
    return home;
  }
  it('keeps match appearance independent of team edits and overrides', () => {
    const home = appearance();
    const override = saveAppearance(
      data,
      {
        ...data.teams[0],
        teamId: home.teamId,
        primaryColor: '#000000',
        name: 'Roots Green',
      },
      new Date(at).toISOString(),
    );
    expect(data.teams).toHaveLength(1);
    expect(data.teams[0].primaryColor).toBe('#008000');
    expect(override.color).toBe('#000000');
    data.teams[0].name = 'Renamed';
    data.teams[0].logo = undefined;
    expect(home.displayName).toBe('Roots');
    expect(home.logo).toBe(logo);
    expect(home.color).toBe('#008000');
  });
  it('round trips logos, defaults and appearances with remapped team references', () => {
    const home = appearance();
    const marker = syncMarker(data, 'm', at);
    marker.syncCue = 'black-white-black-v1';
    const backup = tournamentBackup(data, 't');
    expect(backup.schemaVersion).toBe(2);
    const restored = emptySnapshot();
    importBackup(backup, restored);
    expect(restored.teams[0].id).not.toBe(home.teamId);
    expect(restored.matches[0].home?.teamId).toBe(restored.teams[0].id);
    expect(restored.tournaments[0].defaultTeamId).toBe(restored.teams[0].id);
    expect(restored.matches[0].home?.logo).toBe(logo);
    expect(restored.teams[0].secondaryColor).toBe('#ffffff');
    expect(restored.events.at(-1)?.syncCue).toBe('black-white-black-v1');
    expect(restored.events.at(-1)?.setId).toBe(restored.sets[0].id);
  });
  it('rejects dangling team references atomically', () => {
    appearance();
    const backup = tournamentBackup(data, 't');
    backup.teams = [];
    const restored = emptySnapshot();
    expect(() => importBackup(backup, restored)).toThrow();
    expect(restored).toEqual(emptySnapshot());
  });
  it('still imports real version 1 backups including unattached legacy sync markers', () => {
    const pending = fixture();
    const backup = {
      ...tournamentBackup(pending, 't'),
      schemaVersion: 1,
      teams: undefined,
    };
    backup.events = [
      {
        id: 'old-sync',
        tournamentId: 't',
        matchId: 'm',
        timestamp: new Date(at).toISOString(),
        epochMs: at,
        sequence: 1,
        action: 'SYNC_MARKER',
        homeScore: 0,
        awayScore: 0,
      },
    ];
    const restored = emptySnapshot();
    importBackup(backup, restored);
    expect(restored.teams).toEqual([]);
    expect(restored.matches[0].homeTeam).toBe(pending.matches[0].homeTeam);
    expect(restored.events[0].setId).toBeUndefined();
  });
  it('preserves completed set results through team metadata changes', () => {
    appearance();
    point('HOME_POINT');
    endSet(data, 'm', data.sets[0].id, at);
    startSet(data, 'm', at);
    point('AWAY_POINT');
    point('AWAY_POINT');
    point('UNDO');
    endSet(data, 'm', data.sets[1].id, at);
    expect(matchResult(data, 'm')).toEqual({ home: 1, away: 1, tied: 0 });
    expect(setScore(data, data.sets[0].id)).toEqual({
      homeScore: 1,
      awayScore: 0,
    });
  });
  it('rejects a sync when another tab has changed the active set', () => {
    const first = data.sets[0].id;
    endSet(data, 'm', first, at);
    startSet(data, 'm', at);
    expect(() => syncMarker(data, 'm', at, first)).toThrow();
    expect(syncMarker(data, 'm', at, data.sets[1].id).setNumber).toBe(2);
  });
  it('upgrades a version 1 database without changing saved scores or events', async () => {
    const { openDB } = await import('idb');
    const name = crypto.randomUUID();
    const legacy = await openDB(name, 1, {
      upgrade(db) {
        for (const store of [
          'tournaments',
          'matches',
          'sets',
          'events',
          'appState',
        ])
          db.createObjectStore(store, { keyPath: 'id' });
      },
    });
    point('HOME_POINT');
    for (const store of ['tournaments', 'matches', 'sets', 'events'] as const) {
      for (const item of data[store]) await legacy.put(store, item);
    }
    await legacy.put('appState', data.appState);
    legacy.close();
    const upgraded = await openDatabase(name);
    const restored = await readSnapshot(upgraded);
    expect(restored).toEqual(data);
    await mutate(upgraded, (d) => {
      saveAppearance(
        d,
        { name: 'New team', primaryColor: '#008000' },
        new Date(at).toISOString(),
      );
    });
    expect((await readSnapshot(upgraded)).teams).toHaveLength(1);
    upgraded.close();
  });
});
