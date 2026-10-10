import { liveConfig } from './live/config';

export const ACTIVE_VIEWER_MS = 90_000;
const sessionKey = 'scorekeeper-analytics-session';
let memorySession: string | undefined;
let visitId: string | undefined;

export function analyticsAllowed() {
  return (
    navigator.doNotTrack !== '1' &&
    !(navigator as Navigator & { globalPrivacyControl?: boolean })
      .globalPrivacyControl
  );
}

function sessionId() {
  memorySession ??= crypto.randomUUID();
  try {
    const saved = sessionStorage.getItem(sessionKey);
    if (saved && /^[a-f0-9-]{36}$/.test(saved)) memorySession = saved;
    else sessionStorage.setItem(sessionKey, memorySession);
  } catch {
    // Blocked storage still permits an in-memory session for this page.
  }
  return memorySession;
}

export function analyticsEndpoint() {
  const config = liveConfig();
  if (!config) return;
  if (import.meta.env.VITE_FIREBASE_EMULATORS === 'true') {
    if (!['localhost', '127.0.0.1'].includes(location.hostname)) return;
    return new URL('api/analytics', document.baseURI).href;
  }
  // Local development and browser tests must never record production visits.
  if (['localhost', '127.0.0.1'].includes(location.hostname)) return;
  return `https://us-central1-${config.projectId}.cloudfunctions.net/analyticsEvent`;
}

// Analytics runs separately from scoring, never queues offline events, and only
// sends heartbeats while the scoreboard is visible and the browser is online.
export function startAnalytics(
  surface: 'scorer' | 'scoreboard',
  publicId?: string,
) {
  const endpoint = analyticsEndpoint();
  if (!endpoint || !analyticsAllowed()) return () => {};
  let stopped = false;
  let pending = false;
  let siteRecorded = false;
  visitId ??= crypto.randomUUID();
  const session = sessionId();
  const send = async () => {
    if (
      stopped ||
      pending ||
      !analyticsAllowed() ||
      !navigator.onLine ||
      document.visibilityState !== 'visible' ||
      (!publicId && siteRecorded)
    )
      return;
    pending = true;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        signal: AbortSignal.timeout(8_000),
        body: JSON.stringify(
          publicId
            ? { kind: 'game', sessionId: session, publicId }
            : { kind: 'site', sessionId: session, visitId, surface },
        ),
      });
      if (response.ok) siteRecorded = true;
    } catch {
      // Failed analytics must never interrupt viewing or local scoring.
    } finally {
      pending = false;
    }
  };
  void send();
  const timer = window.setInterval(() => void send(), 30_000);
  const resume = () => void send();
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', resume);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('online', resume);
  };
}

export interface GameAnalytics {
  viewers: number;
  liveViewers: number;
  peakWatching: number;
  active?: Record<string, number>;
}
export interface SiteDayAnalytics {
  sessions: number;
  visits: number;
  scorerVisits: number;
  scoreboardVisits: number;
}
export function watchingNow(data: GameAnalytics | undefined, now: number) {
  return Object.values(data?.active ?? {}).filter(
    (lastSeen) => lastSeen > now - ACTIVE_VIEWER_MS,
  ).length;
}
