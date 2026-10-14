import { useEffect, useState } from 'react';
import { liveConfig } from './live/config';
export default function Recap({
  path,
  scoreKey,
}: {
  path?: string;
  scoreKey: string;
}) {
  const [text, setText] = useState('');
  useEffect(() => {
    let alive = true;
    let stop: (() => void) | undefined;
    setText('');
    if (path && liveConfig()) {
      void import('./live/firebase')
        .then((api) => {
          if (!alive) return;
          stop = api.watchRecap(
            path,
            (value) => {
              if (!alive) return;
              setText(
                value?.scoreKey === scoreKey &&
                  typeof value?.text === 'string' &&
                  value.text.length <= 650
                  ? value.text
                  : '',
              );
            },
            () => {
              if (alive) setText('');
            },
          );
        })
        .catch(() => {
          if (alive) setText('');
        });
    }
    return () => {
      alive = false;
      stop?.();
    };
  }, [path, scoreKey]);
  return text ? (
    <section className="game-recap" aria-label="AI game recap">
      <span className="eyebrow">AI game recap</span>
      <p>{text}</p>
    </section>
  ) : null;
}
