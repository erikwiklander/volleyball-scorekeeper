import { useState, useSyncExternalStore } from 'react';
import type { Broadcast } from './model';
import { liveConfig, liveUrl } from './config';
import { getLiveStatus, subscribeLiveStatus } from './worker';
export default function LiveControls({
  broadcast,
  busy,
  online,
  onStart,
  onStop,
}: {
  broadcast?: Broadcast;
  busy: boolean;
  online: boolean;
  onStart: (ownerUid: string) => void;
  onStop: () => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const status = useSyncExternalStore(subscribeLiveStatus, getLiveStatus);
  const configured = !!liveConfig();
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
          {broadcast?.enabled ? (
            <>
              <p>
                {!online
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
                          title: 'Live volleyball score',
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
                disabled={busy || connecting || !online}
                onClick={async () => {
                  setConnecting(true);
                  setError('');
                  try {
                    const { publisherIdentity } = await import('./firebase');
                    onStart(await publisherIdentity());
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
    </section>
  );
}
