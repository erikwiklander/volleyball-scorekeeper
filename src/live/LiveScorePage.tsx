import { useEffect, useState } from 'react';
import { liveConfig } from './config';
import { publicBroadcastSchema, type PublicBroadcast } from './model';
export default function LiveScorePage({ publicId }: { publicId: string }) {
  const [broadcast, setBroadcast] = useState<PublicBroadcast>();
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let alive = true;
    let stopMatch: (() => void) | undefined;
    let stopConnection: (() => void) | undefined;
    setLoading(true);
    setBroadcast(undefined);
    setError('');
    if (!liveConfig()) {
      setError('Live scores are not connected on this site yet.');
      setLoading(false);
      return;
    }
    void import('./firebase')
      .then((api) => {
        if (!alive) return;
        stopConnection = api.watchConnection((value) => {
          if (alive) setConnected(value);
        });
        stopMatch = api.watchMatch(
          publicId,
          (data) => {
            if (!alive) return;
            setLoading(false);
            if (data === null) {
              setError('');
              setBroadcast(undefined);
              return;
            }
            const parsed = publicBroadcastSchema.safeParse(data);
            if (!parsed.success) {
              setError('This score could not be read. Please try again later.');
              return;
            }
            setError('');
            setBroadcast(parsed.data);
          },
          () => {
            if (alive) {
              setLoading(false);
              setError(
                'Could not load the live score. Please check your connection.',
              );
            }
          },
        );
      })
      .catch(() => {
        if (alive) {
          setLoading(false);
          setError('Could not connect to live scores.');
        }
      });
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => {
      alive = false;
      stopMatch?.();
      stopConnection?.();
      window.clearInterval(timer);
    };
  }, [publicId]);
  const match = broadcast?.published ? broadcast.match : undefined;
  const sets = Object.values(match?.sets ?? {}).sort(
    (a, b) => a.setNumber - b.setNumber,
  );
  const current = sets.find((s) => s.setNumber === match?.currentSet);
  const stale = !!broadcast && now - broadcast.updatedAt > 90_000;
  const status =
    match?.status === 'completed'
      ? 'FINAL'
      : !connected
        ? 'RECONNECTING'
        : stale
          ? 'WAITING FOR UPDATES'
          : match?.status === 'not_started'
            ? 'STARTING SOON'
            : 'LIVE';
  return (
    <div className="shell public-scoreboard">
      <header className="brand">
        <div>
          <span className="eyebrow">FOLLOW EVERY POINT</span>
          <div className="brand-title">
            Live scoreboard<span className="brand-dot">.</span>
          </div>
        </div>
      </header>
      <main>
        {error ? (
          <p role="alert" className="error">
            {error}
          </p>
        ) : loading ? (
          <p role="status">Connecting to the live score…</p>
        ) : !match ? (
          <section className="empty">
            <h1>Score unavailable</h1>
            <p>This match hasn’t been published yet, or sharing has stopped.</p>
          </section>
        ) : (
          <>
            <p className="eyebrow">{match.tournament || 'VOLLEYBALL'}</p>
            <h1>
              {match.home.name} <span className="muted">vs</span>{' '}
              {match.away.name}
            </h1>
            <p className="live-state" role="status">
              <span
                className={`live-dot ${status === 'LIVE' ? 'connected' : ''}`}
              />
              {status}
            </p>
            <div
              className="public-scores"
              aria-live="polite"
              aria-atomic="true"
            >
              {(['home', 'away'] as const).map((side) => (
                <div
                  className="public-team"
                  key={side}
                  style={{ borderTopColor: match[side].color }}
                >
                  {match[side].logo && (
                    <img
                      className="public-logo"
                      src={match[side].logo}
                      alt=""
                    />
                  )}
                  <h2>{match[side].shortName || match[side].name}</h2>
                  <strong className="public-points">
                    {current?.[side === 'home' ? 'homeScore' : 'awayScore'] ??
                      0}
                  </strong>
                </div>
              ))}
            </div>
            <p className="public-set">
              {match.status === 'completed'
                ? 'Match complete'
                : match.currentSet
                  ? `Set ${match.currentSet}${current?.completed ? ' · Between sets' : ''}`
                  : 'Ready for Set 1'}{' '}
              · Sets {match.result.home}–{match.result.away}
            </p>
            {sets.length > 0 && (
              <div className="table-wrap">
                <table className="public-history">
                  <caption>Set scores</caption>
                  <thead>
                    <tr>
                      <th>Team</th>
                      {sets.map((set) => (
                        <th
                          key={set.setNumber}
                          className={
                            set.setNumber === match.currentSet ? 'current' : ''
                          }
                        >
                          S{set.setNumber}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(['home', 'away'] as const).map((side) => (
                      <tr key={side}>
                        <th>{match[side].shortName || match[side].name}</th>
                        {sets.map((set) => (
                          <td
                            key={set.setNumber}
                            className={
                              set.setNumber === match.currentSet
                                ? 'current'
                                : ''
                            }
                          >
                            {set[side === 'home' ? 'homeScore' : 'awayScore']}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {match.location && <p>{match.location}</p>}
            <p className="muted">
              Last score received{' '}
              {new Date(broadcast!.updatedAt).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
                second: '2-digit',
              })}
              .
              {!connected
                ? ' Reconnecting automatically; the displayed score may be behind.'
                : stale && match.status !== 'completed'
                  ? ' Waiting for the scorer’s next update.'
                  : ''}
            </p>
          </>
        )}
      </main>
      <footer>
        <span>VOLLEYBALL SCOREKEEPER</span>
        <span className="build-version">
          v{__APP_VERSION__} · {__BUILD_REVISION__}
        </span>
      </footer>
    </div>
  );
}
