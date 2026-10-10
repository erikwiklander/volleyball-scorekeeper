import { useEffect, useState, useSyncExternalStore } from 'react';
import type { User } from 'firebase/auth';
import { liveConfig } from '../live/config';
import { getTeamSyncStatus, subscribeTeamSync } from './worker';
import { LibrarySyncSummary } from '../library-sync/Controls';

export default function TeamSyncControls({
  online,
  busy,
  cached,
  conflict,
  onDismiss,
  historyNotice,
  onDismissHistory,
}: {
  online: boolean;
  busy: boolean;
  cached: boolean;
  conflict?: string;
  onDismiss: () => void;
  historyNotice?: string;
  onDismissHistory: () => void;
}) {
  const status = useSyncExternalStore(subscribeTeamSync, getTeamSyncStatus);
  const [api, setApi] = useState<typeof import('../live/firebase')>();
  const [user, setUser] = useState<User | null>();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const configured = !!liveConfig();
  useEffect(() => {
    if (!configured) return;
    let alive = true;
    let stop: (() => void) | undefined;
    void import('../live/firebase')
      .then((module) => {
        if (!alive) return;
        setApi(module);
        stop = module.watchPublisher((value) => {
          if (alive) setUser(value);
        });
      })
      .catch(() => {
        if (alive)
          setError(
            'Sign-in could not load. Reconnect and reload to try again.',
          );
      });
    return () => {
      alive = false;
      stop?.();
    };
  }, [configured]);
  if (!configured) return null;
  const signedIn =
    !!user &&
    !user.isAnonymous &&
    user.providerData.some((provider) => provider.providerId === 'google.com');
  return (
    <div className="team-sync-controls" aria-label="Team sync">
      <h3>Cloud backup &amp; sync</h3>
      {signedIn ? (
        <>
          <p>Library · {user.email || user.displayName || 'Google account'}</p>
          <p role="status">
            {!online
              ? 'Teams are saved here. Sync resumes when connected.'
              : status.message}
          </p>
          <LibrarySyncSummary
            online={online}
            notice={historyNotice}
            onDismiss={onDismissHistory}
          />
          <div className="toolbar">
            <button
              disabled={busy || connecting}
              onClick={() =>
                void api
                  ?.signOutPublisher()
                  .catch(() => setError('Could not sign out. Try again.'))
              }
            >
              Sign out of sync
            </button>
            {status.phase === 'error' && (
              <button
                disabled={busy || !online}
                onClick={() =>
                  window.dispatchEvent(new Event('team-sync-retry'))
                }
              >
                Retry team sync
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p>
            {cached
              ? 'Your previous account’s library is cached on this device. Sign in with that account to resume syncing; another account has its own library.'
              : 'Sign in to back up your teams, games, and tournaments across devices. Existing records on this device will be included. Scoring still works offline.'}
          </p>
          <button
            disabled={
              !api || user === undefined || connecting || busy || !online
            }
            onClick={async () => {
              if (!api) return;
              setConnecting(true);
              setError('');
              // Keep retries available when an external sign-in window stalls.
              const timer = window.setTimeout(() => {
                setConnecting(false);
                setError(
                  'Sign-in is taking longer than expected. Finish in the sign-in window, or try again.',
                );
              }, 30_000);
              try {
                await api.signInPublisher();
                setError('');
              } catch {
                setError(
                  'Sign-in did not finish. Your teams are saved here. Try again.',
                );
              } finally {
                window.clearTimeout(timer);
                setConnecting(false);
              }
            }}
          >
            {connecting ? 'Connecting sync…' : 'Sign in to sync your library'}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {!signedIn && (
        <LibrarySyncSummary
          online={online}
          notice={historyNotice}
          onDismiss={onDismissHistory}
        />
      )}
      {conflict && (
        <p role="status">
          {conflict}{' '}
          <button disabled={busy} onClick={onDismiss}>
            Dismiss sync notice
          </button>
        </p>
      )}
    </div>
  );
}
