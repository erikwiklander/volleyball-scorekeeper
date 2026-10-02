# Volleyball Scorekeeper

A phone-first, offline volleyball scorekeeper. React + TypeScript + Vite, IndexedDB, and a precached PWA. No backend, account, external fonts, or network calls during scoring.

## Run locally

Requires Node 22.12+ (Node 24 also works).

```sh
npm ci
npm run dev
```

Production/offline preview:

```sh
npm run build
npm run preview
```

Service workers require HTTPS or localhost. Offline caching is enabled in production builds, not the development server. Wait for **Offline ready** before disconnecting.

## Checks

```sh
npm test
npm run build
npx playwright install chromium webkit
npm run test:e2e
```

WebKit offline reload emulation is excluded because of [Playwright issue #42775](https://github.com/microsoft/playwright/issues/42775). WebKit still tests online reload recovery and offline scoring/export. Its offline emulation also produced `NotReadableError` for local file reads; that suite restores connectivity before backup import. Chromium tests both offline reload and offline backup import. Both run under a repository-style subfolder URL.

Tests cover scoring, repeated undo, clock changes, timestamps, sets, completed matches, database reopen, concurrent connections, rollback, CSV escaping, backup validation, and a phone-sized Chromium and WebKit browser workflows including offline reload and exports.

## GitHub Pages

Push this folder as the repository root on `main`. In GitHub **Settings → Pages → Build and deployment**, select **GitHub Actions**. The included workflow tests, builds, and deploys `dist`. Pull requests run the same checks without deploying. Relative asset paths support both repository Pages URLs and custom domains; navigation does not depend on server routes.

Repository: [erikwiklander/volleyball-scorekeeper](https://github.com/erikwiklander/volleyball-scorekeeper).

## Use

1. Tap **New game** on the home screen. No tournament setup is required.
2. Enter both team names and colors; swapping home/away also swaps their colors. Scoring buttons use the selected colors with contrasting text. Existing matches retain the original default colors.
3. Explicitly start Set 1. Tap a team’s large button to award a point.
4. Undo reverses the latest active point in the current set. Repeated undo is supported.
5. Face the phone toward the running camera and tap Video sync marker. A bright full-screen card shows SYNC 1 (then 2, 3, …), both team names, and the timestamp for three seconds. Sync is available before play, during a set, and between sets. Match the first bright video frame to the exported marker timestamp.
6. Confirm End set, then start another set or complete the match.
7. Export a match CSV or game JSON backup. One-off games stay in **Your games**.

For tournaments, expand **Tournaments (optional)** on the home screen. Existing tournament records and exports remain available.

Completed sets/matches are read-only. Ties and unusual scores are accepted. Set win totals are simple comparisons, not rule enforcement. New matches are initially `not_started`; MATCH_STARTED is recorded when the first set begins. Multiple unfinished matches are allowed; the most recently selected appears first in Resume.

On iPhone, open Safari’s Share menu and choose Add to Home Screen. On Android, use the browser’s install action. Real-device installation, screen lock/relaunch, and wake-lock behavior should be smoke-tested on the target phones before tournament use.

## Reliability and data

Every action captures `Date.now()` at the handler before writing. ISO timestamps are UTC with milliseconds; `epochMs` is the authoritative instant. Device time must be set accurately. Event ordering for display/export is epoch milliseconds, then creation sequence, then ID. Undo targets use creation sequence so clock rollback cannot undo the wrong point.

IndexedDB uses five stores: tournaments, matches, sets, events, appState. Mutations read and write within a single strict-durability transaction; React updates only after commit. Concurrent tabs serialize writes and receive refresh notifications. Buttons are briefly disabled during a write. A failed save is visibly reported; it is never displayed as a successful point. Events use insert-only writes, except explicit tournament deletion. Scores are reconstructed from point and undo events. No running timer is required.

The app requests persistent browser storage and a screen wake lock when supported. Browser storage can still be cleared or evicted; no browser app can guarantee data survives clearing site data, private sessions, uninstall behavior, or device loss. Export backups regularly. Storage is specific to the browser/profile/origin. Changing the site domain or GitHub repository path can affect access; export before moving the site.

Service-worker updates wait until existing app clients close, avoiding an automatic reload during scoring. No external runtime resources are needed offline.

## Export contract (version 1)

Tournament JSON contains `schemaVersion`, `exportedAt`, tournament metadata, matches, sets, and all events. Sets have no authoritative stored score; reconstruct it from events. CSV includes the spec’s suggested columns plus `event_id`, `set_id`, and `sequence` for unambiguous references and ordering. CSV retains original input text, so treat team/tournament names as text when importing into spreadsheet software.

Import accepts version 1 exports, validates types/references/timestamps, and generates fresh IDs for every entity and reference. Existing data is never overwritten. Event sequence numbers receive an offset; original timestamps and scores are retained. Imported active matches are available from Resume and the tournament match list.

For video alignment, map a SYNC_MARKER’s `epochMs` to the known video timestamp, then apply the offset to the complete event stream. Preserve UNDO and set/match boundaries.

The full original requirements are in [SPEC.md](SPEC.md).

Build/deployment references: [Vite static deployment](https://vite.dev/guide/static-deploy.html), [Vite PWA registration](https://vite-pwa-org.netlify.app/guide/register-service-worker).

### Camera sync timing

Each new marker stores `syncNumber`, numbered per match across sets and reloads. CSV adds `sync_number`, `home_color`, and `away_color`; JSON retains those fields as well. Older version 1 backups remain supported. The marker timestamp is captured as the app switches to the bright card, before the database write completes, so write latency is not included in the visual cue. The card shows “Saving marker…” until commit; a failed save dismisses it with an error. Use only saved markers for alignment. Browser rendering and camera frame rates introduce frame-level timing uncertainty. This action creates a video reference point; it does not adjust the device clock.

### Standalone games

Matches and events may omit `tournamentId`. No placeholder tournament is created. A standalone game backup uses the same version 1 JSON envelope (`matches`, `sets`, `events`) with exactly one match and no `tournament` property. CSV tournament columns are blank for these games. Import restores a standalone game with new IDs and preserves its scoring history; existing tournament backups remain supported.
