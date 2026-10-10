import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAnalyticsHandler,
  recordGameViewer,
  recordSiteVisit,
} from './analytics.js';
const sessionId = '00000000-0000-4000-8000-000000000001';
const visitId = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';
const now = Date.parse('2026-10-10T18:00:00Z');
const event = { sessionId, visitId, surface: 'scoreboard' };

test('site retries count once; reloads increase visits but keep one daily session', () => {
  let data = recordSiteVisit(null, event, now);
  data = recordSiteVisit(data, event, now);
  data = recordSiteVisit(
    data,
    { ...event, visitId: other, surface: 'scorer' },
    now,
  );
  assert.deepEqual(data.summary['2026-10-10'], {
    sessions: 1,
    visits: 2,
    scorerVisits: 1,
    scoreboardVisits: 1,
  });
  data = recordSiteVisit(data, event, now + 86_400_000);
  assert.equal(data.summary['2026-10-11'].sessions, 1);
});
test('daily site records expire after 30 UTC calendar days', () => {
  let data = recordSiteVisit(null, event, now);
  data = recordSiteVisit(data, event, now + 30 * 86_400_000);
  assert.deepEqual(Object.keys(data.summary), ['2026-11-09']);
  assert.deepEqual(Object.keys(data.days), ['2026-11-09']);
});
test('game reloads and heartbeats do not inflate unique viewers; live transition counts once', () => {
  let data = recordGameViewer(null, sessionId, 'not_started', now);
  assert.equal(data.summary.viewers, 1);
  assert.equal(data.summary.liveViewers, 0);
  assert.equal(data.summary.peakWatching, 0);
  data = recordGameViewer(data, sessionId, 'in_progress', now + 30_000);
  data = recordGameViewer(data, sessionId, 'in_progress', now + 60_000);
  assert.equal(data.summary.viewers, 1);
  assert.equal(data.summary.liveViewers, 1);
  data = recordGameViewer(data, other, 'in_progress', now + 60_000);
  assert.equal(data.summary.peakWatching, 2);
  data = recordGameViewer(data, other, 'in_progress', now + 150_000);
  assert.deepEqual(data.summary.active, { [other]: now + 150_000 });
  assert.equal(data.summary.peakWatching, 2);
});
test('final-score readers increase total viewers and never increase live counts', () => {
  let data = recordGameViewer(null, sessionId, 'in_progress', now);
  data = recordGameViewer(data, other, 'completed', now + 1);
  assert.equal(data.summary.viewers, 2);
  assert.equal(data.summary.liveViewers, 1);
  assert.equal(data.summary.peakWatching, 1);
  assert.deepEqual(data.summary.active, {});
});
function response() {
  return {
    code: 0,
    set() {
      return this;
    },
    status(code) {
      this.code = code;
      return this;
    },
    send() {
      return this;
    },
  };
}
test('endpoint rejects malformed IDs and never records an unavailable game', async () => {
  let transactions = 0;
  const handler = createAnalyticsHandler({
    database: {
      ref() {
        return {
          get: async () => ({ val: () => null }),
          transaction: async () => {
            transactions++;
          },
        };
      },
    },
    now: () => now,
  });
  for (const body of [
    null,
    { kind: 'game', sessionId, publicId: '../bad' },
    { kind: 'site', sessionId, visitId, surface: 'other' },
    { kind: 'site', sessionId: [sessionId], visitId, surface: 'scorer' },
  ]) {
    const res = response();
    await handler({ method: 'POST', body }, res);
    assert.equal(res.code, 400);
  }
  const res = response();
  await handler(
    { method: 'POST', body: { kind: 'game', sessionId, publicId: 'game' } },
    res,
  );
  assert.equal(res.code, 204);
  assert.equal(transactions, 0);
});
test('analytics failures return 503; the bounded request window returns 429 then resets', async () => {
  let time = now;
  const handler = createAnalyticsHandler({
    database: {
      ref() {
        return {
          transaction: async () => {
            throw new Error('Unavailable');
          },
        };
      },
    },
    now: () => time,
  });
  for (let i = 0; i < 600; i++) {
    const res = response();
    await handler({ method: 'POST', body: { kind: 'site', ...event } }, res);
    assert.equal(res.code, 503);
  }
  const res = response();
  await handler({ method: 'POST', body: { kind: 'site', ...event } }, res);
  assert.equal(res.code, 429);
  time += 60_000;
  const next = response();
  await handler({ method: 'POST', body: { kind: 'site', ...event } }, next);
  assert.equal(next.code, 503);
});
