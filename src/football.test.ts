import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  calculateScore,
  completeMatch,
  emptySnapshot,
  endSet,
  footballScores,
  periodLabel,
  scoreAction,
  setScore,
  sportOf,
  startSet,
  type FootballScore,
} from './domain';
import { gameBackup, importBackup, matchCsv } from './export';
import { publicMatch, publicMatchSchema } from './live/model';
import { mutate, openDatabase, readSnapshot } from './db';
const at = Date.parse('2026-10-04T12:00:00.000Z');
function fixture() {
  const data = emptySnapshot();
  data.matches.push({
    id: 'football',
    sport: 'football',
    homeTeam: 'Home',
    awayTeam: 'Away',
    status: 'not_started',
    createdAt: new Date(at).toISOString(),
    updatedAt: new Date(at).toISOString(),
  });
  startSet(data, 'football', at);
  return data;
}
describe('Pop Warner football', () => {
  it.each(Object.keys(footballScores) as FootballScore[])(
    '%s awards the preset value and undo reverses the whole score',
    (type) => {
      const data = fixture();
      const quarter = data.sets[0].id;
      scoreAction(data, 'football', quarter, 'HOME_POINT', at + 1, type);
      expect(calculateScore(data.events)).toEqual({
        homeScore: footballScores[type].points,
        awayScore: 0,
      });
      scoreAction(data, 'football', quarter, 'UNDO', at - 1);
      expect(calculateScore(data.events)).toEqual({
        homeScore: 0,
        awayScore: 0,
      });
      expect(data.events.find((e) => e.scoringType === type)).toBeDefined();
    },
  );
  it('keeps cumulative totals across four quarters and overtime, with separate period scores', () => {
    const data = fixture();
    scoreAction(
      data,
      'football',
      data.sets[0].id,
      'HOME_POINT',
      at,
      'touchdown',
    );
    scoreAction(data, 'football', data.sets[0].id, 'HOME_POINT', at, 'kick');
    for (let n = 1; n <= 4; n++) {
      endSet(data, 'football', data.sets.at(-1)!.id, at);
      startSet(data, 'football', at);
    }
    expect(periodLabel('football', 5)).toBe('OT 1');
    scoreAction(
      data,
      'football',
      data.sets[4].id,
      'AWAY_POINT',
      at,
      'fieldGoal',
    );
    expect(setScore(data, data.sets[4].id)).toEqual({
      homeScore: 0,
      awayScore: 3,
    });
    expect(data.events.at(-1)).toMatchObject({ homeScore: 8, awayScore: 3 });
    endSet(data, 'football', data.sets[4].id, at);
    completeMatch(data, 'football', at);
    const shared = publicMatchSchema.parse(publicMatch(data, 'football'));
    expect(shared).toMatchObject({
      sport: 'football',
      currentSet: 5,
      status: 'completed',
      result: { home: 8, away: 3 },
    });
    expect(shared.sets.s1.homeScore).toBe(8);
    expect(shared.sets.s5.awayScore).toBe(3);
    expect(() =>
      scoreAction(
        data,
        'football',
        data.sets[4].id,
        'HOME_POINT',
        at,
        'touchdown',
      ),
    ).toThrow();
  });
  it('rejects missing scoring types and football scores in a volleyball match', () => {
    const data = fixture();
    expect(() =>
      scoreAction(data, 'football', data.sets[0].id, 'HOME_POINT', at),
    ).toThrow();
    delete data.matches[0].sport;
    expect(sportOf(data.matches[0])).toBe('volleyball');
    expect(() =>
      scoreAction(
        data,
        'football',
        data.sets[0].id,
        'HOME_POINT',
        at,
        'touchdown',
      ),
    ).toThrow();
    scoreAction(data, 'football', data.sets[0].id, 'HOME_POINT', at);
    expect(calculateScore(data.events).homeScore).toBe(1);
  });
  it('round-trips weighted scores and undo references in a version 3 backup', () => {
    const data = fixture();
    const quarter = data.sets[0].id;
    scoreAction(data, 'football', quarter, 'HOME_POINT', at, 'touchdown');
    scoreAction(data, 'football', quarter, 'HOME_POINT', at, 'kick');
    scoreAction(data, 'football', quarter, 'UNDO', at);
    const backup = gameBackup(data, 'football');
    expect(backup.schemaVersion).toBe(3);
    const imported = emptySnapshot();
    importBackup(JSON.parse(JSON.stringify(backup)), imported);
    expect(sportOf(imported.matches[0])).toBe('football');
    expect(calculateScore(imported.events)).toEqual({
      homeScore: 6,
      awayScore: 0,
    });
    expect(matchCsv(imported, imported.matches[0].id)).toContain(
      '"football","1","touchdown","6"',
    );
    const broken = structuredClone(backup);
    delete broken.events.find((e) => e.scoringType)!.scoringType;
    expect(() => importBackup(broken, emptySnapshot())).toThrow();
    expect(() =>
      importBackup({ ...backup, schemaVersion: 2 }, emptySnapshot()),
    ).toThrow();
  });
  it('persists offline scores and coalesces a football snapshot atomically', async () => {
    const db = await openDatabase('football-' + crypto.randomUUID());
    await mutate(db, (data) => {
      Object.assign(data, fixture());
      data.broadcasts.push({
        id: 'football',
        publicId: 'public',
        ownerUid: 'owner',
        enabled: true,
        revision: 0,
        syncedRevision: 0,
      });
    });
    await mutate(db, (data) =>
      scoreAction(
        data,
        'football',
        data.sets[0].id,
        'AWAY_POINT',
        at,
        'touchdown',
      ),
    );
    await mutate(db, (data) =>
      scoreAction(
        data,
        'football',
        data.sets[0].id,
        'AWAY_POINT',
        at,
        'conversion',
      ),
    );
    const saved = await readSnapshot(db);
    expect(calculateScore(saved.events).awayScore).toBe(7);
    expect(saved.syncQueue).toHaveLength(1);
    expect(saved.syncQueue[0].match).toMatchObject({
      sport: 'football',
      sets: { s1: { awayScore: 7 } },
    });
    db.close();
  });
});
