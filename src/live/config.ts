export interface LiveConfig {
  apiKey: string;
  authDomain?: string;
  projectId: string;
  databaseURL: string;
  appId: string;
}
export function liveConfig(): LiveConfig | undefined {
  try {
    const value = JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG || 'null');
    if (
      value &&
      ['apiKey', 'projectId', 'databaseURL', 'appId'].every(
        (key) => typeof value[key] === 'string' && value[key],
      )
    )
      return value;
  } catch {
    /* Publishing is optional; invalid configuration must not block local scoring. */
  }
}
export function liveUrl(publicId: string) {
  const url = new URL(
    import.meta.env.VITE_LIVE_BASE_URL || './',
    document.baseURI,
  );
  url.hash = `/live/${publicId}`;
  return url.href;
}
