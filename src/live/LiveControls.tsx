import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { User } from 'firebase/auth';
import type { Broadcast } from './model';
import { liveConfig, liveTitle, liveUrl } from './config';
import type { Match } from '../domain';
import { getLiveStatus, subscribeLiveStatus } from './worker';
import Audience from './Audience';
export default function LiveControls({
  broadcast,
  match,
  busy,
  online,
  onStart,
  onStop,
  viewOnly = false,
}: {
  broadcast?: Broadcast;
  match: Match;
  busy: boolean;
  online: boolean;
  onStart: (ownerUid: string) => void;
  onStop: () => void;
  viewOnly?: boolean;
}) {
  const [connecting, setConnecting] = useState(false);
  const attempt = useRef(0);
  const [preparingSlow, setPreparingSlow] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const status = useSyncExternalStore(subscribeLiveStatus, getLiveStatus);
  const configured = !!liveConfig();
  const [api, setApi] = useState<typeof import('./firebase')>();
  const [user, setUser] = useState<User | null>();
  useEffect(() => {
    if (!configured) return;
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    void import('./firebase')
      .then((module) => {
        if (!alive) return;
        setApi(module);
        unsubscribe = module.watchPublisher((value) => {
          if (alive) setUser(value);
        });
      })
      .catch(() => {
        if (alive)
          setError(
            'Sign-in could not load. Reconnect and reopen this match. Local scoring still works.',
          );
      });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [configured]);
  useEffect(() => {
    if (!configured || user !== undefined) {
      setPreparingSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setPreparingSlow(true), 20_000);
    return () => window.clearTimeout(timer);
  }, [configured, user]);
  useEffect(() => {
    return () => {
      attempt.current++;
    };
  }, []);
  const signedIn =
    !!user &&
    !user.isAnonymous &&
    user.providerData.some((p) => p.providerId === 'google.com');
  const ownsLink = signedIn && (!broadcast || user.uid === broadcast.ownerUid);

  const pending = !!broadcast && broadcast.revision > broadcast.syncedRevision;
  const url = broadcast ? liveUrl(broadcast.publicId) : '';
  return (
    <section className="live-controls">
      <h2>Live score</h2>
      {!configured ? (
        <p>
          Live sharing hasn’t been connected yet. Your scoring stays on this
          device.
        </p>
      ) : (
        <>
          {signedIn ? (
            <p>
              Signed in as {user.email || user.displayName || 'Google user'}.{' '}
              <button
                disabled={busy || connecting}
                onClick={() =>
                  void api
                    ?.signOutPublisher()
                    .catch(() =>
                      setError('Could not sign out. Please try again.'),
                    )
                }
              >
                Sign out
              </button>
            </p>
          ) : (
            <>
              <p>
                Sign in with Google to publish. Anyone with the link can view
                the score. Local scoring works without signing in.
              </p>
              <button
                disabled={!api || user === undefined || connecting || !online}
                onClick={async () => {
                  if (!api) return;
                  const currentAttempt = ++attempt.current;
                  const timer = window.setTimeout(() => {
                    if (attempt.current !== currentAttempt) return;
                    setConnecting(false);
                    setError(
                      'Google sign-in is taking longer than expected. Finish in the sign-in window, or try again if no window opened. Your scores are saved on this device.',
                    );
                  }, 30_000);
                  setConnecting(true);
                  setError('');
                  try {
                    await api.signInPublisher();
                    if (attempt.current === currentAttempt) setError('');
                  } catch (error) {
                    if (attempt.current !== currentAttempt) return;
                    const code = (error as { code?: string }).code;
                    if (
                      code !== 'auth/popup-closed-by-user' &&
                      code !== 'auth/cancelled-popup-request'
                    )
                      setError(
                        code === 'auth/popup-blocked'
                          ? 'Allow pop-up windows for this site, then tap Sign in with Google again.'
                          : 'Google sign-in could not finish. Please try again. Local scoring still works.',
                      );
                  } finally {
                    window.clearTimeout(timer);
                    if (attempt.current === currentAttempt)
                      setConnecting(false);
                  }
                }}
              >
                {connecting
                  ? 'Signing in…'
                  : user === undefined
                    ? 'Preparing Google sign-in…'
                    : 'Sign in with Google'}
              </button>
              {preparingSlow && (
                <p role="alert">
                  Google sign-in could not finish loading. Check your
                  connection, then{' '}
                  <button disabled={busy} onClick={() => location.reload()}>
                    Reload sign-in
                  </button>
                  . Your scores stay saved on this device.
                </p>
              )}
            </>
          )}
          {signedIn && broadcast && !ownsLink && (
            <p role="alert">
              Sign in with the Google account that started this live link to
              publish updates.
            </p>
          )}
          {broadcast?.enabled ? (
            <>
              <p>
                {viewOnly
                  ? 'Live sharing follows the active scoring device.'
                  : !ownsLink
                    ? 'Live updates are paused. Sign in with the match owner’s Google account to publish changes.'
                    : !online
                      ? 'Offline — changes will upload when you reconnect.'
                      : pending
                        ? status || 'Saved here. Live update pending…'
                        : 'The latest saved score is published.'}
              </p>
              <div className="toolbar">
                <button
                  onClick={async () => {
                    setError('');
                    try {
                      if (navigator.share)
                        await navigator.share({
                          title: liveTitle(match),
                          url,
                        });
                      else {
                        await navigator.clipboard.writeText(url);
                        setCopied(true);
                      }
                    } catch (error) {
                      if (!(
                        error instanceof DOMException &&
                        error.name === 'AbortError'
                      ))
                        setError('Use the link below to share this match.');
                    }
                  }}
                >
                  {copied ? 'Link copied' : 'Share live score'}
                </button>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  View live score ↗
                </a>
                <button disabled={busy || connecting} onClick={onStop}>
                  Stop sharing
                </button>
              </div>
              <input
                className="live-link"
                aria-label="Live score link"
                value={url}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
              />
            </>
          ) : (
            <>
              <p>
                {pending
                  ? 'Stopping live sharing when connected…'
                  : 'Let family and friends follow this match. Anyone with the link can view the score.'}
              </p>
              <button
                disabled={busy || connecting || !online || !ownsLink}
                onClick={async () => {
                  setConnecting(true);
                  setError('');
                  try {
                    if (!api) return;
                    onStart(await api.publisherIdentity());
                  } catch {
                    setError(
                      'Could not connect live sharing. Check your connection and try again. Scoring still works.',
                    );
                  } finally {
                    setConnecting(false);
                  }
                }}
              >
                {connecting ? 'Connecting…' : 'Start live sharing'}
              </button>
              {!online && (
                <small>
                  Connect once to start sharing. You can keep scoring offline
                  afterward.
                </small>
              )}
            </>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {ownsLink && broadcast && broadcast.syncedRevision > 0 && (
        <Audience
          key={broadcast.publicId}
          publicId={broadcast.publicId}
          live={broadcast.enabled && match.status === 'in_progress'}
        />
      )}
    </section>
  );
}
