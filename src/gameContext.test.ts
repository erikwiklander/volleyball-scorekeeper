import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import {
  emptySnapshot,
  setGameContext,
  startSet,
  endSet,
  completeMatch,
  scoreAction,
  MAX_GAME_CONTEXT_LENGTH,
} from './domain';
import { gameBackup, importBackup } from './export';
import { mutate, openDatabase, readSnapshot } from './db';
import { adoptLocalTeams } from './team-sync/model';
import { adoptLocalLibrary } from './library-sync/model';
const at = Date.parse('2026-10-23T12:00:00Z');
function fixture() {
  const d = emptySnapshot();
  d.matches.push({
    id: 'game',
    homeTeam: 'Roots',
    awayTeam: 'Skyline',
    status: 'not_started',
    createdAt: new Date(at).toISOString(),
    updatedAt: new Date(at).toISOString(),
  });
  return d;
}
it('context stays editable before and during play, clears cleanly, and locks at completion', () => {
  const d = fixture();
  setGameContext(d, 'game', 'First game for Roots.', at);
  startSet(d, 'game', at + 1);
  setGameContext(d, 'game', 'Season opener.', at + 2);
  scoreAction(d, 'game', d.sets[0].id, 'HOME_POINT', at + 3);
  endSet(d, 'game', d.sets[0].id, at + 4);
  completeMatch(d, 'game', at + 5);
  expect(() => setGameContext(d, 'game', 'Too late', at + 6)).toThrow('locked');
  expect(d.matches[0].recapContext).toBe('Season opener.');
  const fresh = fixture();
  setGameContext(fresh, 'game', 'Note', at);
  setGameContext(fresh, 'game', '   ', at);
  expect(fresh.matches[0].recapContext).toBeUndefined();
  expect(() =>
    setGameContext(fresh, 'game', 'x'.repeat(MAX_GAME_CONTEXT_LENGTH + 1), at),
  ).toThrow('1000');
});
it('game backups round-trip context and old backups still import without it', () => {
  const d = fixture();
  setGameContext(d, 'game', 'Last game of the season.', at);
  const copy = emptySnapshot();
  importBackup(gameBackup(d, 'game'), copy);
  expect(copy.matches[0].recapContext).toBe('Last game of the season.');
  const older = fixture(),
    restored = emptySnapshot();
  importBackup(gameBackup(older, 'game'), restored);
  expect(restored.matches[0].recapContext).toBeUndefined();
  const malformed = gameBackup(d, 'game');
  malformed.matches[0].recapContext = 'x'.repeat(1001);
  expect(() => importBackup(malformed, emptySnapshot())).toThrow();
});
it('context edits queue a private backup without changing the public score or history', async () => {
  const db = await openDatabase(crypto.randomUUID());
  await mutate(db, (d) => {
    d.matches.push(...fixture().matches);
    d.broadcasts.push({
      id: 'game',
      publicId: crypto.randomUUID(),
      ownerUid: 'owner',
      enabled: true,
      revision: 0,
      syncedRevision: 0,
    });
    adoptLocalTeams(d, 'owner');
    adoptLocalLibrary(d, 'owner');
  });
  const before = await readSnapshot(db);
  await mutate(db, (d) =>
    setGameContext(d, 'game', 'A school season finale.', at + 1),
  );
  const after = await readSnapshot(db);
  expect(after.syncQueue).toEqual(before.syncQueue);
  expect(after.events).toEqual(before.events);
  expect(JSON.parse(after.libraryQueue[0].payload!).match.recapContext).toBe(
    'A school season finale.',
  );
  db.close();
});
