import { sportOf, type Sport } from './domain';
import { useEffect, useRef, useState } from 'react';
import { AWAY_COLOR, HOME_COLOR } from './colors';
import { id, type Team, type TeamDraft } from './domain';

const blank = (color: string): TeamDraft => ({ name: '', primaryColor: color });
const fromTeam = (team: Team): TeamDraft => ({ ...team, teamId: team.id });

async function readLogo(file: File) {
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    file.size > 5_000_000
  )
    throw new Error('Choose a PNG, JPEG, or WebP image smaller than 5 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(
      1,
      256 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare this image.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function TeamFields({
  label,
  draft,
  onChange,
  onLoading,
}: {
  label: string;
  draft: TeamDraft;
  onChange: (draft: TeamDraft) => void;
  onLoading: (loading: boolean) => void;
}) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const change = (update: Partial<TeamDraft>) =>
    onChange({ ...draft, ...update });
  return (
    <fieldset className="team-fields" disabled={loading}>
      <label>
        {label === 'Team' ? 'Team name' : label}
        <input
          required
          maxLength={100}
          value={draft.name}
          onChange={(e) => change({ name: e.target.value })}
        />
      </label>
      <label>
        {label} color
        <input
          type="color"
          value={draft.primaryColor}
          onChange={(e) => change({ primaryColor: e.target.value })}
        />
      </label>
      <details>
        <summary>Short name, logo & secondary color</summary>
        <label>
          {label} short name
          <input
            maxLength={20}
            value={draft.shortName ?? ''}
            onChange={(e) => change({ shortName: e.target.value || undefined })}
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={!!draft.secondaryColor}
            onChange={(e) =>
              change({
                secondaryColor: e.target.checked ? '#ffffff' : undefined,
              })
            }
          />
          Use secondary color
        </label>
        {draft.secondaryColor && (
          <label>
            {label} secondary color
            <input
              type="color"
              value={draft.secondaryColor}
              onChange={(e) => change({ secondaryColor: e.target.value })}
            />
          </label>
        )}
        {draft.logo && (
          <div className="logo-preview">
            <img src={draft.logo} alt={`${draft.name || label} logo`} />
            <button type="button" onClick={() => change({ logo: undefined })}>
              Remove logo
            </button>
          </div>
        )}
        <label>
          {label} logo
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              const request = ++generation.current;
              setError('');
              setLoading(true);
              onLoading(true);
              try {
                const logo = await readLogo(file);
                if (request === generation.current) change({ logo });
              } catch (error) {
                if (request === generation.current)
                  setError(
                    error instanceof Error
                      ? error.message
                      : 'Could not read image.',
                  );
              } finally {
                if (request === generation.current) {
                  setLoading(false);
                  onLoading(false);
                }
              }
            }}
          />
        </label>
        <small>Saved on this device and included in JSON backups.</small>
        {loading && <p role="status">Preparing logo…</p>}
        {error && <p role="alert">{error}</p>}
      </details>
    </fieldset>
  );
}

export function MatchSetup({
  teams: allTeams,
  initialSport = 'volleyball',
  defaultTeamId,
  defaultTeamName,
  onLoading,
}: {
  teams: Team[];
  initialSport?: Sport;
  defaultTeamId?: string;
  defaultTeamName?: string;
  onLoading: (loading: boolean) => void;
}) {
  const [sport, setSport] = useState<Sport>(() => {
    const team = allTeams.find((t) => t.id === defaultTeamId);
    return team ? sportOf(team) : initialSport;
  });
  const teams = allTeams.filter((t) => sportOf(t) === sport);
  const defaultTeam = teams.find((t) => t.id === defaultTeamId);
  const [home, setHome] = useState<TeamDraft>(() =>
    defaultTeam
      ? fromTeam(defaultTeam)
      : { ...blank(HOME_COLOR), name: defaultTeamName ?? '' },
  );
  const [away, setAway] = useState<TeamDraft>(() => blank(AWAY_COLOR));
  const [loading, setLoading] = useState(false);
  function uploading(value: boolean) {
    setLoading(value);
    onLoading(value);
  }
  function side(
    label: string,
    draft: TeamDraft,
    setDraft: (draft: TeamDraft) => void,
    color: string,
  ) {
    return (
      <section className="match-team-setup">
        <label>
          {label} selection
          <select
            value={draft.teamId ?? ''}
            disabled={loading}
            onChange={(e) => {
              const team = teams.find((t) => t.id === e.target.value);
              setDraft(team ? fromTeam(team) : blank(color));
            }}
          >
            <option value="">+ Add new team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <TeamFields
          key={draft.teamId ?? 'new'}
          label={label}
          draft={draft}
          onChange={setDraft}
          onLoading={uploading}
        />
        <small>
          {draft.teamId
            ? 'Changes here apply to this match only.'
            : 'This team will be saved for future games.'}
        </small>
      </section>
    );
  }
  return (
    <fieldset disabled={loading} className="match-setup">
      <label>
        Sport
        <select
          name="sport"
          value={sport}
          onChange={(e) => {
            const next = e.target.value as Sport;
            setSport(next);
            setHome({ ...blank(HOME_COLOR), sport: next });
            setAway({ ...blank(AWAY_COLOR), sport: next });
          }}
        >
          <option value="volleyball">Volleyball</option>
          <option value="football">Football · Pop Warner tackle</option>
        </select>
      </label>
      {side('Home team', home, setHome, HOME_COLOR)}
      <button
        type="button"
        className="swap"
        onClick={() => {
          setHome(away);
          setAway(home);
        }}
      >
        ⇅ Swap home / away
      </button>
      {side('Away team', away, setAway, AWAY_COLOR)}
      <input
        type="hidden"
        name="homeAppearance"
        value={JSON.stringify({ ...home, sport })}
      />
      <input
        type="hidden"
        name="awayAppearance"
        value={JSON.stringify({ ...away, sport })}
      />
      <p className="muted">
        {sport === 'football'
          ? 'Four quarters, then overtime if needed. Extra-point kick: 2 points; run / pass conversion: 1 point.'
          : 'Pick colors you’ll recognize on court. You’ll start Set 1 when play begins.'}
      </p>
    </fieldset>
  );
}

