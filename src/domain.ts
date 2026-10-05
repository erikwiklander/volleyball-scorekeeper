import type { Broadcast, SyncEntry } from './live/model';
export type Sport = 'volleyball' | 'football';
export const sportOf = (record?: { sport?: Sport }): Sport =>
  record?.sport ?? 'volleyball';
export const periodLabel = (sport: Sport, number: number) =>
  sport === 'football'
    ? number > 4
      ? `OT ${number - 4}`
      : `Quarter ${number}`
    : `Set ${number}`;
export const footballScores = {
  touchdown: { label: 'Touchdown', points: 6 },
  kick: { label: 'Extra-point kick', points: 2 },
  conversion: { label: 'Run / pass conversion', points: 1 },
  fieldGoal: { label: 'Field goal', points: 3 },
  safety: { label: 'Safety', points: 2 },
} as const;
export type FootballScore = keyof typeof footballScores;
export interface Team {
  sport?: Sport;
  id: string;
  name: string;
  shortName?: string;
  logo?: string;
  primaryColor: string;
  secondaryColor?: string;
  createdAt: string;
  updatedAt: string;
}
export interface MatchTeam {
  teamId: string;
  displayName: string;
  shortName?: string;
  color: string;
  secondaryColor?: string;
  logo?: string;
}
export interface Tournament {
  id: string;
  name: string;
  date?: string;
  location?: string;
  defaultTeamId?: string;
  defaultTeamName?: string;
  defaultTeamShortName?: string;
  createdAt: string;
  updatedAt: string;
}
export interface Match {
  sport?: Sport;
  id: string;
  tournamentId?: string;
  home?: MatchTeam;
  away?: MatchTeam;
  homeTeam: string;
  awayTeam: string;
  homeColor?: string;
  awayColor?: string;
  status: 'not_started' | 'in_progress' | 'completed';
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}
// The existing sets store holds volleyball sets or football quarters/overtime.
// Keeping its IDs and references preserves older local records and backups.
export interface VolleyballSet {
  id: string;
  matchId: string;
  setNumber: number;
  startedAt: string;
  completedAt?: string;
}
export const actions = [
  'HOME_POINT',
  'AWAY_POINT',
  'UNDO',
  'SET_STARTED',
  'SET_ENDED',
  'MATCH_STARTED',
  'MATCH_ENDED',
  'SYNC_MARKER',
] as const;
export type ScoreAction = (typeof actions)[number];
export interface ScoreEvent {
  id: string;
  tournamentId?: string;
  matchId: string;
  setId?: string;
  setNumber?: number;
  timestamp: string;
  epochMs: number;
  sequence: number;
  action: ScoreAction;
  scoringType?: FootballScore;
  homeScore: number;
  awayScore: number;
  targetEventId?: string;
  syncNumber?: number;
  syncCue?: 'black-white-black-v1';
}
export interface AppState {
  id: 'current';
  activeTournamentId?: string;
  activeMatchId?: string;
  activeSetId?: string;
}
export interface Snapshot {
  broadcasts: Broadcast[];
  syncQueue: SyncEntry[];
  teams: Team[];
  tournaments: Tournament[];
  matches: Match[];
  sets: VolleyballSet[];
  events: ScoreEvent[];
  appState: AppState;
}
export const emptySnapshot = (): Snapshot => ({
  broadcasts: [],
  syncQueue: [],
  teams: [],
  tournaments: [],
  matches: [],
  sets: [],
  events: [],
  appState: { id: 'current' },
});
export const id = () => crypto.randomUUID();
export const orderedEvents = (events: ScoreEvent[]) =>
  [...events].sort(
    (a, b) =>
      a.epochMs - b.epochMs ||
      a.sequence - b.sequence ||
      a.id.localeCompare(b.id),
  );
