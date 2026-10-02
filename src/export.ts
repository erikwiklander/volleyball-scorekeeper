import { z } from 'zod';
import { actions, id, orderedEvents, type Snapshot } from './domain';
const text = z.string().min(1);
const time = z.iso.datetime();
const tournamentSchema = z.object({
  id: text,
  name: text,
  date: z.string().optional(),
  location: z.string().optional(),
  defaultTeamName: z.string().optional(),
  defaultTeamShortName: z.string().optional(),
  createdAt: time,
  updatedAt: time,
});
const matchSchema = z.object({
  id: text,
  tournamentId: text.optional(),
  homeTeam: text,
  awayTeam: text,
  homeColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  awayColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  status: z.enum(['not_started', 'in_progress', 'completed']),
  startedAt: time.optional(),
  completedAt: time.optional(),
  createdAt: time,
  updatedAt: time,
});
const setSchema = z.object({
  id: text,
  matchId: text,
  setNumber: z.number().int().positive(),
  startedAt: time,
  completedAt: time.optional(),
});
const eventSchema = z.object({
  id: text,
  tournamentId: text.optional(),
  matchId: text,
  setId: text.optional(),
  setNumber: z.number().int().positive().optional(),
  timestamp: time,
  epochMs: z.number().int(),
  sequence: z.number().int().positive(),
  action: z.enum(actions),
  homeScore: z.number().int().nonnegative(),
  awayScore: z.number().int().nonnegative(),
  targetEventId: text.optional(),
  syncNumber: z.number().int().positive().optional(),
});
const backupSchema = z.object({
  schemaVersion: z.literal(1),
  tournament: tournamentSchema.optional(),
  matches: z.array(matchSchema),
  sets: z.array(setSchema),
  events: z.array(eventSchema),
});
export function tournamentBackup(data: Snapshot, tournamentId: string) {
  const tournament = data.tournaments.find((t) => t.id === tournamentId);
  if (!tournament) throw new Error('Tournament not found.');
  const matches = data.matches.filter((m) => m.tournamentId === tournamentId);
  const ids = new Set(matches.map((m) => m.id));
  return {
    schemaVersion: 1 as const,
    exportedAt: new Date().toISOString(),
    tournament,
    matches,
    sets: data.sets.filter((s) => ids.has(s.matchId)),
    events: orderedEvents(data.events.filter((e) => ids.has(e.matchId))),
  };
}
export function gameBackup(data: Snapshot, matchId: string) {
  const match = data.matches.find((m) => m.id === matchId);
  if (!match || match.tournamentId)
    throw new Error('Standalone game not found.');
  return {
    schemaVersion: 1 as const,
    exportedAt: new Date().toISOString(),
    matches: [match],
    sets: data.sets.filter((s) => s.matchId === matchId),
    events: orderedEvents(data.events.filter((e) => e.matchId === matchId)),
  };
}
export function importBackup(raw: unknown, data: Snapshot) {
  const backup = backupSchema.parse(raw);
  if (!backup.tournament && backup.matches.length !== 1)
    throw new Error('A game backup must contain exactly one game.');
  const all = [
    ...(backup.tournament ? [backup.tournament] : []),
    ...backup.matches,
    ...backup.sets,
    ...backup.events,
  ];
  if (new Set(all.map((x) => x.id)).size !== all.length)
    throw new Error('Backup contains duplicate IDs.');
  const matches = new Map(backup.matches.map((m) => [m.id, m]));
  const sets = new Map(backup.sets.map((s) => [s.id, s]));
  const events = new Map(backup.events.map((e) => [e.id, e]));
  for (const m of backup.matches)
    if (m.tournamentId !== backup.tournament?.id)
      throw new Error('Invalid tournament reference.');
  for (const s of backup.sets)
    if (!matches.has(s.matchId)) throw new Error('Invalid match reference.');
  for (const e of backup.events) {
    if (
      e.tournamentId !== backup.tournament?.id ||
      !matches.has(e.matchId) ||
      Date.parse(e.timestamp) !== e.epochMs
    )
      throw new Error('Invalid event reference or timestamp.');
    if (
      e.setId &&
      (sets.get(e.setId)?.matchId !== e.matchId ||
        sets.get(e.setId)?.setNumber !== e.setNumber)
    )
      throw new Error('Invalid set reference.');
    if (
      ['HOME_POINT', 'AWAY_POINT', 'UNDO', 'SET_STARTED', 'SET_ENDED'].includes(
        e.action,
      ) &&
      !e.setId
    )
      throw new Error('Scoring event is missing its set.');
    if (e.action === 'UNDO') {
      const target = events.get(e.targetEventId ?? '');
      if (
        !target ||
        !['HOME_POINT', 'AWAY_POINT'].includes(target.action) ||
        target.setId !== e.setId ||
        target.sequence >= e.sequence
      )
        throw new Error('Invalid undo reference.');
    }
  }
  for (const m of backup.matches) {
    const ownSets = backup.sets.filter((s) => s.matchId === m.id);
    if (
      ownSets.filter((s) => !s.completedAt).length > 1 ||
      new Set(ownSets.map((s) => s.setNumber)).size !== ownSets.length ||
      (m.status === 'completed' &&
        (!m.completedAt || ownSets.some((s) => !s.completedAt)))
    )
      throw new Error('Invalid match/set state.');
  }
  if (
    new Set(backup.events.map((e) => e.sequence)).size !== backup.events.length
  )
    throw new Error('Duplicate event sequence.');
  const mapping = new Map(all.map((x) => [x.id, id()]));
  const remap = (value: string) => mapping.get(value)!;
  const offset = data.events.reduce((n, e) => Math.max(n, e.sequence), 0);
  if (backup.tournament)
    data.tournaments.push({
      ...backup.tournament,
      id: remap(backup.tournament.id),
    });
  data.matches.push(
    ...backup.matches.map((m) => ({
      ...m,
      id: remap(m.id),
      tournamentId: m.tournamentId ? remap(m.tournamentId) : undefined,
    })),
  );
  data.sets.push(
    ...backup.sets.map((s) => ({
      ...s,
      id: remap(s.id),
      matchId: remap(s.matchId),
    })),
  );
  data.events.push(
    ...backup.events.map((e) => ({
      ...e,
      id: remap(e.id),
      tournamentId: e.tournamentId ? remap(e.tournamentId) : undefined,
      matchId: remap(e.matchId),
      setId: e.setId ? remap(e.setId) : undefined,
      targetEventId: e.targetEventId ? remap(e.targetEventId) : undefined,
      sequence: e.sequence + offset,
    })),
  );
  return remap(backup.tournament?.id ?? backup.matches[0].id);
}
export function matchCsv(data: Snapshot, matchId: string) {
  const match = data.matches.find((m) => m.id === matchId)!;
  const tournament = data.tournaments.find((t) => t.id === match.tournamentId)!;
  const headers = [
    'tournament_id',
    'tournament_name',
    'match_id',
    'set_number',
    'timestamp',
    'epoch_ms',
    'action',
    'home_team',
    'away_team',
    'home_score',
    'away_score',
    'target_event_id',
    'event_id',
    'set_id',
    'sequence',
    'sync_number',
    'home_color',
    'away_color',
  ];
  const escape = (value: unknown) =>
    `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = orderedEvents(
    data.events.filter((e) => e.matchId === matchId),
  ).map((e) =>
    [
      tournament?.id,
      tournament?.name,
      match.id,
      e.setNumber,
      e.timestamp,
      e.epochMs,
      e.action,
      match.homeTeam,
      match.awayTeam,
      e.homeScore,
      e.awayScore,
      e.targetEventId,
      e.id,
      e.setId,
      e.sequence,
      e.syncNumber,
      match.homeColor,
      match.awayColor,
    ]
      .map(escape)
      .join(','),
  );
  return [headers.join(','), ...rows].join('\r\n') + '\r\n';
}
export function download(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[^a-zA-Z0-9._-]/g, '-');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
