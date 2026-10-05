import { z } from 'zod';
import {
  actions,
  footballScores,
  sportOf,
  id,
  orderedEvents,
  type Snapshot,
} from './domain';
const text = z.string().min(1);
const time = z.iso.datetime();
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
// Embedded raster images remain available offline and cannot load remote content.
const logo = z
  .string()
  .max(1_500_000)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/);
const sport = z.enum(['volleyball', 'football']).optional();
const teamSchema = z.object({
  sport,
  id: text,
  name: text,
  shortName: z.string().optional(),
  logo: logo.optional(),
  primaryColor: color,
  secondaryColor: color.optional(),
  createdAt: time,
  updatedAt: time,
});
const appearanceSchema = z.object({
  teamId: text,
  displayName: text,
  shortName: z.string().optional(),
  color,
  secondaryColor: color.optional(),
  logo: logo.optional(),
});
const tournamentSchema = z.object({
  id: text,
  name: text,
  date: z.string().optional(),
  location: z.string().optional(),
  defaultTeamId: text.optional(),
  defaultTeamName: z.string().optional(),
  defaultTeamShortName: z.string().optional(),
  createdAt: time,
  updatedAt: time,
});
const matchSchema = z.object({
  sport,
  id: text,
  tournamentId: text.optional(),
  home: appearanceSchema.optional(),
  away: appearanceSchema.optional(),
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
  scoringType: z
    .enum(['touchdown', 'kick', 'conversion', 'fieldGoal', 'safety'])
    .optional(),
  homeScore: z.number().int().nonnegative(),
  awayScore: z.number().int().nonnegative(),
  targetEventId: text.optional(),
  syncCue: z.literal('black-white-black-v1').optional(),
  syncNumber: z.number().int().positive().optional(),
});
const backupSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  teams: z.array(teamSchema).default([]),
  tournament: tournamentSchema.optional(),
  matches: z.array(matchSchema),
  sets: z.array(setSchema),
  events: z.array(eventSchema),
});
function referencedTeams(
  data: Snapshot,
  matches: Snapshot['matches'],
  defaultTeamId?: string,
) {
  const ids = new Set([
    defaultTeamId,
    ...matches.flatMap((m) => [m.home?.teamId, m.away?.teamId]),
  ]);
  return data.teams.filter((team) => ids.has(team.id));
}
export function tournamentBackup(data: Snapshot, tournamentId: string) {
  const tournament = data.tournaments.find((t) => t.id === tournamentId);
  if (!tournament) throw new Error('Tournament not found.');
  const matches = data.matches.filter((m) => m.tournamentId === tournamentId);
  const ids = new Set(matches.map((m) => m.id));
  return {
    schemaVersion: matches.some((m) => sportOf(m) === 'football') ? 3 : 2,
    exportedAt: new Date().toISOString(),
    tournament,
    teams: referencedTeams(data, matches, tournament.defaultTeamId),
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
    schemaVersion: sportOf(match) === 'football' ? 3 : 2,
    exportedAt: new Date().toISOString(),
    teams: referencedTeams(data, [match]),
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
    ...backup.teams,
    ...backup.matches,
    ...backup.sets,
    ...backup.events,
  ];
  if (new Set(all.map((x) => x.id)).size !== all.length)
    throw new Error('Backup contains duplicate IDs.');
  const teamIds = new Set(backup.teams.map((t) => t.id));
  if (
    backup.tournament?.defaultTeamId &&
    !teamIds.has(backup.tournament.defaultTeamId)
  )
    throw new Error('Invalid default team reference.');
  for (const match of backup.matches) {
    for (const side of ['home', 'away'] as const) {
      const appearance = match[side];
      if (
        appearance &&
        (!teamIds.has(appearance.teamId) ||
          appearance.displayName !== match[`${side}Team`] ||
          appearance.color !== match[`${side}Color`])
      )
        throw new Error('Invalid match team appearance.');
    }
  }
  const matches = new Map(backup.matches.map((m) => [m.id, m]));
  const sets = new Map(backup.sets.map((s) => [s.id, s]));
  const events = new Map(backup.events.map((e) => [e.id, e]));
  for (const m of backup.matches)
    if (m.tournamentId !== backup.tournament?.id)
      throw new Error('Invalid tournament reference.');
  for (const s of backup.sets)
    if (!matches.has(s.matchId)) throw new Error('Invalid match reference.');
  if (
    backup.schemaVersion < 3 &&
    backup.matches.some((m) => sportOf(m) === 'football')
  )
    throw new Error('Football requires backup version 3.');
  for (const e of backup.events) {
    const football = sportOf(matches.get(e.matchId)) === 'football';
    const scoring = e.action === 'HOME_POINT' || e.action === 'AWAY_POINT';
    if (scoring && football ? !e.scoringType : !!e.scoringType)
      throw new Error('Invalid sport scoring event.');
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
  data.teams.push(...backup.teams.map((t) => ({ ...t, id: remap(t.id) })));
  if (backup.tournament)
    data.tournaments.push({
      ...backup.tournament,
      id: remap(backup.tournament.id),
      defaultTeamId: backup.tournament.defaultTeamId
        ? remap(backup.tournament.defaultTeamId)
        : undefined,
    });
  data.matches.push(
    ...backup.matches.map((m) => ({
      ...m,
      id: remap(m.id),
      home: m.home ? { ...m.home, teamId: remap(m.home.teamId) } : undefined,
      away: m.away ? { ...m.away, teamId: remap(m.away.teamId) } : undefined,
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
    'sync_cue',
    'home_color',
    'away_color',
    'home_team_id',
    'away_team_id',
    'home_short_name',
    'away_short_name',
    'home_secondary_color',
    'away_secondary_color',
    'sport',
    'quarter_number',
    'scoring_type',
    'points',
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
      e.syncCue,
      match.homeColor,
      match.awayColor,
      match.home?.teamId,
      match.away?.teamId,
      match.home?.shortName,
      match.away?.shortName,
      match.home?.secondaryColor,
      match.away?.secondaryColor,
      sportOf(match),
      sportOf(match) === 'football' ? e.setNumber : '',
      e.scoringType ?? '',
      e.scoringType
        ? footballScores[e.scoringType].points
        : ['HOME_POINT', 'AWAY_POINT'].includes(e.action)
          ? 1
          : '',
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
