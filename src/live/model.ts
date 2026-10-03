import { z } from 'zod';
import { matchResult, setScore, type Snapshot } from '../domain';
import { HOME_COLOR, AWAY_COLOR } from '../colors';

const teamSchema = z.object({
  name: z.string().min(1).max(100),
  shortName: z.string().max(20),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  logo: z
    .string()
    .max(1_500_000)
    .refine(
      (value) =>
        value === '' ||
        /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value),
    ),
});
const score = z.number().int().nonnegative();
export const publicMatchSchema = z.object({
  home: teamSchema,
  away: teamSchema,
  status: z.enum(['not_started', 'in_progress', 'completed']),
  tournament: z.string().max(120),
  location: z.string().max(160),
  currentSet: score,
  sets: z
    .record(
      z.string(),
      z.object({
        setNumber: score,
        homeScore: score,
        awayScore: score,
        completed: z.boolean(),
      }),
    )
    .default({}),
  result: z.object({ home: score, away: score, tied: score }),
});
export type PublicMatch = z.infer<typeof publicMatchSchema>;
export const publicBroadcastSchema = z.object({
  schemaVersion: z.literal(1),
  ownerUid: z.string(),
  revision: z.number().int().positive(),
  published: z.boolean(),
  updatedAt: z.number(),
  match: publicMatchSchema.optional(),
});
export type PublicBroadcast = z.infer<typeof publicBroadcastSchema>;
export interface Broadcast {
  id: string; // Local match ID; never imported from a backup.
  publicId: string;
  ownerUid: string;
  enabled: boolean;
  revision: number;
  syncedRevision: number;
}
export interface SyncEntry {
  id: string; // Public ID, one coalesced snapshot per broadcast.
  matchId: string;
  ownerUid: string;
  revision: number;
  match: PublicMatch | null;
}
export function publicMatch(data: Snapshot, matchId: string): PublicMatch {
  const match = data.matches.find((m) => m.id === matchId);
  if (!match) throw new Error('Match no longer exists.');
  const tournament = data.tournaments.find((t) => t.id === match.tournamentId);
  const sets = data.sets
    .filter((s) => s.matchId === matchId)
    .sort((a, b) => a.setNumber - b.setNumber);
  return {
    home: {
      name: match.homeTeam,
      shortName: match.home?.shortName ?? '',
      color: match.homeColor ?? HOME_COLOR,
      logo: match.home?.logo ?? '',
    },
    away: {
      name: match.awayTeam,
      shortName: match.away?.shortName ?? '',
      color: match.awayColor ?? AWAY_COLOR,
      logo: match.away?.logo ?? '',
    },
    tournament: tournament?.name ?? '',
    location: tournament?.location ?? '',
    status: match.status,
    currentSet:
      sets.find((s) => !s.completedAt)?.setNumber ??
      sets.at(-1)?.setNumber ??
      0,
    sets: Object.fromEntries(
      sets.map((s) => [
        `s${s.setNumber}`,
        {
          setNumber: s.setNumber,
          ...setScore(data, s.id),
          completed: !!s.completedAt,
        },
      ]),
    ),
    result: matchResult(data, matchId),
  };
}
// Called in the same transaction as the scoring action. Cloud I/O never occurs here.
export function queueBroadcastChanges(before: Snapshot, after: Snapshot) {
  for (const broadcast of after.broadcasts) {
    const previous = before.broadcasts.find((b) => b.id === broadcast.id);
    if (!after.matches.some((m) => m.id === broadcast.id))
      broadcast.enabled = false;
    const current = broadcast.enabled ? publicMatch(after, broadcast.id) : null;
    const old =
      previous?.enabled && before.matches.some((m) => m.id === broadcast.id)
        ? publicMatch(before, broadcast.id)
        : null;
    if (
      !previous ||
      previous.enabled !== broadcast.enabled ||
      JSON.stringify(old) !== JSON.stringify(current)
    ) {
      broadcast.revision = (previous?.revision ?? 0) + 1;
      after.syncQueue = after.syncQueue.filter(
        (entry) => entry.id !== broadcast.publicId,
      );
      after.syncQueue.push({
        id: broadcast.publicId,
        matchId: broadcast.id,
        ownerUid: broadcast.ownerUid,
        revision: broadcast.revision,
        match: current,
      });
    }
  }
}
