import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gameFacts,
  generateRecap,
  createRecapProcessor,
  mirrorPublicRecap,
} from './recap.js';
function record(id = 'game', sequence = 'AAHHHH', extra = {}) {
  return {
    payload: JSON.stringify({
      match: {
        id,
        homeTeam: 'Eagles',
        awayTeam: 'Falcons',
        status: 'completed',
        completedAt: 'today',
        ...extra,
      },
      sets: [{ id: 'set', matchId: id, setNumber: 1, completedAt: 'today' }],
      events: [...sequence].map((p, i) => ({
        id: `point${i}`,
        matchId: id,
        setId: 'set',
        sequence: i,
        action: p === 'H' ? 'HOME_POINT' : 'AWAY_POINT',
      })),
      broadcast: { enabled: true, ownerUid: 'owner', publicId: 'public' },
    }),
  };
}
function fakeDb() {
  const values = new Map();
  return {
    values,
    ref: (path) => ({
      get: async () => ({ val: () => values.get(path) ?? null }),
      transaction: async (fn) => {
        const value = fn(values.get(path) ?? null);
        if (value === undefined) return { committed: false };
        values.set(path, value);
        return { committed: true };
      },
      set: async (value) => values.set(path, value),
      remove: async () => values.delete(path),
      update: async (patch) => {
        const next = { ...values.get(path), ...patch };
        for (const k in next) if (next[k] === null) delete next[k];
        values.set(path, next);
      },
    }),
  };
}
test('recap facts reconstruct comeback, scoring runs and final score without undone points', () => {
  const rec = record();
  const game = JSON.parse(rec.payload);
  game.events.push({
    id: 'undo',
    matchId: 'game',
    setId: 'set',
    sequence: 6,
    action: 'UNDO',
    targetEventId: 'point5',
  });
  rec.payload = JSON.stringify(game);
  const parsed = gameFacts(rec, 'game');
  assert.deepEqual(parsed.facts.result, { home: 1, away: 0 });
  assert.deepEqual(parsed.facts.periods[0], {
    number: 1,
    home: 3,
    away: 2,
    largestHomeLead: 1,
    largestAwayLead: 2,
    longestHomeScoringRun: 3,
    longestAwayScoringRun: 2,
    leadChanges: 1,
  });
  assert.equal(
    gameFacts(record('game', 'H', { status: 'in_progress' }), 'game'),
    undefined,
  );
  assert.equal(gameFacts({ ...rec, deleted: true }, 'game'), undefined);
  assert.equal(gameFacts(rec, 'wrong'), undefined);
});
test('provider receives only bounded facts, no response storage, with a short plain recap', async () => {
  let payload;
  const text = await generateRecap(
    gameFacts(record(), 'game').facts,
    'test-key',
    async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      payload = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          status: 'completed',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [
                {
                  type: 'output_text',
                  text: 'Eagles came back from 0–2 to win the set 4–2.',
                },
              ],
            },
          ],
        }),
      };
    },
  );
  assert.ok(text.includes('4–2'));
  assert.equal(payload.store, false);
  assert.equal(payload.max_output_tokens, 200);
  assert.ok(!payload.input.includes('completedAt'));
  assert.ok(!payload.input.includes('ownerUid'));
  await assert.rejects(
    generateRecap({}, 'test-key', async () => ({ ok: false })),
    /unavailable/,
  );
  await assert.rejects(
    generateRecap({}, 'test-key', async () => ({
      ok: true,
      json: async () => ({ status: 'incomplete' }),
    })),
    /Incomplete/,
  );
});
test('duplicate completion delivery calls the model once; result changes invalidate cached recap', async () => {
  const db = fakeDb();
  db.values.set('users/owner/games/game', record());
  let calls = 0;
  const run = createRecapProcessor({
    database: db,
    generate: async () => {
      calls++;
      return 'Eagles won 1–0 in sets.';
    },
  });
  await Promise.all([
    run({ uid: 'owner', gameId: 'game' }),
    run({ uid: 'owner', gameId: 'game' }),
  ]);
  await run({ uid: 'owner', gameId: 'game' });
  assert.equal(calls, 1);
  assert.equal(db.values.get('recaps/owner/game').status, 'ready');
  db.values.set('users/owner/games/game', record('game', 'HHHHHH'));
  await run({ uid: 'owner', gameId: 'game' });
  assert.equal(calls, 1);
  assert.equal(db.values.get('recaps/owner/game').text, undefined);
});
test('per-account and global daily caps and provider failures cannot trigger repeat spending', async () => {
  for (const budget of [
    { day: '2026-10-13', total: 20, users: { owner: 20 } },
    { day: '2026-10-13', total: 100, users: {} },
  ]) {
    const db = fakeDb();
    db.values.set('users/owner/games/game', record());
    db.values.set('recapBudget', budget);
    let calls = 0;
    const run = createRecapProcessor({
      database: db,
      generate: async () => {
        calls++;
        return 'recap';
      },
      now: () => Date.parse('2026-10-13'),
    });
    await run({ uid: 'owner', gameId: 'game' });
    assert.equal(calls, 0);
    assert.equal(db.values.get('recaps/owner/game').status, 'limited');
  }
  const db = fakeDb();
  db.values.set('users/owner/games/game', record());
  let calls = 0;
  const run = createRecapProcessor({
    database: db,
    generate: async () => {
      calls++;
      throw new Error('expired key');
    },
  });
  await run({ uid: 'owner', gameId: 'game' });
  await run({ uid: 'owner', gameId: 'game' });
  assert.equal(calls, 1);
  assert.equal(db.values.get('recaps/owner/game').status, 'failed');
});
test('sharing mirrors only matching completed results and removes recap when sharing stops', async () => {
  const db = fakeDb(),
    rec = record();
  db.values.set('users/owner/games/game', rec);
  const parsed = gameFacts(rec, 'game');
  db.values.set('recaps/owner/game', {
    ...parsed,
    status: 'ready',
    text: 'Eagles won 1–0.',
  });
  const broadcast = {
    published: true,
    ownerUid: 'owner',
    gameId: 'game',
    match: {
      status: 'completed',
      home: { name: 'Eagles' },
      away: { name: 'Falcons' },
      sets: { s1: { setNumber: 1, homeScore: 4, awayScore: 2 } },
    },
  };
  db.values.set('matches/public', broadcast);
  await mirrorPublicRecap(db, 'public');
  assert.equal(db.values.get('publicRecaps/public').text, 'Eagles won 1–0.');
  db.values.set('matches/public', { ...broadcast, published: false });
  await mirrorPublicRecap(db, 'public');
  assert.equal(db.values.has('publicRecaps/public'), false);
});
