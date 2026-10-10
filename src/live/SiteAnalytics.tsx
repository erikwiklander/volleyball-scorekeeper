import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import type { SiteDayAnalytics } from '../analytics';
import { liveConfig } from './config';

function SiteStats() {
  const [api, setApi] = useState<typeof import('./firebase')>();
  const [user, setUser] = useState<User | null>();
  const [days, setDays] = useState<Record<string, SiteDayAnalytics>>();
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  useEffect(() => {
    let alive = true;
    let stop: (() => void) | undefined;
    void import('./firebase')
      .then((module) => {
        if (!alive) return;
        setApi(module);
        stop = module.watchPublisher((value) => {
          if (alive) {
            setUser(value);
            setDays(undefined);
            setError('');
          }
        });
      })
      .catch(() => {
        if (alive) setError('Could not connect to analytics.');
      });
    return () => {
      alive = false;
      stop?.();
    };
  }, []);
  const signedIn =
    !!user &&
    !user.isAnonymous &&
    user.providerData.some((p) => p.providerId === 'google.com');
  useEffect(() => {
    if (!api || !signedIn) return;
    return api.watchSiteAnalytics(setDays, () =>
      setError('Site analytics are unavailable. Reconnect to try again.'),
    );
  }, [api, signedIn, user?.uid]);
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() - 29 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const recent = Object.entries(days ?? {})
    .filter(([day]) => day >= cutoff && day <= today)
    .sort(([a], [b]) => b.localeCompare(a));
  const visits = recent.reduce((sum, [, day]) => sum + day.visits, 0);
  return (
    <>
      {error && <p role="status">{error}</p>}
      {!signedIn ? (
        <>
          <p>
            Sign in with Google to see site traffic for the scorer and shared
            scoreboards.
          </p>
          <button
            disabled={
              !api || user === undefined || signingIn || !navigator.onLine
            }
            onClick={async () => {
              if (!api) return;
              setSigningIn(true);
              setError('');
              try {
                await api.signInPublisher();
              } catch {
                setError('Sign-in did not finish. Please try again.');
              } finally {
                setSigningIn(false);
              }
            }}
          >
            {signingIn ? 'Signing in…' : 'Sign in to view analytics'}
          </button>
        </>
      ) : days === undefined ? (
        <p>Loading site analytics…</p>
      ) : (
        <>
          <dl className="analytics-metrics">
            <div>
              <dt>Visits today</dt>
              <dd>{days[today]?.visits ?? 0}</dd>
            </div>
            <div>
              <dt>Viewer sessions today</dt>
              <dd>{days[today]?.sessions ?? 0}</dd>
            </div>
            <div>
              <dt>Visits · last 30 days</dt>
              <dd>{visits}</dd>
            </div>
          </dl>
          {recent.length > 0 && (
            <div className="table-wrap">
              <table className="analytics-history">
                <caption>Daily site traffic · UTC dates</caption>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Sessions</th>
                    <th>Scorer visits</th>
                    <th>Scoreboard visits</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map(([day, values]) => (
                    <tr key={day}>
                      <th>{day}</th>
                      <td>{values.sessions}</td>
                      <td>{values.scorerVisits}</td>
                      <td>{values.scoreboardVisits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted">
            A visit is one page load. Sessions are counted per browser tab each
            day, including your visits. Tracking starts with this update;
            previous visits are unavailable. Counts respect Do Not Track and
            Global Privacy Control.
          </p>
        </>
      )}
    </>
  );
}

export default function SiteAnalytics() {
  const [open, setOpen] = useState(false);
  if (!liveConfig()) return null;
  return (
    <details
      className="site-analytics"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Site analytics</summary>
      {open && <SiteStats />}
    </details>
  );
}
