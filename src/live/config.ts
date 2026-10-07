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
export function liveTitle(match: { homeTeam: string; awayTeam: string }) {
  return `${match.homeTeam} vs ${match.awayTeam} — Live score`;
}
function teamSlug(name: string) {
  return (
    name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80)
      .replace(/-$/g, '') || 'team'
  );
}
export function liveUrl(
  publicId: string,
  match: { homeTeam: string; awayTeam: string },
) {
  const url = new URL(
    import.meta.env.VITE_LIVE_BASE_URL || './',
    document.baseURI,
  );
  url.hash = `/live/${publicId}/${teamSlug(match.homeTeam)}-vs-${teamSlug(match.awayTeam)}`;
  return url.href;
}