// Undo references are resolved independently of wall-clock ordering: changing the
// device clock backwards must never resurrect an undone point.
export function activePoints(events: ScoreEvent[]) {
  const undone = new Set(
    events.filter((e) => e.action === 'UNDO').map((e) => e.targetEventId),
  );
  return events
    .filter(
      (e) =>
        (e.action === 'HOME_POINT' || e.action === 'AWAY_POINT') &&
        !undone.has(e.id),
    )
    .sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
}
export function calculateScore(events: ScoreEvent[]) {
  return activePoints(events).reduce(
    (score, e) => ({
      homeScore:
        score.homeScore +
        Number(e.action === 'HOME_POINT') *
          (e.scoringType ? footballScores[e.scoringType].points : 1),
      awayScore:
        score.awayScore +
        Number(e.action === 'AWAY_POINT') *
          (e.scoringType ? footballScores[e.scoringType].points : 1),
    }),
    { homeScore: 0, awayScore: 0 },
  );
}
export function setScore(data: Snapshot, setId: string) {
  return calculateScore(data.events.filter((e) => e.setId === setId));
}
export function matchResult(data: Snapshot, matchId: string) {
  if (sportOf(data.matches.find((m) => m.id === matchId)) === 'football') {
    const total = calculateScore(
      data.events.filter((e) => e.matchId === matchId),
    );
    return { home: total.homeScore, away: total.awayScore, tied: 0 };
  }
  return data.sets
    .filter((s) => s.matchId === matchId && s.completedAt)
    .reduce(
      (r, s) => {
        const score = setScore(data, s.id);
        return {
          home: r.home + Number(score.homeScore > score.awayScore),
          away: r.away + Number(score.awayScore > score.homeScore),
          tied: r.tied + Number(score.homeScore === score.awayScore),
        };
      },
      { home: 0, away: 0, tied: 0 },
    );
}
export function appendEvent(
  data: Snapshot,
  match: Match,
  action: ScoreAction,
  epochMs: number,
  set?: VolleyballSet,
  targetEventId?: string,
  scoringType?: FootballScore,
) {
  const event: ScoreEvent = {
    id: id(),
    tournamentId: match.tournamentId,
    matchId: match.id,
    setId: set?.id,
    setNumber: set?.setNumber,
    timestamp: new Date(epochMs).toISOString(),
    epochMs,
    sequence: data.events.reduce((max, e) => Math.max(max, e.sequence), 0) + 1,
    action,
    homeScore: 0,
    awayScore: 0,
    targetEventId,
    ...(scoringType ? { scoringType } : {}),
  };
  if (action === 'SYNC_MARKER') {
    const markers = data.events.filter(
      (e) => e.matchId === match.id && e.action === 'SYNC_MARKER',
    );
    event.syncNumber =
      Math.max(markers.length, ...markers.map((e) => e.syncNumber ?? 0)) + 1;
  }
  data.events.push(event);
  Object.assign(
    event,
    sportOf(match) === 'football'
      ? calculateScore(data.events.filter((e) => e.matchId === match.id))
      : set
        ? setScore(data, set.id)
        : { homeScore: 0, awayScore: 0 },
  );
  match.updatedAt = event.timestamp;
  return event;
}
export function scoreAction(
  data: Snapshot,
  matchId: string,
  setId: string,
  action: 'HOME_POINT' | 'AWAY_POINT' | 'UNDO' | 'SYNC_MARKER',
  at: number,
  scoringType?: FootballScore,
) {
  const match = data.matches.find((m) => m.id === matchId);
  const set = data.sets.find((s) => s.id === setId && s.matchId === matchId);
  if (!match || match.status !== 'in_progress' || !set || set.completedAt)
    throw new Error(
      'This set is no longer active. Reopen the match to see its latest state.',
    );
  if (action === 'HOME_POINT' || action === 'AWAY_POINT') {
    if (
      sportOf(match) === 'football'
        ? !scoringType || !Object.hasOwn(footballScores, scoringType)
        : !!scoringType
    )
      throw new Error('Choose a scoring action for this sport.');
  } else if (scoringType) throw new Error('Invalid scoring action.');
  const target =
    action === 'UNDO'
      ? activePoints(data.events.filter((e) => e.setId === setId)).at(-1)
      : undefined;
  if (action === 'UNDO' && !target)
    throw new Error('There are no points left to undo.');
  appendEvent(data, match, action, at, set, target?.id, scoringType);
  data.appState = {
    id: 'current',
    activeTournamentId: match.tournamentId,
    activeMatchId: match.id,
    activeSetId: set.id,
  };
}
export function startSet(data: Snapshot, matchId: string, at: number) {
  const match = data.matches.find((m) => m.id === matchId);
  if (
    !match ||
    match.status === 'completed' ||
    data.sets.some((s) => s.matchId === matchId && !s.completedAt)
  )
    throw new Error('A new set cannot be started right now.');
  const time = new Date(at).toISOString();
  if (!match.startedAt) {
    match.startedAt = time;
    match.status = 'in_progress';
    appendEvent(data, match, 'MATCH_STARTED', at);
  }
  const set: VolleyballSet = {
    id: id(),
    matchId,
    setNumber: data.sets.filter((s) => s.matchId === matchId).length + 1,
    startedAt: time,
  };
  data.sets.push(set);
  appendEvent(data, match, 'SET_STARTED', at, set);
  data.appState = {
    id: 'current',
    activeTournamentId: match.tournamentId,
    activeMatchId: match.id,
    activeSetId: set.id,
  };
}
export function endSet(
  data: Snapshot,
  matchId: string,
  setId: string,
  at: number,
) {
  const match = data.matches.find((m) => m.id === matchId);
  const set = data.sets.find((s) => s.id === setId && s.matchId === matchId);
  if (!match || match.status !== 'in_progress' || !set || set.completedAt)
    throw new Error('This set has already ended.');
  appendEvent(data, match, 'SET_ENDED', at, set);
  set.completedAt = new Date(at).toISOString();
  data.appState = {
    id: 'current',
    activeTournamentId: match.tournamentId,
    activeMatchId: matchId,
  };
}
export function completeMatch(data: Snapshot, matchId: string, at: number) {
  const match = data.matches.find((m) => m.id === matchId);
  if (
    !match ||
    match.status !== 'in_progress' ||
    !data.sets.some((s) => s.matchId === matchId) ||
    data.sets.some((s) => s.matchId === matchId && !s.completedAt)
  )
    throw new Error('End the current set before completing the match.');
  const last = data.sets
    .filter((s) => s.matchId === matchId)
    .sort((a, b) => a.setNumber - b.setNumber)
    .at(-1);
  appendEvent(data, match, 'MATCH_ENDED', at, last);
  match.status = 'completed';
  match.completedAt = new Date(at).toISOString();
  if (data.appState.activeMatchId === matchId)
    data.appState = { id: 'current', activeTournamentId: match.tournamentId };
}

