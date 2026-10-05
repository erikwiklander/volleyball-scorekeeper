import {
  activePoints,
  calculateScore,
  footballScores,
  periodLabel,
  type FootballScore,
  type Match,
  type Snapshot,
  type VolleyballSet,
} from './domain';
import { HOME_COLOR, AWAY_COLOR, teamButtonStyle } from './colors';

export default function FootballScorer({
  data,
  match,
  current,
  periods,
  busy,
  onScore,
  onUndo,
  onStart,
  onEnd,
  onComplete,
}: {
  data: Snapshot;
  match: Match;
  current?: VolleyballSet;
  periods: VolleyballSet[];
  busy: boolean;
  onScore: (side: 'HOME_POINT' | 'AWAY_POINT', type: FootballScore) => void;
  onUndo: () => void;
  onStart: () => void;
  onEnd: () => void;
  onComplete: () => void;
}) {
  const total = calculateScore(
    data.events.filter((e) => e.matchId === match.id),
  );
  const finished = match.status === 'completed';
  return (
    <section className="football-scoring" aria-label="Football scoreboard">
      <p className="eyebrow">POP WARNER TACKLE · KICK +2 · RUN / PASS +1</p>
      <div className="score-grid" aria-live="polite" aria-atomic="true">
        {(['home', 'away'] as const).map((side) => (
          <div
            key={side}
            className="football-team"
            style={teamButtonStyle(
              match[`${side}Color`] ??
                (side === 'home' ? HOME_COLOR : AWAY_COLOR),
            )}
          >
            {match[side]?.logo && (
              <img className="score-logo" src={match[side]?.logo} alt="" />
            )}
            <h2>{match[side]?.shortName || match[`${side}Team`]}</h2>
            <strong className="score">
              {total[side === 'home' ? 'homeScore' : 'awayScore']}
            </strong>
          </div>
        ))}
      </div>
      {current ? (
        <>
          <div className="football-buttons">
            {(['home', 'away'] as const).map((side) => (
              <div
                key={side}
                role="group"
                aria-label={`${match[`${side}Team`]} scoring`}
              >
                {(Object.keys(footballScores) as FootballScore[]).map(
                  (type) => (
                    <button
                      key={type}
                      disabled={busy}
                      onClick={() =>
                        onScore(
                          side === 'home' ? 'HOME_POINT' : 'AWAY_POINT',
                          type,
                        )
                      }
                    >
                      {footballScores[type].label}{' '}
                      <strong>+{footballScores[type].points}</strong>
                    </button>
                  ),
                )}
              </div>
            ))}
          </div>
          <div className="scoring-actions">
            <button
              className="undo"
              disabled={
                busy ||
                !activePoints(data.events.filter((e) => e.setId === current.id))
                  .length
              }
              onClick={onUndo}
            >
              ↶ Undo last score
            </button>
            <button disabled={busy} onClick={onEnd}>
              End {periodLabel('football', current.setNumber).toLowerCase()}
            </button>
          </div>
        </>
      ) : finished ? (
        <p className="public-set">Final score</p>
      ) : (
        <div className="between">
          <h2>
            {periods.length === 2
              ? 'Halftime'
              : periods.length >= 4
                ? 'End of ' +
                  (periods.length === 4
                    ? 'regulation'
                    : periodLabel('football', periods.length))
                : periods.length
                  ? 'Between quarters'
                  : 'Ready for kickoff'}
          </h2>
          <div className="toolbar">
            <button className="primary" disabled={busy} onClick={onStart}>
              Start {periodLabel('football', periods.length + 1)}
            </button>
            {periods.length > 0 && (
              <button disabled={busy} onClick={onComplete}>
                Complete game
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
