import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { flushSync } from 'react-dom';
import { HOME_COLOR, AWAY_COLOR, teamButtonStyle } from './colors';
import type { IDBPDatabase } from 'idb';
import {
  activePoints,
  completeMatch,
  emptySnapshot,
  endSet,
  id,
  matchResult,
  orderedEvents,
  scoreAction,
  setScore,
  startSet,
  syncMarker,
  type Snapshot,
  type Tournament,
} from './domain';
import { mutate, openDatabase, readSnapshot } from './db';
import {
  download,
  gameBackup,
  importBackup,
  matchCsv,
  tournamentBackup,
} from './export';

type Page =
  | { kind: 'home' }
  | { kind: 'tournament'; id: string }
  | { kind: 'match'; id: string };
type Modal =
  | { kind: 'tournament'; tournament?: Tournament }
  | { kind: 'newMatch'; tournamentId?: string }
  | { kind: 'endSet'; matchId: string; setId: string }
  | { kind: 'complete'; matchId: string }
  | { kind: 'delete'; tournament: Tournament };
const dateLabel = (value?: string) =>
  value
    ? new Date(
        value.length === 10 ? `${value}T12:00:00` : value,
      ).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '';
const timeLabel = (value: string) =>
  new Date(value).toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });

export default function App() {
  const [data, setData] = useState<Snapshot>(emptySnapshot);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [page, setPage] = useState<Page>({ kind: 'home' });
  const [modal, setModal] = useState<Modal>();
  const [offlineReady, setOfflineReady] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [showEvents, setShowEvents] = useState(false);
  const [flash, setFlash] = useState('');
  const [syncFlash, setSyncFlash] = useState<{
    number: number;
    timestamp: string;
    home: string;
    away: string;
    saved: boolean;
  }>();
  const syncDialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    if (syncFlash) syncDialog.current?.showModal();
    else syncDialog.current?.close();
  }, [syncFlash]);
  useEffect(() => {
    if (!syncFlash?.saved) return;
    const timer = window.setTimeout(() => setSyncFlash(undefined), 3000);
    return () => window.clearTimeout(timer);
  }, [syncFlash]);
  const db = useRef<IDBPDatabase>(undefined);
  const channel = useRef<BroadcastChannel>(undefined);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let alive = true;
    openDatabase()
      .then(async (connection) => {
        if (!alive) {
          connection.close();
          return;
        }
        db.current = connection;
        setData(await readSnapshot(connection));
        setReady(true);
      })
      .catch(() =>
        setError(
          'Device storage could not be opened. Enable browser storage and reload to score safely.',
        ),
      );
    const refresh = () => {
      if (db.current && !saving.current)
        readSnapshot(db.current)
          .then((d) => {
            if (alive) setData(d);
          })
          .catch(() => setError('Could not refresh device storage.'));
    };
    channel.current =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel('volleyball-scorekeeper')
        : undefined;
    if (channel.current) channel.current.onmessage = refresh;
    const visibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const available = () => setOfflineReady(true);
    const failed = () =>
      setNotice(
        'Offline setup failed. Reconnect and reload before using the app offline.',
      );
    const connection = () => setOnline(navigator.onLine);
    window.addEventListener('offline-ready', available);
    window.addEventListener('offline-failed', failed);
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    document.addEventListener('visibilitychange', visibility);
    navigator.serviceWorker?.getRegistration().then((r) => {
      if (alive && r?.active) setOfflineReady(true);
    });
    return () => {
      alive = false;
      db.current?.close();
      channel.current?.close();
      window.removeEventListener('offline-ready', available);
      window.removeEventListener('offline-failed', failed);
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useEffect(() => {
    if (modal) dialog.current?.showModal();
    else dialog.current?.close();
  }, [modal]);
  const match =
    page.kind === 'match'
      ? data.matches.find((m) => m.id === page.id)
      : undefined;
  const tournament = data.tournaments.find(
    (t) =>
      t.id === (page.kind === 'tournament' ? page.id : match?.tournamentId),
  );
  const sets = data.sets
    .filter((s) => s.matchId === match?.id)
    .sort((a, b) => a.setNumber - b.setNumber);
  const currentSet = sets.find((s) => !s.completedAt);
  const scoring = !!(currentSet && match?.status === 'in_progress');
  useEffect(() => {
    if (!scoring) return;
    let lock: WakeLockSentinel | undefined;
    let stopped = false;
    const request = async () => {
      if (document.visibilityState !== 'visible' || lock) return;
      try {
        const acquired = await navigator.wakeLock?.request('screen');
        if (stopped) await acquired?.release();
        else {
          lock = acquired;
          acquired?.addEventListener('release', () => {
            lock = undefined;
          });
        }
      } catch {
        /* Scoring works without a wake lock. */
      }
    };
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    void request();
    document.addEventListener('visibilitychange', request);
    window.addEventListener('beforeunload', unload);
    return () => {
      stopped = true;
      void lock?.release();
      document.removeEventListener('visibilitychange', request);
      window.removeEventListener('beforeunload', unload);
    };
  }, [scoring, match?.id]);
  async function commit(change: (draft: Snapshot) => void, after?: () => void) {
    if (!db.current || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await mutate(db.current, change);
      setData(next);
      channel.current?.postMessage('changed');
      after?.();
    } catch (err) {
      setSyncFlash(undefined);
      setError(
        `Not saved. ${err instanceof Error ? err.message : 'Device storage failed.'} Please try again before continuing.`,
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function navigate(next: Page) {
    setPage(next);
    setShowEvents(false);
    setNotice('');
  }
  function openMatch(matchId: string) {
    const m = data.matches.find((item) => item.id === matchId)!;
    if (m.status === 'completed') {
      navigate({ kind: 'match', id: matchId });
      return;
    }
    void commit(
      (d) => {
        const latest = d.matches.find((item) => item.id === matchId);
        if (!latest) throw new Error('Match no longer exists.');
        d.appState = {
          id: 'current',
          activeTournamentId: latest.tournamentId,
          activeMatchId: matchId,
          activeSetId: d.sets.find(
            (s) => s.matchId === matchId && !s.completedAt,
          )?.id,
        };
      },
      () => navigate({ kind: 'match', id: matchId }),
    );
  }
  function addPoint(action: 'HOME_POINT' | 'AWAY_POINT' | 'UNDO') {
    if (!match || !currentSet) return;
    const at = Date.now();
    void commit(
      (d) => scoreAction(d, match.id, currentSet.id, action, at),
      () => {
        navigator.vibrate?.(15);
        setFlash(action);
        setTimeout(() => setFlash(''), 180);
      },
    );
  }
  function flashSync() {
    if (!match || syncFlash) return;
    void commit(
      (d) => {
        // Capture the instant at the visual transition, after the DB read, not
        // after the save completes. The dialog remains pending until committed.
        const event = syncMarker(d, match.id, Date.now());
        const latest = d.matches.find((m) => m.id === match.id)!;
        flushSync(() =>
          setSyncFlash({
            number: event.syncNumber!,
            timestamp: event.timestamp,
            home: latest.homeTeam,
            away: latest.awayTeam,
            saved: false,
          }),
        );
      },
      () => {
        setSyncFlash((current) =>
          current ? { ...current, saved: true } : undefined,
        );
        setNotice(
          'Sync marker saved. Match the first bright frame to its exported timestamp.',
        );
      },
    );
  }
  function exportTournament(t: Tournament) {
    download(
      JSON.stringify(tournamentBackup(data, t.id), null, 2),
      `${t.name}.json`,
      'application/json',
    );
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 20_000_000)
        throw new Error('Choose a backup smaller than 20 MB.');
      const raw: unknown = JSON.parse(await file.text());
      let importedPage: Page = { kind: 'home' };
      let importedTournament = false;
      await commit(
        (d) => {
          const newId = importBackup(raw, d);
          importedTournament = d.tournaments.some((t) => t.id === newId);
          importedPage = {
            kind: importedTournament ? 'tournament' : 'match',
            id: newId,
          };
        },
        () => {
          navigate(importedPage);
          setNotice(
            importedTournament
              ? 'Backup imported as a new tournament.'
              : 'Backup imported as a new game.',
          );
        },
      );
    } catch (error) {
      console.error('Backup read failed', error);
      setError(
        error instanceof DOMException && error.name === 'NotReadableError'
          ? 'The browser could not read this file. Select a local copy and try again. Nothing was imported.'
          : 'This file is not a valid Scorekeeper backup, or exceeds 20 MB. Nothing was imported.',
      );
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const value = (key: string) => String(fields.get(key) ?? '').trim();
    const at = Date.now();
    const now = new Date(at).toISOString();
    if (modal?.kind === 'tournament') {
      if (!value('name')) return;
      const tournamentId = modal.tournament?.id ?? id();
      void commit(
        (d) => {
          const existing = d.tournaments.find((t) => t.id === tournamentId);
          const record: Tournament = {
            id: tournamentId,
            name: value('name'),
            date: value('date') || undefined,
            location: value('location') || undefined,
            defaultTeamName: value('defaultTeamName') || undefined,
            defaultTeamShortName: value('defaultTeamShortName') || undefined,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          };
          if (existing) Object.assign(existing, record);
          else d.tournaments.push(record);
          d.appState.activeTournamentId = tournamentId;
        },
        () => {
          setModal(undefined);
          navigate({ kind: 'tournament', id: tournamentId });
        },
      );
    }
    if (modal?.kind === 'newMatch') {
      if (!value('homeTeam') || !value('awayTeam')) return;
      const matchId = id();
      const tournamentId = modal.tournamentId;
      void commit(
        (d) => {
          if (tournamentId && !d.tournaments.some((t) => t.id === tournamentId))
            throw new Error('Tournament no longer exists.');
          d.matches.push({
            id: matchId,
            tournamentId,
            homeTeam: value('homeTeam'),
            awayTeam: value('awayTeam'),
            homeColor: value('homeColor'),
            awayColor: value('awayColor'),
            status: 'not_started',
            createdAt: now,
            updatedAt: now,
          });
          d.appState = {
            id: 'current',
            activeTournamentId: tournamentId,
            activeMatchId: matchId,
          };
        },
        () => {
          setModal(undefined);
          navigate({ kind: 'match', id: matchId });
          void navigator.storage?.persist?.();
        },
      );
    }
    if (
      modal?.kind === 'delete' &&
      value('confirm') === modal.tournament.name
    ) {
      const tournamentId = modal.tournament.id;
      void commit(
        (d) => {
          const matches = new Set(
            d.matches
              .filter((m) => m.tournamentId === tournamentId)
              .map((m) => m.id),
          );
          d.tournaments = d.tournaments.filter((t) => t.id !== tournamentId);
          d.matches = d.matches.filter((m) => !matches.has(m.id));
          d.sets = d.sets.filter((s) => !matches.has(s.matchId));
          d.events = d.events.filter((e) => e.tournamentId !== tournamentId);
          if (d.appState.activeTournamentId === tournamentId)
            d.appState = { id: 'current' };
        },
        () => {
          setModal(undefined);
          navigate({ kind: 'home' });
        },
      );
    }
  }
  const standaloneGames = data.matches
    .filter((m) => !m.tournamentId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const unfinished = data.matches
    .filter((m) => m.status !== 'completed')
    .sort(
      (a, b) =>
        Number(b.id === data.appState.activeMatchId) -
          Number(a.id === data.appState.activeMatchId) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
  function matchCard(m: (typeof data.matches)[number]) {
    const active = data.sets.find((s) => s.matchId === m.id && !s.completedAt);
    const score = active && setScore(data, active.id);
    const result = matchResult(data, m.id);
    return (
      <button
        className="list-card"
        key={m.id}
        onClick={() => openMatch(m.id)}
        disabled={busy}
      >
        <span>
          <strong>
            {m.homeTeam} <span className="muted">vs</span> {m.awayTeam}
          </strong>
          <small>
            {m.status === 'completed'
              ? `Final · ${result.home}–${result.away} sets${result.tied ? ` · ${result.tied} tied` : ''}`
              : active
                ? `In progress · Set ${active.setNumber} · ${score!.homeScore}–${score!.awayScore}`
                : m.status === 'not_started'
                  ? 'Ready to start Set 1'
                  : 'Between sets · Ready to resume'}
          </small>
        </span>
        <span aria-hidden="true">↗</span>
      </button>
    );
  }
  const score = currentSet
    ? setScore(data, currentSet.id)
    : { homeScore: 0, awayScore: 0 };
  const result = match ? matchResult(data, match.id) : undefined;
  return (
    <div className={`shell ${scoring ? 'is-scoring' : ''}`}>
      <header className="brand">
        <div className="brand-icon" aria-hidden="true">
          ◉
        </div>
        <div>
          <span className="eyebrow">COURTSIDE COMPANION</span>
          <div className="brand-title">
            Scorekeeper<span className="brand-dot">.</span>
          </div>
        </div>
        <span className="connection">
          {!online ? 'Offline' : offlineReady ? 'Offline ready' : 'On device'}
        </span>
      </header>
      {error && (
        <div className="error" role="alert">
          {error}
          <button onClick={() => setError('')}>Dismiss</button>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {!ready ? (
        <p>
          {error
            ? 'Storage is unavailable.'
            : 'Opening your courtside notebook…'}
        </p>
      ) : (
        <main>
          {page.kind === 'home' && (
            <>
              <div className="intro">
                <span className="eyebrow">EVERY POINT. EVERY MATCH.</span>
                <h1>Stay in the game.</h1>
                <p>Two teams. One game. Ready when you are.</p>
                <button
                  className="primary new-game"
                  onClick={() => setModal({ kind: 'newMatch' })}
                  disabled={busy}
                >
                  + New game
                </button>
              </div>
              {unfinished.length > 0 && (
                <section className="resume">
                  <span className="eyebrow">PICK UP WHERE YOU LEFT OFF</span>
                  <h2>
                    {unfinished[0].homeTeam} vs {unfinished[0].awayTeam}
                  </h2>
                  <p>
                    {data.tournaments.find(
                      (t) => t.id === unfinished[0].tournamentId,
                    )?.name ?? 'One-off game'}
                    {(() => {
                      const s = data.sets.find(
                        (s) => s.matchId === unfinished[0].id && !s.completedAt,
                      );
                      const v = s && setScore(data, s.id);
                      return s
                        ? ` · Set ${s.setNumber} · ${v!.homeScore}–${v!.awayScore}`
                        : ' · Ready to resume';
                    })()}
                  </p>
                  <button
                    className="lime"
                    onClick={() => openMatch(unfinished[0].id)}
                    disabled={busy}
                  >
                    Resume match <span aria-hidden="true">→</span>
                  </button>
                </section>
              )}
              <section>
                <div className="section-heading">
                  <h2>
                    Your games{' '}
                    <span className="count">{standaloneGames.length}</span>
                  </h2>
                </div>
                {standaloneGames.length ? (
                  <div className="match-list">
                    {standaloneGames.map(matchCard)}
                  </div>
                ) : (
                  <div className="empty">
                    <h3>A fresh court.</h3>
                    <p>
                      Start a game with just team names and colors. No
                      tournament setup needed.
                    </p>
                  </div>
                )}
              </section>
              <details className="optional-tournaments">
                <summary>
                  Tournaments (optional) · {data.tournaments.length}
                </summary>
                <p>Group several games together when you need to.</p>
                <button onClick={() => setModal({ kind: 'tournament' })}>
                  + New tournament
                </button>
                <div className="tournaments">
                  {[...data.tournaments]
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                    .map((t) => (
                      <button
                        className="tournament-card"
                        key={t.id}
                        onClick={() =>
                          navigate({ kind: 'tournament', id: t.id })
                        }
                      >
                        <span className="eyebrow">
                          {dateLabel(t.date) || 'TOURNAMENT'}
                        </span>
                        <h3>{t.name}</h3>
                        <div className="card-bottom">
                          <span>
                            {
                              data.matches.filter(
                                (m) => m.tournamentId === t.id,
                              ).length
                            }{' '}
                            games
                          </span>
                          <span aria-hidden="true">↗</span>
                        </div>
                      </button>
                    ))}
                </div>
              </details>
              <div className="backup-row">
                <label className="file-button">
                  Import backup
                  <input
                    type="file"
                    accept=".json,application/json"
                    disabled={busy}
                    onChange={async (e) => {
                      const input = e.currentTarget;
                      await importFile(input.files?.[0]);
                      input.value = '';
                    }}
                  />
                </label>
                <span>Stored on this device. Export to keep a backup.</span>
              </div>
              <details className="help">
                <summary>Install & use offline</summary>
                <p>
                  On iPhone, open in Safari, tap Share, then Add to Home Screen.
                  On Android, use your browser’s Install app option. Wait for
                  “Offline ready” before leaving your connection.
                </p>
                <p>
                  Use the same browser or installed app to access your matches.
                  Clearing site data or browser storage removes local records.
                  Export game or tournament backups regularly. Timestamps use
                  your device’s clock; check it before recording.
                </p>
              </details>
            </>
          )}
          {page.kind === 'tournament' && tournament && (
            <>
              <button
                className="back"
                onClick={() => navigate({ kind: 'home' })}
              >
                ← All tournaments
              </button>
              <div className="intro">
                <span className="eyebrow">
                  {dateLabel(tournament.date) || 'TOURNAMENT'}
                  {tournament.location && ` · ${tournament.location}`}
                </span>
                <h1>{tournament.name}</h1>
                <p>
                  {tournament.defaultTeamName
                    ? `Following ${tournament.defaultTeamName}`
                    : 'One tournament. Every match in one place.'}
                </p>
              </div>
              <div className="toolbar">
                <button
                  onClick={() => setModal({ kind: 'tournament', tournament })}
                >
                  Edit details
                </button>
                <button onClick={() => exportTournament(tournament)}>
                  Export tournament JSON
                </button>
              </div>
              <div className="section-heading">
                <h2>Matches</h2>
                <button
                  className="primary"
                  onClick={() =>
                    setModal({ kind: 'newMatch', tournamentId: tournament.id })
                  }
                >
                  + New match
                </button>
              </div>
              <div className="match-list">
                {data.matches
                  .filter((m) => m.tournamentId === tournament.id)
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .map(matchCard)}
              </div>
              {!data.matches.some((m) => m.tournamentId === tournament.id) && (
                <div className="empty">
                  <h3>Ready for the first whistle.</h3>
                  <p>Add a match, then start Set 1 when play begins.</p>
                </div>
              )}
              <details className="danger-zone">
                <summary>Tournament management</summary>
                <p>
                  Deleting a tournament also deletes all its matches and events.
                </p>
                <button
                  className="danger"
                  onClick={() => setModal({ kind: 'delete', tournament })}
                >
                  Delete tournament
                </button>
              </details>
            </>
          )}
          {page.kind === 'match' && match && (
            <>
              <button
                className="back"
                onClick={() =>
                  navigate(
                    match.tournamentId
                      ? { kind: 'tournament', id: match.tournamentId }
                      : { kind: 'home' },
                  )
                }
              >
                ←{' '}
                {scoring
                  ? 'Save & leave scoring'
                  : tournament?.name || 'All games'}
              </button>
              <div className="match-heading">
                <span className="eyebrow">
                  {tournament?.name ?? 'One-off game'}
                </span>
                <h1>
                  {match.homeTeam} <span className="muted">vs</span>{' '}
                  {match.awayTeam}
                </h1>
                <div className="set-bar">
                  <span className="badge">
                    {scoring
                      ? `SET ${currentSet!.setNumber}`
                      : match.status === 'completed'
                        ? 'MATCH COMPLETE'
                        : 'BETWEEN SETS'}
                  </span>
                  <span>
                    {busy ? 'Saving…' : '✓ Saved on device'} · Sets{' '}
                    {result!.home}–{result!.away}
                  </span>
                </div>
              </div>
              {scoring ? (
                <>
                  <div className="score-grid">
                    <button
                      disabled={busy}
                      className={`score-button home ${flash === 'HOME_POINT' ? 'flash' : ''}`}
                      style={teamButtonStyle(match.homeColor ?? HOME_COLOR)}
                      onClick={() => addPoint('HOME_POINT')}
                      aria-label={`Add point for ${match.homeTeam}`}
                    >
                      <span className="team-side">HOME</span>
                      <span className="team-name">{match.homeTeam}</span>
                      <span className="score">{score.homeScore}</span>
                      <span className="point-label">+ POINT</span>
                    </button>
                    <button
                      disabled={busy}
                      className={`score-button away ${flash === 'AWAY_POINT' ? 'flash' : ''}`}
                      style={teamButtonStyle(match.awayColor ?? AWAY_COLOR)}
                      onClick={() => addPoint('AWAY_POINT')}
                      aria-label={`Add point for ${match.awayTeam}`}
                    >
                      <span className="team-side">AWAY</span>
                      <span className="team-name">{match.awayTeam}</span>
                      <span className="score">{score.awayScore}</span>
                      <span className="point-label">+ POINT</span>
                    </button>
                  </div>
                  <p className="sr-only" aria-live="polite">
                    {match.homeTeam} {score.homeScore}, {match.awayTeam}{' '}
                    {score.awayScore}
                  </p>
                  <div className="scoring-actions">
                    <button
                      className="undo"
                      onClick={() => addPoint('UNDO')}
                      disabled={
                        busy ||
                        !activePoints(
                          data.events.filter((e) => e.setId === currentSet!.id),
                        ).length
                      }
                    >
                      ↶ Undo last point
                    </button>
                    <button
                      onClick={() =>
                        setModal({
                          kind: 'endSet',
                          matchId: match.id,
                          setId: currentSet!.id,
                        })
                      }
                      disabled={busy}
                    >
                      End set
                    </button>
                  </div>
                </>
              ) : match.status !== 'completed' ? (
                <div className="between">
                  <h2>
                    {sets.length ? 'Take a breather.' : 'Ready when you are.'}
                  </h2>
                  <p>
                    {sets.length
                      ? 'The last set is saved. Start the next one or wrap up the match.'
                      : 'Start the first set at the whistle. Every point gets an exact timestamp.'}
                  </p>
                  <div className="toolbar">
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => {
                        const at = Date.now();
                        void commit((d) => startSet(d, match.id, at));
                      }}
                    >
                      Start Set {sets.length + 1}
                    </button>
                    {sets.length > 0 && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          setModal({ kind: 'complete', matchId: match.id })
                        }
                      >
                        Complete match
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <section className="final-score">
                  <span className="eyebrow">FINAL · SETS WON</span>
                  <div>
                    {result!.home} <span>–</span> {result!.away}
                  </div>
                  {result!.tied > 0 && <p>{result!.tied} tied set(s)</p>}
                </section>
              )}
              {match.status !== 'completed' && (
                <div className="sync-row">
                  <button onClick={flashSync} disabled={busy || !!syncFlash}>
                    ⊙ Video sync marker
                  </button>
                  <small>
                    Face the camera, then tap to flash a numbered sync card for
                    3 seconds.
                  </small>
                </div>
              )}
              {sets.length > 0 && (
                <section className="set-history">
                  <h2>Set history</h2>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Set</th>
                          <th>{match.homeTeam}</th>
                          <th>{match.awayTeam}</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sets.map((s) => {
                          const v = setScore(data, s.id);
                          return (
                            <tr key={s.id}>
                              <th>{s.setNumber}</th>
                              <td>{v.homeScore}</td>
                              <td>{v.awayScore}</td>
                              <td>{s.completedAt ? 'Final' : 'Live'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {match.startedAt && (
                <p className="match-times">
                  Started {dateLabel(match.startedAt)} ·{' '}
                  {timeLabel(match.startedAt)}
                  {match.completedAt && (
                    <>
                      {' '}
                      <br />
                      Ended {dateLabel(match.completedAt)} ·{' '}
                      {timeLabel(match.completedAt)}
                    </>
                  )}
                </p>
              )}
              <div className="toolbar">
                <button onClick={() => setShowEvents(!showEvents)}>
                  {showEvents ? 'Hide' : 'View'} events
                </button>
                <button
                  onClick={() =>
                    download(
                      matchCsv(data, match.id),
                      `${match.homeTeam}-vs-${match.awayTeam}.csv`,
                      'text/csv;charset=utf-8',
                    )
                  }
                >
                  Export match CSV
                </button>
              </div>
              {!match.tournamentId && (
                <div className="toolbar">
                  <button
                    onClick={() =>
                      download(
                        JSON.stringify(gameBackup(data, match.id), null, 2),
                        `${match.homeTeam}-vs-${match.awayTeam}.json`,
                        'application/json',
                      )
                    }
                  >
                    Export game backup
                  </button>
                </div>
              )}
              {showEvents && (
                <section>
                  <h2>Event history</h2>
                  <p className="muted">
                    Original actions are retained, including corrections. Times
                    shown in your current time zone.
                  </p>
                  <ol className="event-list">
                    {orderedEvents(
                      data.events.filter((e) => e.matchId === match.id),
                    ).map((e) => (
                      <li key={e.id}>
                        <time dateTime={e.timestamp}>
                          {dateLabel(e.timestamp)} · {timeLabel(e.timestamp)}
                        </time>
                        <span>
                          {e.action.replaceAll('_', ' ').toLowerCase()}
                          {e.syncNumber ? ` · Sync ${e.syncNumber}` : ''}
                          {e.setNumber ? ` · Set ${e.setNumber}` : ''}
                        </span>
                        <strong>
                          {e.homeScore}–{e.awayScore}
                        </strong>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </>
          )}
          {page.kind !== 'home' && !(match || tournament) && (
            <div className="empty">
              <h2>This record is no longer available.</h2>
              <button onClick={() => navigate({ kind: 'home' })}>
                Back to tournaments
              </button>
            </div>
          )}
        </main>
      )}
      <footer>
        <span>VOLLEYBALL SCOREKEEPER</span>
        <span>Made for the sidelines.</span>
      </footer>
      <dialog
        ref={syncDialog}
        className="sync-flash"
        aria-label="Video synchronization marker"
        onCancel={(e) => {
          if (!syncFlash?.saved) e.preventDefault();
          else setSyncFlash(undefined);
        }}
      >
        {syncFlash && (
          <div className="sync-card">
            <p className="sync-title">SYNC {syncFlash.number}</p>
            <h2>
              {syncFlash.home}
              <span>vs</span>
              {syncFlash.away}
            </h2>
            <time dateTime={syncFlash.timestamp}>{syncFlash.timestamp}</time>
            <p>{syncFlash.saved ? 'Marker saved' : 'Saving marker…'}</p>
            <button
              disabled={!syncFlash.saved}
              onClick={() => setSyncFlash(undefined)}
            >
              Back to match
            </button>
          </div>
        )}
      </dialog>
      <dialog
        ref={dialog}
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else setModal(undefined);
        }}
        onClose={() => {
          if (!busy) setModal(undefined);
        }}
      >
        {modal && (
          <form onSubmit={submit}>
            <div className="dialog-heading">
              <h2>
                {modal.kind === 'tournament'
                  ? modal.tournament
                    ? 'Edit tournament'
                    : 'New tournament'
                  : modal.kind === 'newMatch'
                    ? modal.tournamentId
                      ? 'New match'
                      : 'New game'
                    : modal.kind === 'endSet'
                      ? `End Set ${data.sets.find((s) => s.id === modal.setId)?.setNumber}?`
                      : modal.kind === 'complete'
                        ? 'Complete this match?'
                        : 'Delete tournament?'}
              </h2>
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {modal.kind === 'tournament' && (
              <>
                <label>
                  Tournament name
                  <input
                    name="name"
                    required
                    maxLength={120}
                    autoFocus
                    defaultValue={modal.tournament?.name}
                    placeholder="Grizzly Classic"
                  />
                </label>
                <div className="form-grid">
                  <label>
                    Date
                    <input
                      name="date"
                      type="date"
                      defaultValue={modal.tournament?.date}
                    />
                  </label>
                  <label>
                    Location
                    <input
                      name="location"
                      maxLength={160}
                      defaultValue={modal.tournament?.location}
                      placeholder="Optional"
                    />
                  </label>
                </div>
                <label>
                  Default team name
                  <input
                    name="defaultTeamName"
                    maxLength={100}
                    defaultValue={modal.tournament?.defaultTeamName}
                    placeholder="Vandegrift"
                  />
                </label>
                <label>
                  Team short name
                  <input
                    name="defaultTeamShortName"
                    maxLength={20}
                    defaultValue={modal.tournament?.defaultTeamShortName}
                    placeholder="VHS (optional)"
                  />
                </label>
              </>
            )}
            {modal.kind === 'newMatch' && (
              <>
                <label>
                  Home team
                  <input
                    name="homeTeam"
                    required
                    maxLength={100}
                    defaultValue={
                      data.tournaments.find((t) => t.id === modal.tournamentId)
                        ?.defaultTeamName
                    }
                  />
                </label>
                <label className="team-color">
                  Home team color
                  <input
                    type="color"
                    name="homeColor"
                    defaultValue={HOME_COLOR}
                  />
                </label>
                <button
                  type="button"
                  className="swap"
                  onClick={(e) => {
                    const form = e.currentTarget.form!;
                    const home = form.elements.namedItem(
                      'homeTeam',
                    ) as HTMLInputElement;
                    const away = form.elements.namedItem(
                      'awayTeam',
                    ) as HTMLInputElement;
                    [home.value, away.value] = [away.value, home.value];
                    const homeColor = form.elements.namedItem(
                      'homeColor',
                    ) as HTMLInputElement;
                    const awayColor = form.elements.namedItem(
                      'awayColor',
                    ) as HTMLInputElement;
                    [homeColor.value, awayColor.value] = [
                      awayColor.value,
                      homeColor.value,
                    ];
                  }}
                >
                  ⇅ Swap home / away
                </button>
                <label>
                  Away team
                  <input
                    name="awayTeam"
                    required
                    maxLength={100}
                    placeholder="Opponent name"
                  />
                </label>
                <label className="team-color">
                  Away team color
                  <input
                    type="color"
                    name="awayColor"
                    defaultValue={AWAY_COLOR}
                  />
                </label>
                <p className="muted">
                  Pick colors you’ll recognize on court. You’ll start Set 1 when
                  play begins.
                </p>
              </>
            )}
            {modal.kind === 'endSet' &&
              (() => {
                const m = data.matches.find((m) => m.id === modal.matchId)!;
                const s = setScore(data, modal.setId);
                return (
                  <div className="confirm-scores">
                    <p>
                      {m.homeTeam}
                      <strong>{s.homeScore}</strong>
                    </p>
                    <p>
                      {m.awayTeam}
                      <strong>{s.awayScore}</strong>
                    </p>
                    <small>Once ended, this set is read-only.</small>
                  </div>
                );
              })()}
            {modal.kind === 'complete' && (
              <p>
                All set scores and events will be saved. Completed matches are
                read-only.
              </p>
            )}
            {modal.kind === 'delete' && (
              <>
                <p>
                  This permanently deletes{' '}
                  <strong>{modal.tournament.name}</strong> and all its matches
                  and events from this device. Export a backup first if you need
                  a copy.
                </p>
                <label>
                  Type the tournament name to confirm
                  <input
                    name="confirm"
                    required
                    autoComplete="off"
                    onChange={(e) =>
                      e.currentTarget.setCustomValidity(
                        e.currentTarget.value.trim() === modal.tournament.name
                          ? ''
                          : 'Enter the exact tournament name.',
                      )
                    }
                  />
                </label>
              </>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setModal(undefined);
                  setError('');
                }}
              >
                Cancel
              </button>
              {modal.kind === 'endSet' || modal.kind === 'complete' ? (
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => {
                    const at = Date.now();
                    void commit(
                      (d) =>
                        modal.kind === 'endSet'
                          ? endSet(d, modal.matchId, modal.setId, at)
                          : completeMatch(d, modal.matchId, at),
                      () => setModal(undefined),
                    );
                  }}
                >
                  {modal.kind === 'endSet' ? 'End set' : 'Complete match'}
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={busy}
                  className={modal.kind === 'delete' ? 'danger' : 'primary'}
                >
                  {busy
                    ? 'Saving…'
                    : modal.kind === 'delete'
                      ? 'Delete permanently'
                      : modal.kind === 'newMatch'
                        ? modal.tournamentId
                          ? 'Create match'
                          : 'Create game'
                        : 'Save tournament'}
                </button>
              )}
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
