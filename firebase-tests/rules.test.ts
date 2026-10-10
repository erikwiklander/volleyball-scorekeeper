import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { ref, set, get, serverTimestamp } from 'firebase/database';
let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-volleyball-scorekeeper',
    database: {
      host: '127.0.0.1',
      port: 9000,
      rules: readFileSync('database.rules.json', 'utf8'),
    },
  });
});
beforeEach(async () => env.clearDatabase());
afterAll(async () => env?.cleanup());
const team = { name: 'Eagles', shortName: '', color: '#008000', logo: '' };
const privateDb = (uid = 'owner', provider = 'google.com') =>
  env
    .authenticatedContext(uid, {
      firebase: { sign_in_provider: provider, identities: {} },
    })
    .database();
it('full games and tournaments are account-private and scorer epochs fence stale private and live writes', async () => {
  const gameId = crypto.randomUUID(),
    deviceA = crypto.randomUUID(),
    deviceB = crypto.randomUUID();
  const gamePath = `users/owner/games/${gameId}`;
  const gameRef = ref(privateDb(), gamePath);
  const initial = {
    schemaVersion: 1,
    revision: 1,
    mutationId: crypto.randomUUID(),
    deviceId: deviceA,
    scorerDeviceId: deviceA,
    scorerEpoch: 1,
    deleted: false,
    updatedAt: serverTimestamp(),
    payload: JSON.stringify({ privateHistory: true }),
  };
  await assertSucceeds(set(gameRef, initial));
  await assertSucceeds(get(ref(privateDb(), 'users/owner/games')));
  for (const db of [
    env.unauthenticatedContext().database(),
    privateDb('other'),
    privateDb('owner', 'anonymous'),
  ]) {
    await assertFails(get(ref(db, gamePath)));
    await assertFails(get(ref(db, 'users/owner/games')));
    await assertFails(
      set(ref(db, gamePath), {
        ...initial,
        revision: 2,
        mutationId: crypto.randomUUID(),
      }),
    );
  }
  await assertFails(
    set(ref(privateDb(), gamePath + '/payload'), 'nested bypass'),
  );
  await assertFails(set(gameRef, null));
  await assertFails(
    set(gameRef, { ...initial, revision: 3, mutationId: crypto.randomUUID() }),
  );
  await assertFails(
    set(gameRef, {
      ...initial,
      revision: 2,
      mutationId: crypto.randomUUID(),
      scorerEpoch: 2,
      deviceId: deviceB,
      scorerDeviceId: deviceB,
      payload: 'overwrite on takeover',
    }),
  );
  const publicA = {
    ...payload(),
    gameId,
    scorerDeviceId: deviceA,
    scorerEpoch: 1,
  };
  await assertSucceeds(set(owner(), publicA));
  const takeover = {
    ...initial,
    revision: 2,
    mutationId: crypto.randomUUID(),
    scorerEpoch: 2,
    deviceId: deviceB,
    scorerDeviceId: deviceB,
  };
  await assertSucceeds(set(gameRef, takeover));
  await assertFails(
    set(gameRef, { ...initial, revision: 3, mutationId: crypto.randomUUID() }),
  );
  await assertFails(set(owner(), { ...publicA, revision: 2 }));
  await assertFails(set(owner(), payload(2))); // Old clients cannot remove the game's control binding.
  await assertSucceeds(
    set(owner(), {
      ...publicA,
      revision: 2,
      scorerEpoch: 2,
      scorerDeviceId: deviceB,
    }),
  );
  expect((await assertSucceeds(get(visitor()))).val().match.home.name).toBe(
    'Eagles',
  );
  const deleted = {
    ...takeover,
    revision: 3,
    mutationId: crypto.randomUUID(),
    deleted: true,
    payload: null,
  };
  await assertSucceeds(set(gameRef, deleted));
  await assertFails(
    set(owner(), {
      ...publicA,
      revision: 3,
      scorerEpoch: 2,
      scorerDeviceId: deviceB,
    }),
  );
  await assertSucceeds(
    set(owner(), {
      ...publicA,
      revision: 3,
      scorerEpoch: 2,
      scorerDeviceId: deviceB,
      published: false,
      match: null,
    }),
  );
  await assertFails(
    set(gameRef, { ...takeover, revision: 4, mutationId: crypto.randomUUID() }),
  );
  const tournamentRef = ref(
    privateDb(),
    `users/owner/tournaments/${crypto.randomUUID()}`,
  );
  const tournament = {
    schemaVersion: 1,
    revision: 1,
    mutationId: crypto.randomUUID(),
    deviceId: deviceA,
    deleted: false,
    updatedAt: serverTimestamp(),
    payload: '{"name":"Cup"}',
  };
  await assertSucceeds(set(tournamentRef, tournament));
  await assertFails(
    get(
      ref(env.unauthenticatedContext().database(), 'users/owner/tournaments'),
    ),
  );
  await assertFails(get(ref(privateDb('other'), 'users/owner/tournaments')));
  await assertFails(
    set(tournamentRef, {
      ...tournament,
      revision: 2,
      mutationId: crypto.randomUUID(),
      extra: true,
    }),
  );
  await assertSucceeds(
    set(tournamentRef, {
      ...tournament,
      revision: 2,
      mutationId: crypto.randomUUID(),
      deleted: true,
      payload: null,
    }),
  );
});
it('team libraries are private to their Google account and validate revisions and deletion tombstones', async () => {
  const teamId = crypto.randomUUID();
  const path = `users/owner/teams/${teamId}`;
  const dbFor = (uid: string, provider = 'google.com') =>
    env
      .authenticatedContext(uid, {
        firebase: { sign_in_provider: provider, identities: {} },
      })
      .database();
  const teamRef = ref(dbFor('owner'), path);
  const record = (revision: number) => ({
    schemaVersion: 1,
    revision,
    mutationId: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
    deleted: false,
    updatedAt: serverTimestamp(),
    team: {
      id: teamId,
      name: 'Private Eagles',
      sport: 'football',
      primaryColor: '#123456',
      secondaryColor: '#ffffff',
      shortName: 'PE',
      logo: 'data:image/png;base64,AAAA',
      createdAt: '2026-10-10T12:00:00.000Z',
      updatedAt: '2026-10-10T12:00:00.000Z',
    },
  });
  await assertSucceeds(set(teamRef, record(1)));
  await assertFails(
    set(ref(dbFor('owner'), `${path}/team/name`), 'Bypassed revision'),
  );
  await assertSucceeds(get(ref(dbFor('owner'), 'users/owner/teams')));
  for (const db of [
    env.unauthenticatedContext().database(),
    dbFor('other'),
    dbFor('owner', 'anonymous'),
  ]) {
    await assertFails(get(ref(db, path)));
    await assertFails(get(ref(db, 'users/owner/teams')));
    await assertFails(set(ref(db, path), record(2)));
  }
  await assertFails(get(ref(dbFor('owner'), 'users')));
  await assertFails(set(teamRef, null));
  await assertFails(set(teamRef, record(1)));
  await assertFails(set(teamRef, record(3)));
  const bad = record(2);
  await assertFails(
    set(teamRef, { ...bad, team: { ...bad.team, id: crypto.randomUUID() } }),
  );
  await assertFails(
    set(teamRef, {
      ...bad,
      team: { ...bad.team, logo: 'https://example.com/tracker' },
    }),
  );
  await assertFails(set(teamRef, { ...bad, unexpected: true }));
  await assertSucceeds(
    set(teamRef, { ...record(2), deleted: true, team: null }),
  );
  await assertFails(set(teamRef, record(2))); // An old offline writer cannot resurrect it.
  await assertFails(set(ref(dbFor('owner'), 'users/owner/teams'), null));
});
it('keeps analytics writes and session IDs private; only the owner can read game counts', async () => {
  await set(owner(), payload());
  await env.withSecurityRulesDisabled(async (context) => {
    await set(ref(context.database(), 'analytics'), {
      site: {
        summary: { '2026-10-10': { visits: 2 } },
        days: { secret: true },
      },
      games: {
        'public-link': { summary: { viewers: 1 }, sessions: { secret: true } },
      },
    });
  });
  const anonymousDb = env.unauthenticatedContext().database();
  const googleDb = env
    .authenticatedContext('owner', {
      firebase: { sign_in_provider: 'google.com', identities: {} },
    })
    .database();
  const otherDb = env
    .authenticatedContext('other', {
      firebase: { sign_in_provider: 'google.com', identities: {} },
    })
    .database();
  await assertSucceeds(get(ref(googleDb, 'analytics/site/summary')));
  await assertSucceeds(
    get(ref(googleDb, 'analytics/games/public-link/summary')),
  );
  await assertFails(get(ref(otherDb, 'analytics/games/public-link/summary')));
  for (const db of [anonymousDb, googleDb, otherDb]) {
    await assertFails(get(ref(db, 'analytics')));
    await assertFails(get(ref(db, 'analytics/site/days')));
    await assertFails(get(ref(db, 'analytics/games/public-link/sessions')));
    await assertFails(set(ref(db, 'analytics/site/summary'), { visits: 900 }));
    await assertFails(
      set(ref(db, 'analytics/games/public-link/summary'), { viewers: 900 }),
    );
  }
  await assertFails(get(ref(anonymousDb, 'analytics/site/summary')));
});
const payload = (revision = 1) => ({
  schemaVersion: 1,
  ownerUid: 'owner',
  revision,
  published: true,
  updatedAt: serverTimestamp(),
  match: {
    home: team,
    away: { ...team, name: 'Falcons' },
    status: 'not_started',
    tournament: '',
    location: '',
    currentSet: 0,
    result: { home: 0, away: 0, tied: 0 },
  },
});
const owner = () =>
  ref(
    env
      .authenticatedContext('owner', {
        firebase: { sign_in_provider: 'google.com', identities: {} },
      })
      .database(),
    'matches/public-link',
  );
