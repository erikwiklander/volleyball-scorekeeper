import { useEffect, useState } from 'react';
import { watchingNow, type GameAnalytics } from '../analytics';

export default function Audience({
  publicId,
  live,
}: {
  publicId: string;
  live: boolean;
}) {
  const [data, setData] = useState<GameAnalytics>();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let alive = true;
    let stop: (() => void) | undefined;
    void import('./firebase')
      .then((api) => {
        if (!alive) return;
        stop = api.watchGameAnalytics(
          publicId,
          (value) => {
            if (!alive) return;
            setData(value);
            setLoaded(true);
            setError(false);
          },
          () => {
            if (alive) setError(true);
          },
        );
      })
      .catch(() => {
        if (alive) setError(true);
      });
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => {
      alive = false;
      stop?.();
      window.clearInterval(timer);
    };
  }, [publicId]);
  return (
    <section className="audience" aria-label="Game audience">
      <h3>Game audience</h3>
      {error ? (
        <p>Audience stats are unavailable. Reconnect to try again.</p>
      ) : !loaded ? (
        <p>Loading audience…</p>
      ) : (
        <>
          <dl className="analytics-metrics">
            <div>
              <dt>Watching now</dt>
              <dd>{live ? watchingNow(data, now) : 0}</dd>
            </div>
            <div>
              <dt>Total viewers</dt>
              <dd>{data?.viewers ?? 0}</dd>
            </div>
            <div>
              <dt>Viewed while live</dt>
              <dd>{data?.liveViewers ?? 0}</dd>
            </div>
            <div>
              <dt>Peak watching live</dt>
              <dd>{data?.peakWatching ?? 0}</dd>
            </div>
          </dl>
          <p className="muted">
            Estimated browser sessions. Reloads in the same tab count once;
            another tab or device can count again. Live counts cover the game
            from start to completion. Watching now updates about every 30
            seconds and drops inactive viewers within 90 seconds.
          </p>
        </>
      )}
    </section>
  );
}
