const ACTIVE_MS = 90_000;
const DAY_MS = 86_400_000;
const MAX_SESSIONS = 10_000;
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const tokenPattern = /^[a-f0-9-]{36}$/;

// Only anonymous random IDs and server timestamps are stored. No IPs, URLs,
// referrers, names or browser fingerprints enter the analytics database.
export function recordSiteVisit(current, event, now) {
  const data = current ?? { days: {}, summary: {} };
  const day = new Date(now).toISOString().slice(0, 10);
  const cutoff = new Date(now - 29 * DAY_MS).toISOString().slice(0, 10);
  for (const key of Object.keys(data.days ?? {})) {
    if (key < cutoff) {
      delete data.days[key];
      delete data.summary[key];
    }
  }
  data.days ??= {};
  data.summary ??= {};
  const bucket = (data.days[day] ??= { sessions: {}, visits: {} });
  const summary = (data.summary[day] ??= {
    sessions: 0,
    visits: 0,
    scorerVisits: 0,
    scoreboardVisits: 0,
  });
  if (bucket.visits[event.visitId]) return data;
  if (Object.keys(bucket.visits).length >= MAX_SESSIONS) return;
  if (!bucket.sessions[event.sessionId]) {
    bucket.sessions[event.sessionId] = true;
    summary.sessions++;
  }
  bucket.visits[event.visitId] = true;
  summary.visits++;
  summary[event.surface === 'scorer' ? 'scorerVisits' : 'scoreboardVisits']++;
  return data;
}

export function recordGameViewer(current, sessionId, status, now) {
  const data = current ?? {
    sessions: {},
    summary: { viewers: 0, liveViewers: 0, peakWatching: 0, active: {} },
  };
  const summary = data.summary;
  summary.active ??= {};
  if (!data.sessions[sessionId]) {
    if (Object.keys(data.sessions).length >= MAX_SESSIONS) return;
    data.sessions[sessionId] = { live: false };
    summary.viewers++;
  }
  if (status === 'in_progress' && !data.sessions[sessionId].live) {
    data.sessions[sessionId].live = true;
    summary.liveViewers++;
  }
  for (const [id, lastSeen] of Object.entries(summary.active)) {
    if (lastSeen <= now - ACTIVE_MS) delete summary.active[id];
  }
  // Final-score readers count toward total viewers, but not the live audience.
  if (status === 'in_progress') summary.active[sessionId] = now;
  else summary.active = {};
  summary.peakWatching = Math.max(
    summary.peakWatching,
    Object.keys(summary.active).length,
  );
  return data;
}

export function createAnalyticsHandler({ database, now = Date.now }) {
  let windowStart = 0;
  let requests = 0;
  return async (request, response) => {
    response.set('Cache-Control', 'no-store');
    if (request.method !== 'POST')
      return response.status(405).send('POST only');
    const event = request.body;
    if (
      !event ||
      typeof event.sessionId !== 'string' ||
      !tokenPattern.test(event.sessionId) ||
      (event.kind !== 'site' && event.kind !== 'game') ||
      (event.kind === 'site' &&
        (typeof event.visitId !== 'string' ||
          !tokenPattern.test(event.visitId) ||
          !['scorer', 'scoreboard'].includes(event.surface))) ||
      (event.kind === 'game' &&
        (typeof event.publicId !== 'string' ||
          !idPattern.test(event.publicId))) ||
      JSON.stringify(event).length > 512
    )
      return response.status(400).send('Invalid analytics event');
    const time = now();
    if (time - windowStart >= 60_000) {
      windowStart = time;
      requests = 0;
    }
    if (++requests > 600) return response.status(429).send('Try later');
    try {
      let result;
      if (event.kind === 'site') {
        result = await database
          .ref('analytics/site')
          .transaction((data) => recordSiteVisit(data, event, time));
      } else {
        // Withdrawal removes match/status. Avoid downloading team logos and
        // the complete score snapshot on every spectator heartbeat.
        const match = await database
          .ref(`matches/${event.publicId}/match/status`)
          .get();
        const status = match.val();
        if (!['not_started', 'in_progress', 'completed'].includes(status))
          return response.status(204).send('');
        result = await database
          .ref(`analytics/games/${event.publicId}`)
          .transaction((data) =>
            recordGameViewer(data, event.sessionId, status, time),
          );
      }
      return response.status(result.committed ? 204 : 429).send('');
    } catch {
      // Never log the request body or identifiers.
      return response.status(503).send('Analytics temporarily unavailable');
    }
  };
}
