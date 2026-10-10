import { useEffect, useState } from 'react';
import App from './App';
import LiveScorePage from './live/LiveScorePage';
import { startAnalytics } from './analytics';
export default function Root() {
  const [route, setRoute] = useState(() => ({
    hash: location.hash,
    pathname: location.pathname,
  }));
  useEffect(() => {
    const change = () =>
      setRoute({ hash: location.hash, pathname: location.pathname });
    window.addEventListener('hashchange', change);
    window.addEventListener('popstate', change);
    return () => {
      window.removeEventListener('hashchange', change);
      window.removeEventListener('popstate', change);
    };
  }, []);
  const live =
    route.hash.match(/^#\/live\/([a-zA-Z0-9_-]{1,128})(?:\/[^/]+)?$/) ??
    route.pathname.match(/\/live\/([a-zA-Z0-9_-]{1,128})\/?$/);
  const surface = live ? 'scoreboard' : 'scorer';
  useEffect(() => startAnalytics(surface), [surface]);
  return live ? <LiveScorePage publicId={live[1]} /> : <App />;
}