const visitor = () =>
  ref(env.unauthenticatedContext().database(), 'matches/public-link');
it('lets link holders read scores, without granting collection listing or writes', async () => {
  await assertSucceeds(set(owner(), payload()));
  expect((await assertSucceeds(get(visitor()))).val().match.home.name).toBe(
    'Eagles',
  );
  await assertFails(
    get(ref(env.unauthenticatedContext().database(), 'matches')),
  );
  await assertFails(set(visitor(), payload(2)));
  await assertFails(
    set(
      ref(
        env
          .authenticatedContext('other', {
            firebase: { sign_in_provider: 'google.com', identities: {} },
          })
          .database(),
        'matches/public-link',
      ),
      { ...payload(2), ownerUid: 'other' },
    ),
  );
});
it('rejects ownership changes, stale revisions, deletion, and malformed scores', async () => {
  await set(owner(), payload());
  await assertFails(set(owner(), { ...payload(2), ownerUid: 'other' }));
  await assertFails(set(owner(), payload()));
  await assertFails(set(owner(), null));
  await assertFails(
    set(owner(), {
      ...payload(2),
      match: { ...payload().match, currentSet: -1 },
    }),
  );
  await assertFails(set(owner(), { ...payload(2), extra: 'not allowed' }));
  await assertSucceeds(set(owner(), payload(2)));
});
it('preserves ownership and revision after stopping sharing', async () => {
  await set(owner(), payload());
  await assertSucceeds(
    set(owner(), { ...payload(2), published: false, match: null }),
  );
  expect((await get(visitor())).val().published).toBe(false);
  await assertFails(set(owner(), payload()));
  await assertSucceeds(set(owner(), payload(3)));
});
it('rejects non-image logos and incomplete published records', async () => {
  const bad = payload();
  bad.match.home = { ...team, logo: 'https://example.com/track' };
  await assertFails(set(owner(), bad));
  await assertFails(set(owner(), { ...payload(), match: null }));
});

it('rejects anonymous publishing, including writes using the owner uid', async () => {
  const anonymous = ref(
    env
      .authenticatedContext('owner', {
        firebase: { sign_in_provider: 'anonymous', identities: {} },
      })
      .database(),
    'matches/public-link',
  );
  await assertFails(set(anonymous, payload()));
  await set(owner(), payload());
  await assertFails(set(anonymous, payload(2)));
});

it('accepts football snapshots and rejects unsupported sports', async () => {
  const data = payload();
  await assertSucceeds(
    set(owner(), {
      ...data,
      match: {
        ...data.match,
        sport: 'football',
        currentSet: 2,
        sets: {
          s1: { setNumber: 1, homeScore: 8, awayScore: 7, completed: true },
        },
      },
    }),
  );
  const next = payload(2);
  await assertFails(
    set(owner(), { ...next, match: { ...next.match, sport: 'unknown' } }),
  );
});
