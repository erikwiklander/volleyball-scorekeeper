import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  initializeAuth,
  indexedDBLocalPersistence,
  GoogleAuthProvider,
  signInWithPopup,
  browserPopupRedirectResolver,
  onAuthStateChanged,
  signOut,
  type User,
} from 'firebase/auth';
import {
  connectDatabaseEmulator,
  getDatabase,
  get,
  onValue,
  ref,
  runTransaction,
  serverTimestamp,
} from 'firebase/database';
import { liveConfig } from './config';
import type { SyncEntry } from './model';
import type { GameAnalytics, SiteDayAnalytics } from '../analytics';
import {
  cloudTeamRecordSchema,
  normalizedTeam,
  type TeamQueueEntry,
} from '../team-sync/model';
import {
  libraryRecordSchema,
  parseLibraryPayload,
  type LibraryKind,
  type LibraryEntry,
} from '../library-sync/model';
const config = liveConfig();
if (!config) throw new Error('Live scores have not been connected yet.');
const app = initializeApp(config, 'live-scores');
const database = getDatabase(app);
const emulator =
  import.meta.env.VITE_FIREBASE_EMULATORS === 'true' &&
  ['localhost', '127.0.0.1'].includes(location.hostname);
if (emulator) connectDatabaseEmulator(database, '127.0.0.1', 9000);
let publisherAuth: ReturnType<typeof initializeAuth> | undefined;
function publishingAuth() {
  if (!publisherAuth) {
    publisherAuth = initializeAuth(app, {
      persistence: indexedDBLocalPersistence,
      // Firebase preloads the sign-in iframe on Safari/mobile before the tap.
      // Without this, cold popup setup can outlive the browser's user gesture.
      popupRedirectResolver: browserPopupRedirectResolver,
    });
    if (emulator)
      connectAuthEmulator(publisherAuth, 'http://127.0.0.1:9099', {
        disableWarnings: true,
      });
    onAuthStateChanged(publisherAuth, () =>
      window.dispatchEvent(new Event('live-auth-change')),
    );
  }
  return publisherAuth;
}
export function watchPublisher(callback: (user: User | null) => void) {
  return onAuthStateChanged(publishingAuth(), callback);
}
// Called directly from a click; no awaited import before opening the popup.
export function signInPublisher() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(
    publishingAuth(),
    provider,
    browserPopupRedirectResolver,
  );
}
export function signOutPublisher() {
  return signOut(publishingAuth());
}
export async function publisherIdentity() {
  const auth = publishingAuth();
  await auth.authStateReady();
  const user = auth.currentUser;
  if (
    !user ||
    user.isAnonymous ||
    !user.providerData.some((p) => p.providerId === 'google.com')
  )
    throw new Error('Sign in with Google to publish pending scores.');
  return user.uid;
}
export async function publish(entry: SyncEntry) {
  if ((await publisherIdentity()) !== entry.ownerUid)
    throw new Error(
      'The original publishing identity is unavailable in this browser.',
    );
  if (entry.gameId) {
    const game = (
      await get(ref(database, `users/${entry.ownerUid}/games/${entry.gameId}`))
    ).val();
    if (
      !game ||
      game.scorerDeviceId !== entry.scorerDeviceId ||
      game.scorerEpoch !== entry.scorerEpoch
    )
      throw new Error('Another device controls this live game.');
  }
  await runTransaction(
    ref(database, `matches/${entry.id}`),
    (current) => {
      if (current && current.ownerUid !== entry.ownerUid) return; // Rules also enforce ownership.
      if (current && current.revision >= entry.revision) return;
      return {
        schemaVersion: 1,
        ownerUid: entry.ownerUid,
        revision: entry.revision,
        published: entry.match !== null,
        match: entry.match,
        updatedAt: serverTimestamp(),
        ...(entry.gameId
          ? {
              gameId: entry.gameId,
              scorerDeviceId: entry.scorerDeviceId,
              scorerEpoch: entry.scorerEpoch,
            }
          : {}),
      };
    },
    { applyLocally: false },
  ).then((result) => {
    const current = result.snapshot.val();
    if (
      !current ||
      current.ownerUid !== entry.ownerUid ||
      current.revision < entry.revision
    )
      throw new Error('Live score update was not accepted.');
  });
}
export function watchLibrary(
  ownerUid: string,
  kind: LibraryKind,
  onData: (value: unknown) => void,
  onError: (error: Error) => void,
) {
  return onValue(
    ref(database, `users/${ownerUid}/${kind}`),
    (snapshot) => onData(snapshot.val() ?? {}),
    onError,
  );
}
export async function publishLibrary(entry: LibraryEntry, deviceId: string) {
  if ((await publisherIdentity()) !== entry.ownerUid)
    throw new Error('Sign in with the library owner’s account.');
  const checked = libraryRecordSchema.parse({
    schemaVersion: 1,
    revision: entry.revision + 1,
    mutationId: entry.mutationId,
    deviceId,
    deleted: entry.payload === null,
    updatedAt: Date.now(),
    payload: entry.payload ?? undefined,
    scorerDeviceId: entry.scorerDeviceId,
    scorerEpoch: entry.scorerEpoch,
  });
  parseLibraryPayload(entry.kind, entry.recordId, checked);
  const target = ref(
    database,
    `users/${entry.ownerUid}/${entry.kind}/${entry.recordId}`,
  );
  const latest = (await get(target)).val();
  if (
    latest &&
    (latest.mutationId === entry.mutationId ||
      latest.revision !== entry.revision ||
      (entry.kind === 'games' &&
        (latest.scorerDeviceId !== entry.scorerDeviceId ||
          latest.scorerEpoch !== entry.scorerEpoch)))
  )
    return libraryRecordSchema.parse(latest);
  if (!latest && entry.revision > 0)
    throw new Error('Cloud record unavailable.');
  const payload = {
    schemaVersion: 1,
    revision: entry.revision + 1,
    mutationId: entry.mutationId,
    deviceId,
    deleted: entry.payload === null,
    payload: entry.payload,
    updatedAt: serverTimestamp(),
    ...(entry.kind === 'games'
      ? { scorerDeviceId: entry.scorerDeviceId, scorerEpoch: entry.scorerEpoch }
      : {}),
  };
  const result = await runTransaction(
    target,
    (current) => {
      if (
        current &&
        (current.mutationId === entry.mutationId ||
          current.revision !== entry.revision ||
          (entry.kind === 'games' &&
            (current.scorerDeviceId !== entry.scorerDeviceId ||
              current.scorerEpoch !== entry.scorerEpoch)))
      )
        return;
      if (!current && entry.revision > 0) return;
      return payload;
    },
    { applyLocally: false },
  );
  return libraryRecordSchema.parse(result.snapshot.val());
}
export async function takeOverGame(
  ownerUid: string,
  gameId: string,
  deviceId: string,
  expectedRevision: number,
) {
  if ((await publisherIdentity()) !== ownerUid)
    throw new Error('Sign in with the game owner’s account.');
  const target = ref(database, `users/${ownerUid}/games/${gameId}`);
  const latest = (await get(target)).val();
  if (!latest || latest.deleted)
    throw new Error('This game is no longer available.');
  const mutationId = crypto.randomUUID();
  const result = await runTransaction(
    target,
    (current) => {
      if (!current || current.deleted || current.revision !== expectedRevision)
        return;
      return {
        ...current,
        revision: current.revision + 1,
        mutationId,
        deviceId,
        scorerDeviceId: deviceId,
        scorerEpoch: current.scorerEpoch + 1,
        updatedAt: serverTimestamp(),
      };
    },
    { applyLocally: false },
  );
  const record = libraryRecordSchema.parse(result.snapshot.val());
  parseLibraryPayload('games', gameId, record);
  if (!result.committed || record.mutationId !== mutationId)
    throw new Error(
      'The game changed before takeover. Review its latest score and try again.',
    );
  return record;
}
export function watchMatch(
  id: string,
  onData: (data: unknown) => void,
  onError: (error: Error) => void,
) {
  return onValue(
    ref(database, `matches/${id}`),
    (snapshot) => onData(snapshot.val()),
    onError,
  );
}
export function watchConnection(onConnected: (connected: boolean) => void) {
  return onValue(ref(database, '.info/connected'), (snapshot) =>
    onConnected(snapshot.val() === true),
  );
}
export function watchGameAnalytics(
  publicId: string,
  onData: (data: GameAnalytics | undefined) => void,
  onError: (error: Error) => void,
) {
  return onValue(
    ref(database, `analytics/games/${publicId}/summary`),
    (snapshot) => onData(snapshot.val() ?? undefined),
    onError,
  );
}
export function watchSiteAnalytics(
  onData: (data: Record<string, SiteDayAnalytics>) => void,
  onError: (error: Error) => void,
) {
  return onValue(
    ref(database, 'analytics/site/summary'),
    (snapshot) => onData(snapshot.val() ?? {}),
    onError,
  );
}
export function watchTeams(
  ownerUid: string,
  onData: (data: unknown) => void,
  onError: (error: Error) => void,
) {
  return onValue(
    ref(database, `users/${ownerUid}/teams`),
    (snapshot) => onData(snapshot.val() ?? {}),
    onError,
  );
}
export async function publishTeam(entry: TeamQueueEntry, deviceId: string) {
  if ((await publisherIdentity()) !== entry.ownerUid)
    throw new Error('Sign in with the team owner’s Google account to sync.');
  const target = ref(database, `users/${entry.ownerUid}/teams/${entry.id}`);
  const latest = (await get(target)).val();
  if (
    latest &&
    (latest.mutationId === entry.mutationId ||
      latest.revision !== entry.baseRevision)
  )
    return cloudTeamRecordSchema.parse(latest);
  if (!latest && entry.baseRevision > 0)
    throw new Error('The cloud team record is unavailable.');
  const payload = {
    schemaVersion: 1,
    revision: entry.baseRevision + 1,
    mutationId: entry.mutationId,
    deviceId,
    deleted: !entry.team,
    team: entry.team ? normalizedTeam(entry.team) : null,
    updatedAt: serverTimestamp(),
  };
  const result = await runTransaction(
    target,
    (current) => {
      if (
        current &&
        (current.mutationId === entry.mutationId ||
          current.revision !== entry.baseRevision)
      )
        return;
      if (!current && entry.baseRevision > 0) return;
      return payload;
    },
    { applyLocally: false },
  );
  return cloudTeamRecordSchema.parse(result.snapshot.val());
}
