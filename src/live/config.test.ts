import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveTitle, liveUrl } from './config';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('live sharing', () => {
  it('uses the viewer host, safe team slugs, and the original public ID', () => {
    vi.stubGlobal('document', { baseURI: 'https://scorer.example/app/' });
    vi.stubEnv('VITE_LIVE_BASE_URL', 'https://viewer.example/');
    expect(
      liveUrl('abc_123', {
        homeTeam: 'Éagles / Blue',
        awayTeam: 'Falcons & Red',
      }),
    ).toBe('https://viewer.example/#/live/abc_123/eagles-blue-vs-falcons-red');
  });
  it('preserves subfolder deployments and handles names without Latin characters', () => {
    vi.stubGlobal('document', { baseURI: 'https://scorer.example/app/' });
    vi.stubEnv('VITE_LIVE_BASE_URL', '');
    expect(liveUrl('abc', { homeTeam: '東京', awayTeam: 'Falcons' })).toBe(
      'https://scorer.example/app/#/live/abc/team-vs-falcons',
    );
  });
  it('keeps full team names in the shared title for either sport', () => {
    expect(liveTitle({ homeTeam: 'Eagles', awayTeam: 'Falcons' })).toBe(
      'Eagles vs Falcons — Live score',
    );
  });
});
