import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveTitle, liveUrl } from './config';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('live sharing', () => {
  it('uses a server-visible ID on the viewer host for preview requests', () => {
    vi.stubGlobal('document', { baseURI: 'https://scorer.example/app/' });
    vi.stubEnv('VITE_LIVE_BASE_URL', 'https://viewer.example/');
    expect(liveUrl('abc_123')).toBe('https://viewer.example/live/abc_123');
  });
  it('preserves subfolder deployments', () => {
    vi.stubGlobal('document', { baseURI: 'https://scorer.example/app/' });
    vi.stubEnv('VITE_LIVE_BASE_URL', '');
    expect(liveUrl('abc')).toBe('https://scorer.example/app/live/abc');
  });
  it('keeps team names in the shared title for either sport', () => {
    expect(liveTitle({ homeTeam: 'Eagles', awayTeam: 'Falcons' })).toBe(
      'Eagles vs Falcons — Live score',
    );
  });
});
