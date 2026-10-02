// Updates reload only the tab that explicitly requests them.
export interface UpdateState {
  available: boolean;
  checking: boolean;
  applying: boolean;
  message: string;
}
let state: UpdateState = {
  available: false,
  checking: false,
  applying: false,
  message: '',
};
const listeners = new Set<() => void>();
export const getUpdateState = () => state;
export const subscribeUpdates = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function publish(update: Partial<UpdateState>) {
  state = { ...state, ...update };
  listeners.forEach((listener) => listener());
}
let registration: ServiceWorkerRegistration | undefined;
let starting: Promise<void> | undefined;
let lastCheck = 0;
function available() {
  const differentController = !!(
    navigator.serviceWorker.controller &&
    registration?.active &&
    navigator.serviceWorker.controller !== registration.active
  );
  return !!registration?.waiting || differentController;
}
function inspect() {
  if (available())
    publish({
      available: true,
      message: 'An update is ready. Your saved matches will be kept.',
    });
}
function observe(worker: ServiceWorker) {
  const changed = () => {
    if (worker.state === 'installed') {
      if (navigator.serviceWorker.controller) {
        publish({
          available: true,
          message: 'An update is ready. Your saved matches will be kept.',
        });
      } else {
        window.dispatchEvent(new Event('offline-ready'));
      }
    }
    if (worker.state === 'redundant' && !state.applying) {
      publish({
        checking: false,
        message: 'The update could not be downloaded. Try again when online.',
      });
    }
  };
  worker.addEventListener('statechange', changed);
  changed();
}
export function startUpdates() {
  if (starting) return starting;
  if (!import.meta.env.PROD || !('serviceWorker' in navigator))
    return Promise.resolve();
  starting = (async () => {
    try {
      const url = new URL('sw.js', document.baseURI);
      registration = await navigator.serviceWorker.register(url.href, {
        scope: new URL('./', url).pathname,
        updateViaCache: 'none',
      });
      registration.addEventListener('updatefound', () => {
        if (registration?.installing) observe(registration.installing);
      });
      if (registration.installing) observe(registration.installing);
      inspect();
      const backgroundCheck = () => {
        if (
          document.visibilityState === 'visible' &&
          navigator.onLine &&
          Date.now() - lastCheck > 60_000
        )
          void checkForUpdates(false);
      };
      window.addEventListener('online', backgroundCheck);
      document.addEventListener('visibilitychange', backgroundCheck);
      window.setInterval(backgroundCheck, 60_000);
      backgroundCheck();
    } catch (error) {
      console.error('Offline setup failed', error);
      window.dispatchEvent(new Event('offline-failed'));
      publish({
        message: 'Could not check for updates. Try again when online.',
      });
      starting = undefined;
    }
  })();
  return starting;
}
export async function checkForUpdates(manual = true) {
  if (state.checking || state.applying) return;
  if (!navigator.onLine) {
    if (manual)
      publish({
        message:
          'You’re offline. Scoring still works; reconnect to check for updates.',
      });
    return;
  }
  publish({
    checking: true,
    ...(manual ? { message: 'Checking for updates…' } : {}),
  });
  lastCheck = Date.now();
  try {
    await startUpdates();
    if (!registration) throw new Error('Updates unavailable');
    await registration.update();
    inspect();
    if (manual && !available())
      publish({
        message: registration.installing
          ? 'Downloading update…'
          : 'You’re running the latest available version.',
      });
  } catch {
    if (manual)
      publish({
        message:
          'Could not check for updates. Your saved matches are safe; try again when online.',
      });
  } finally {
    publish({ checking: false });
  }
}
export async function applyUpdate() {
  if (!registration || state.applying || !state.available) return;
  publish({ applying: true, message: 'Loading update…' });
  try {
    const waiting = registration.waiting;
    if (waiting) {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(
          () => done(new Error('Update timed out')),
          15_000,
        );
        function done(error?: Error) {
          window.clearTimeout(timeout);
          waiting!.removeEventListener('statechange', changed);
          if (error) reject(error);
          else resolve();
        }
        function changed() {
          if (waiting!.state === 'activated') done();
          else if (waiting!.state === 'redundant')
            done(new Error('Update replaced'));
        }
        waiting.addEventListener('statechange', changed);
        waiting.postMessage({ type: 'SKIP_WAITING' });
        changed();
      });
    } else if (!available()) {
      throw new Error('No update ready');
    }
    // No clientsClaim or controllerchange reload: only this opted-in page reloads.
    window.location.reload();
  } catch {
    publish({
      applying: false,
      message:
        'The update could not be loaded. Check for updates and try again.',
    });
  }
}