export function TeamLibrary({
  syncControls,
  teams,
  initialSport = 'volleyball',
  busy,
  onSave,
  onDelete,
  error,
}: {
  syncControls?: import('react').ReactNode;
  teams: Team[];
  initialSport?: Sport;
  error: string;
  busy: boolean;
  onSave: (team: Team, done: () => void, editing: boolean) => void;
  onDelete: (teamId: string, done: () => void) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState<Team>();
  const [deleting, setDeleting] = useState(false);
  const [draft, setDraft] = useState<TeamDraft>(blank(HOME_COLOR));
  const [loading, setLoading] = useState(false);
  function open(team?: Team) {
    setEditing(team);
    setDeleting(false);
    setDraft(
      team ? fromTeam(team) : { ...blank(HOME_COLOR), sport: initialSport },
    );
    dialog.current?.showModal();
  }
  return (
    <section className="team-library">
      <div className="section-heading">
        <h2>
          Your teams <span className="count">{teams.length}</span>
        </h2>
        <button disabled={busy} onClick={() => open()}>
          + Add team
        </button>
      </div>
      {syncControls}
      {!teams.length && (
        <p>Save team colors and logos once, then use them in any game.</p>
      )}
      <div className="team-list">
        {teams.map((team) => (
          <button
            className="list-card"
            disabled={busy}
            key={team.id}
            onClick={() => open(team)}
          >
            {team.logo && <img className="team-logo" src={team.logo} alt="" />}
            <span
              className="team-swatch"
              style={{ backgroundColor: team.primaryColor }}
            />
            <span>
              <strong>{team.name}</strong>
              <small>
                {team.shortName || 'Edit team'}
                {sportOf(team) === 'football' ? ' · Football' : ''}
              </small>
            </span>
          </button>
        ))}
      </div>
      <dialog
        ref={dialog}
        onCancel={(e) => {
          if (busy || loading) e.preventDefault();
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (loading || busy || deleting || !draft.name.trim()) return;
            const now = new Date().toISOString();
            onSave(
              {
                id: editing?.id ?? id(),
                sport: draft.sport,
                name: draft.name.trim(),
                shortName: draft.shortName,
                logo: draft.logo,
                primaryColor: draft.primaryColor,
                secondaryColor: draft.secondaryColor,
                createdAt: editing?.createdAt ?? now,
                updatedAt: now,
              },
              () => dialog.current?.close(),
              !!editing,
            );
          }}
        >
          {deleting && editing ? (
            <>
              <h2>Delete {editing.name}?</h2>
              <p>
                Remove this team from your saved teams and future game
                selections. If team sync is enabled, this deletion also syncs to
                your other devices. Existing games, scores, logos and live
                scoreboards will stay as they are.
              </p>
              <p>
                Any tournament using this team as its default will have that
                default cleared. This cannot be undone.
              </p>
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <div className="toolbar">
                <button
                  type="button"
                  disabled={busy}
                  autoFocus
                  onClick={() => setDeleting(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() =>
                    onDelete(editing.id, () => dialog.current?.close())
                  }
                >
                  Delete permanently
                </button>
              </div>
            </>
          ) : (
            <>
              <h2>{editing ? 'Edit team' : 'Add team'}</h2>
              <label>
                Sport
                <select
                  value={sportOf(draft)}
                  disabled={!!editing || busy || loading}
                  onChange={(e) =>
                    setDraft({ ...draft, sport: e.target.value as Sport })
                  }
                >
                  <option value="volleyball">Volleyball</option>
                  <option value="football">Football</option>
                </select>
              </label>
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <TeamFields
                key={editing?.id ?? 'new'}
                label="Team"
                draft={draft}
                onChange={setDraft}
                onLoading={setLoading}
              />
              <p className="muted">
                Saved matches keep their original names, colors, and logos.
              </p>
              <div className="toolbar">
                <button
                  type="button"
                  disabled={busy || loading}
                  onClick={() => dialog.current?.close()}
                >
                  Cancel
                </button>
                <button className="primary" disabled={busy || loading}>
                  Save team
                </button>
              </div>
              {editing && (
                <div className="danger-zone">
                  <button
                    type="button"
                    className="danger"
                    disabled={busy || loading}
                    onClick={() => setDeleting(true)}
                  >
                    Delete team
                  </button>
                </div>
              )}
            </>
          )}
        </form>
      </dialog>
    </section>
  );
}
