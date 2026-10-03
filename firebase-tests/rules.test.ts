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
