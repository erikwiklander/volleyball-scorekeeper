import { useSyncExternalStore } from 'react';
import type { Snapshot } from '../domain';
import { getLibraryStatus, subscribeLibrary } from './worker';
import { canScoreGame, libraryLink } from './model';

export function LibrarySyncSummary({
  online,
  onDismiss,
  notice,
}: {
  online: boolean;
  notice?: string;
  onDismiss: () => void;
}) {
  const status = useSyncExternalStore(subscribeLibrary, getLibraryStatus);
  return (
    <>
      <p role="status">
        {!online && status.ownerUid
          ? 'Games and tournaments are saved here. Sync resumes when connected.'
          : status.message}
      </p>
      {status.phase === 'error' && (
        <button
          disabled={!online}
          onClick={() => window.dispatchEvent(new Event('library-retry'))}
        >
          Retry cloud backup
        </button>
      )}
      {notice && (
        <p role="status">
          {notice}{' '}
          <button onClick={onDismiss}>Dismiss history sync notice</button>
        </p>
      )}
    </>
  );
}
export function GameSyncControls({
  data,
  matchId,
  online,
  busy,
  onTakeOver,
}: {
  data: Snapshot;
  matchId: string;
  online: boolean;
  busy: boolean;
  onTakeOver: () => void;
}) {
  const status = useSyncExternalStore(subscribeLibrary, getLibraryStatus);
  const link = libraryLink(data, 'games', matchId);
  if (!link) return null;
  const controlled = canScoreGame(data, matchId);
  const pending = data.libraryQueue.some((e) => e.id === link.id);
  return (
    <section className="game-sync-controls" aria-label="Game cloud sync">
      {controlled ? (
        <p role="status">
          {!online || pending
            ? 'Saved on this device. Cloud backup pending.'
            : status.phase === 'synced'
              ? 'Game backed up to your account.'
              : status.message}
        </p>
      ) : (
        <>
          <p>
            This game is controlled by another device. You can view and export
            its history here.
          </p>
          <button
            disabled={
              busy ||
              !online ||
              !status.ready ||
              status.ownerUid !== link.ownerUid
            }
            onClick={onTakeOver}
          >
            Take over scoring
          </button>
          <small>
            {!online
              ? 'Connect to take over scoring.'
              : status.ownerUid !== link.ownerUid
                ? 'Sign in on the home screen with this game’s account to take over.'
                : 'Switch only when you need to score on this device. Unsynced points on the previous device will be kept separately.'}
          </small>
        </>
      )}
    </section>
  );
}