export function syncMarker(
  data: Snapshot,
  matchId: string,
  at: number,
  expectedSetId?: string,
) {
  const match = data.matches.find((m) => m.id === matchId);
  if (!match || match.status === 'completed')
    throw new Error('This match is no longer active.');
  const set = data.sets.find((s) => s.matchId === matchId && !s.completedAt);
  if (!set || (expectedSetId && set.id !== expectedSetId))
    throw new Error(
      'Start or reopen the active set before adding a sync marker.',
    );
  return appendEvent(data, match, 'SYNC_MARKER', at, set);
}

export interface TeamDraft {
  sport?: Sport;
  teamId?: string;
  name: string;
  shortName?: string;
  primaryColor: string;
  secondaryColor?: string;
  logo?: string;
}
export function saveAppearance(
  data: Snapshot,
  draft: TeamDraft,
  now: string,
): MatchTeam {
  if (!draft.name.trim()) throw new Error('Enter both team names.');
  let teamId = draft.teamId;
  if (
    teamId &&
    !data.teams.some((t) => t.id === teamId && sportOf(t) === sportOf(draft))
  )
    throw new Error('Selected team no longer exists.');
  if (!teamId) {
    teamId = id();
    data.teams.push({
      id: teamId,
      sport: draft.sport,
      name: draft.name.trim(),
      shortName: draft.shortName,
      primaryColor: draft.primaryColor,
      secondaryColor: draft.secondaryColor,
      logo: draft.logo,
      createdAt: now,
      updatedAt: now,
    });
  }
  return {
    teamId,
    displayName: draft.name.trim(),
    shortName: draft.shortName,
    color: draft.primaryColor,
    secondaryColor: draft.secondaryColor,
    logo: draft.logo,
  };
}

// Explicitly deleting a match removes its complete local record in one mutation.
// Ordinary score corrections still append UNDO events and retain history.
export function deleteMatch(data: Snapshot, matchId: string) {
  if (!data.matches.some((match) => match.id === matchId))
    throw new Error('This match no longer exists.');
  data.matches = data.matches.filter((match) => match.id !== matchId);
  data.sets = data.sets.filter((set) => set.matchId !== matchId);
  data.events = data.events.filter((event) => event.matchId !== matchId);
  if (data.appState.activeMatchId === matchId) {
    data.appState = {
      id: 'current',
      activeTournamentId: data.appState.activeTournamentId,
    };
  }
}
