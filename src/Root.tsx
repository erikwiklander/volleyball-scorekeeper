import { useEffect, useState } from 'react';
import App from './App';
import LiveScorePage from './live/LiveScorePage';
export default function Root() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const change = () => setHash(location.hash);
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const live = hash.match(/^#\/live\/([a-zA-Z0-9_-]{1,128})$/);
  return live ? <LiveScorePage publicId={live[1]} /> : <App />;
}
