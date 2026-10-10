import { z } from 'zod';
import { id, sportOf, type Snapshot, type Tournament } from '../domain';
import {
  eventSchema,
  matchSchema,
  setSchema,
  tournamentSchema,
} from '../export';

export type LibraryKind = 'games' | 'tournaments';
export interface LibraryLink {
  id: string;
  kind: LibraryKind;
  recordId: string;
  ownerUid: string;
  revision: number;
  scorerDeviceId?: string;
  scorerEpoch?: number;
}
export interface LibraryEntry extends LibraryLink {
  mutationId: string;
  payload: string | null;
}
export const libraryRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().positive(),
    mutationId: z.uuid(),
    deviceId: z.uuid(),
    deleted: z.boolean(),
    updatedAt: z.number(),
    payload: z.string().max(8_000_000).optional(),
    scorerDeviceId: z.uuid().optional(),
    scorerEpoch: z.number().int().positive().optional(),
  })
  .refine((r) => r.deleted === (r.payload === undefined));
export type LibraryRecord = z.infer<typeof libraryRecordSchema>;
export const libraryRecordsSchema = z.record(
  z.string().min(1).max(128),
  libraryRecordSchema,
);
const broadcastSchema = z.object({
  id: z.string().min(1),
  publicId: z.uuid(),
  ownerUid: z.string().min(1),
  enabled: z.boolean(),
  revision: z.number().int().nonnegative(),
});
export const gameSchema = z
  .object({
    match: matchSchema,
    sets: z.array(setSchema),
    events: z.array(eventSchema),
    broadcast: broadcastSchema.optional(),
  })
  .superRefine((game, ctx) => {
    const matchId = game.match.id;
    const sets = new Map(game.sets.map((s) => [s.id, s]));
    const events = new Map(game.events.map((e) => [e.id, e]));
    if (
      sets.size !== game.sets.length ||
      events.size !== game.events.length ||
      game.sets.some((s) => s.matchId !== matchId) ||
      game.sets.filter((s) => !s.completedAt).length > 1 ||
      new Set(game.sets.map((s) => s.setNumber)).size !== game.sets.length ||
      new Set(game.events.map((e) => e.sequence)).size !== game.events.length ||
      (game.match.status === 'completed' &&
        (!game.match.completedAt || game.sets.some((s) => !s.completedAt))) ||
      game.events.some((e) =>
        e.action === 'HOME_POINT' || e.action === 'AWAY_POINT'
          ? sportOf(game.match) === 'football'
            ? !e.scoringType
            : !!e.scoringType
          : !!e.scoringType,
      ) ||
      (game.broadcast && game.broadcast.id !== matchId) ||
      game.events.some(
        (e) =>
          e.matchId !== matchId ||
          e.tournamentId !== game.match.tournamentId ||
          Date.parse(e.timestamp) !== e.epochMs ||
          (e.setId &&
            (sets.get(e.setId)?.matchId !== matchId ||
              sets.get(e.setId)?.setNumber !== e.setNumber)) ||
          ([
            'HOME_POINT',
            'AWAY_POINT',
            'UNDO',
            'SET_STARTED',
            'SET_ENDED',
          ].includes(e.action) &&
            !e.setId) ||
          (e.action === 'UNDO' &&
            (!events.has(e.targetEventId ?? '') ||
              !['HOME_POINT', 'AWAY_POINT'].includes(
                events.get(e.targetEventId ?? '')!.action,
              ) ||
              events.get(e.targetEventId ?? '')!.setId !== e.setId ||
              events.get(e.targetEventId ?? '')!.sequence >= e.sequence)),
      )
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid game history.' });
  });
export type GameBundle = z.infer<typeof gameSchema>;
export const libraryKey = (kind: LibraryKind, recordId: string) =>
  `${kind}:${recordId}`;
export const libraryLink = (
  data: Snapshot,
  kind: LibraryKind,
  recordId: string,
) => data.libraryLinks.find((link) => link.id === libraryKey(kind, recordId));
export function inLibrary(data: Snapshot, kind: LibraryKind, recordId: string) {
  const link = libraryLink(data, kind, recordId);
  return !link || link.ownerUid === data.teamSync.ownerUid;
}
export function canScoreGame(data: Snapshot, recordId: string) {
  const link = libraryLink(data, 'games', recordId);
  return (
    inLibrary(data, 'games', recordId) &&
    (!link || link.scorerDeviceId === data.teamSync.deviceId)
  );
}
export function gameBundle(
  data: Snapshot,
  matchId: string,
): GameBundle | undefined {
  const match = data.matches.find((m) => m.id === matchId);
  if (!match) return;
  const broadcast = data.broadcasts.find((b) => b.id === matchId);
  return {
    match,
    sets: data.sets.filter((s) => s.matchId === matchId),
    events: data.events.filter((e) => e.matchId === matchId),
    ...(broadcast
      ? {
          broadcast: {
            id: broadcast.id,
            publicId: broadcast.publicId,
            ownerUid: broadcast.ownerUid,
            enabled: broadcast.enabled,
            revision: broadcast.revision,
          },
        }
      : {}),
  };
}
function payloadFor(data: Snapshot, kind: LibraryKind, recordId: string) {
  const record =
    kind === 'games'
      ? gameBundle(data, recordId)
      : data.tournaments.find((t) => t.id === recordId);
  return record ? JSON.stringify(record) : null;
}
function enqueue(data: Snapshot, link: LibraryLink) {
  data.libraryQueue = data.libraryQueue.filter((e) => e.id !== link.id);
  data.libraryQueue.push({
    ...link,
    mutationId: id(),
    payload: payloadFor(data, link.kind, link.recordId),
  });
}
function attach(
  data: Snapshot,
  kind: LibraryKind,
  recordId: string,
  ownerUid: string,
) {
  const link: LibraryLink = {
    id: libraryKey(kind, recordId),
    kind,
    recordId,
    ownerUid,
    revision: 0,
    ...(kind === 'games'
      ? { scorerDeviceId: data.teamSync.deviceId, scorerEpoch: 1 }
      : {}),
  };
  data.libraryLinks.push(link);
  enqueue(data, link);
  return link;
}
export function adoptLocalLibrary(data: Snapshot, ownerUid: string) {
  data.teamSync.deviceId ||= id();
  // Existing live links retain their original account, even on first migration.
  for (const tournament of data.tournaments) {
    if (libraryLink(data, 'tournaments', tournament.id)) continue;
    const existingOwner = data.broadcasts.find((b) =>
      data.matches.some(
        (m) => m.id === b.id && m.tournamentId === tournament.id,
      ),
    )?.ownerUid;
    attach(data, 'tournaments', tournament.id, existingOwner ?? ownerUid);
  }
  for (const match of data.matches) {
    if (libraryLink(data, 'games', match.id)) continue;
    const owner =
      data.broadcasts.find((b) => b.id === match.id)?.ownerUid ??
      (match.tournamentId
        ? libraryLink(data, 'tournaments', match.tournamentId)?.ownerUid
        : undefined) ??
      ownerUid;
    attach(data, 'games', match.id, owner);
  }
}
export function queueLibraryChanges(before: Snapshot, after: Snapshot) {
  for (const kind of ['tournaments', 'games'] as const) {
    const records =
      kind === 'games'
        ? [...before.matches, ...after.matches]
        : [...before.tournaments, ...after.tournaments];
    for (const recordId of new Set(records.map((r) => r.id))) {
      if (
        payloadFor(before, kind, recordId) === payloadFor(after, kind, recordId)
      )
        continue;
      let link = libraryLink(after, kind, recordId);
      if (link && !inLibrary(after, kind, recordId))
        throw new Error(
          'The account changed. Reopen this record before editing.',
        );
      if (kind === 'games' && !canScoreGame(after, recordId))
        throw new Error(
          'Another device controls this game. Connect and take over scoring before changing it.',
        );
      if (!link && after.teamSync.ownerUid) {
        after.teamSync.deviceId ||= id();
        link = attach(after, kind, recordId, after.teamSync.ownerUid);
      } else if (link) enqueue(after, link);
    }
  }
}
export function parseLibraryPayload(
  kind: LibraryKind,
  recordId: string,
  remote: LibraryRecord,
) {
  if (kind === 'games' && (!remote.scorerDeviceId || !remote.scorerEpoch))
    throw new Error('Missing scorer.');
  if (remote.deleted) return;
  const value = JSON.parse(remote.payload!);
  const payload =
    kind === 'games' ? gameSchema.parse(value) : tournamentSchema.parse(value);
  if (('match' in payload ? payload.match.id : payload.id) !== recordId)
    throw new Error('Invalid record ID.');
  return payload;
}
function removeGame(data: Snapshot, matchId: string) {
  const publicIds = data.broadcasts
    .filter((b) => b.id === matchId)
    .map((b) => b.publicId);
  data.matches = data.matches.filter((m) => m.id !== matchId);
  data.sets = data.sets.filter((s) => s.matchId !== matchId);
  data.events = data.events.filter((e) => e.matchId !== matchId);
  data.broadcasts = data.broadcasts.filter((b) => b.id !== matchId);
  data.syncQueue = data.syncQueue.filter((e) => !publicIds.includes(e.id));
  if (data.appState.activeMatchId === matchId)
    data.appState = {
      id: 'current',
      activeTournamentId: data.appState.activeTournamentId,
    };
}
function installGame(data: Snapshot, game: GameBundle, ownerUid: string) {
  if (game.broadcast && game.broadcast.ownerUid !== ownerUid)
    throw new Error('Invalid live link owner.');
  const active = data.appState.activeMatchId === game.match.id;
  const previous = data.broadcasts.find(
    (b) => b.id === game.match.id && b.publicId === game.broadcast?.publicId,
  );
  const pendingLive =
    previous?.revision === game.broadcast?.revision &&
    canScoreGame(data, game.match.id)
      ? data.syncQueue.filter((e) => e.matchId === game.match.id)
      : [];
  removeGame(data, game.match.id);
  data.matches.push(game.match);
  data.sets.push(...game.sets);
  data.events.push(...game.events);
  data.syncQueue.push(...pendingLive);
  if (game.broadcast)
    data.broadcasts.push({
      ...game.broadcast,
      syncedRevision: Math.min(
        previous?.syncedRevision ?? 0,
        game.broadcast.revision,
      ),
    });
  if (active)
    data.appState = {
      id: 'current',
      activeMatchId: game.match.id,
      activeTournamentId: game.match.tournamentId,
      activeSetId: game.sets.find((s) => !s.completedAt)?.id,
    };
}
function saveGameCopy(data: Snapshot, game: GameBundle, ownerUid: string) {
  const matchId = id();
  const ids = new Map(
    [...game.sets, ...game.events].map((record) => [record.id, id()]),
  );
  const homeTeam = `${game.match.homeTeam.slice(0, 87)} (saved copy)`;
  const copy: GameBundle = {
    match: {
      ...game.match,
      id: matchId,
      tournamentId: undefined,
      homeTeam,
      home: game.match.home
        ? { ...game.match.home, displayName: homeTeam }
        : undefined,
    },
    sets: game.sets.map((s) => ({ ...s, id: ids.get(s.id)!, matchId })),
    events: game.events.map((e) => ({
      ...e,
      id: ids.get(e.id)!,
      matchId,
      tournamentId: undefined,
      setId: e.setId ? ids.get(e.setId) : undefined,
      targetEventId: e.targetEventId ? ids.get(e.targetEventId) : undefined,
    })),
  };
  installGame(data, copy, ownerUid);
  attach(data, 'games', matchId, ownerUid);
  data.teamSync.libraryNotice =
    'Another device took over or changed a game. Your unsynced scoring history was kept in a separate game marked “saved copy”.';
}
export function applyLibraryRecord(
  data: Snapshot,
  kind: LibraryKind,
  recordId: string,
  ownerUid: string,
  remote: LibraryRecord,
) {
  const payload = parseLibraryPayload(kind, recordId, remote);
  let link = libraryLink(data, kind, recordId);
  if (link && link.ownerUid !== ownerUid)
    throw new Error('Record belongs to another cached account.');
  if (link && remote.revision < link.revision) return;
  if (!link) {
    link = {
      id: libraryKey(kind, recordId),
      kind,
      recordId,
      ownerUid,
      revision: 0,
    };
    data.libraryLinks.push(link);
  }
  const pending = data.libraryQueue.find((e) => e.id === link!.id);
  Object.assign(link, {
    revision: remote.revision,
    scorerDeviceId: remote.scorerDeviceId,
    scorerEpoch: remote.scorerEpoch,
  });
  if (pending) {
    if (pending.mutationId === remote.mutationId) {
      data.libraryQueue = data.libraryQueue.filter((e) => e.id !== link!.id);
      return; // Keep newer local state and any pending public upload.
    }
    const sameScorer =
      kind === 'tournaments' ||
      (pending.scorerDeviceId === remote.scorerDeviceId &&
        pending.scorerEpoch === remote.scorerEpoch);
    if (
      sameScorer &&
      (pending.revision === remote.revision ||
        remote.deviceId === data.teamSync.deviceId)
    ) {
      pending.revision = remote.revision;
      return;
    }
    if (pending.revision >= remote.revision) return;
    if (pending.payload) {
      if (kind === 'games')
        saveGameCopy(
          data,
          gameSchema.parse(JSON.parse(pending.payload)),
          ownerUid,
        );
      else {
        const tournament = tournamentSchema.parse(JSON.parse(pending.payload));
        const copy = {
          ...tournament,
          id: id(),
          name: `${tournament.name.slice(0, 107)} (saved copy)`,
        };
        data.tournaments.push(copy);
        attach(data, 'tournaments', copy.id, ownerUid);
        data.teamSync.libraryNotice =
          'Conflicting tournament details were preserved in a tournament marked “saved copy”.';
      }
    } else
      data.teamSync.libraryNotice =
        'A record changed on another device. Its latest cloud version was kept; the pending deletion was cancelled.';
    data.libraryQueue = data.libraryQueue.filter((e) => e.id !== link!.id);
  }
  if (kind === 'games') {
    if (remote.deleted) {
      // Keep the owner's pending stop-sharing upload until its public tombstone is acknowledged.
      const stopped =
        canScoreGame(data, recordId) &&
        data.syncQueue.some((e) => e.matchId === recordId && e.match === null);
      if (!stopped) removeGame(data, recordId);
      else {
        data.matches = data.matches.filter((m) => m.id !== recordId);
        data.sets = data.sets.filter((s) => s.matchId !== recordId);
        data.events = data.events.filter((e) => e.matchId !== recordId);
        if (data.appState.activeMatchId === recordId)
          data.appState = { id: 'current' };
      }
    } else installGame(data, payload as GameBundle, ownerUid);
  } else {
    data.tournaments = data.tournaments.filter((t) => t.id !== recordId);
    if (!remote.deleted) data.tournaments.push(payload as Tournament);
    else if (data.appState.activeTournamentId === recordId)
      delete data.appState.activeTournamentId;
  }
}
// A transferred game keeps its public URL and queues the latest score for that URL.
export function queueCurrentLive(data: Snapshot, matchId: string) {
  const broadcast = data.broadcasts.find((b) => b.id === matchId);
  if (broadcast) broadcast.revision++;
}
export function refreshLibraryQueue(data: Snapshot) {
  for (const entry of data.libraryQueue)
    entry.payload = payloadFor(data, entry.kind, entry.recordId);
}
