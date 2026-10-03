# Volleyball Scorekeeper

A phone-first, offline volleyball scorekeeper. React + TypeScript + Vite, IndexedDB, and a precached PWA. Scoring never depends on network access. Optional live sharing uses Firebase; spectators need no account.

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

WebKit offline reload emulation is excluded because of [Playwright issue #42775](https://github.com/microsoft/playwright/issues/42775). WebKit still tests online reload recovery and offline scoring/export. Its offline emulation also blocks local file reads and blob-image decoding; that suite restores connectivity briefly for logo upload and backup import. Chromium tests both offline reload and offline backup import. Both run under a repository-style subfolder URL.

Tests cover scoring, repeated undo, clock changes, timestamps, sets, completed matches, database reopen, concurrent connections, rollback, CSV escaping, backup validation, and a phone-sized Chromium and WebKit browser workflows including offline reload and exports.

## GitHub Pages

Push this folder as the repository root on `main`. In GitHub **Settings → Pages → Build and deployment**, select **GitHub Actions**. The included workflow tests, builds, and deploys `dist`. Pull requests run the same checks without deploying. Relative asset paths support both repository Pages URLs and custom domains; navigation does not depend on server routes.

Repository: [erikwiklander/volleyball-scorekeeper](https://github.com/erikwiklander/volleyball-scorekeeper).

## Use

1. Tap **New game** on the home screen. No tournament setup is required.
2. Choose saved teams or add new teams with names, short names, colors, and optional logos. New teams are saved automatically. Match-specific edits leave the saved defaults unchanged; swapping home/away swaps the complete appearance. Scoring buttons use the selected colors with contrasting text. Existing matches retain the original default colors.
3. Explicitly start Set 1 before recording its video or making a sync marker. Tap a team’s large button to award a point.
4. Undo reverses the latest active point in the current set. Repeated undo is supported.
5. Face the phone toward the running camera and tap Video sync marker during the active set. The phone flashes black → white → black, then shows SYNC 1 (then 2, 3, …), the set number, team names, and timestamp for three seconds. Align the first white pulse frame with the exported marker timestamp. Start each new set before making its marker; old unattached markers remain in historical backups.
6. Confirm End set, then start another set or complete the match.
7. Export a match CSV or game JSON backup. One-off games stay in **Your games**.

For tournaments, expand **Tournaments (optional)** on the home screen. Existing tournament records and exports remain available.

Completed sets/matches are read-only for scoring. To remove a test or unwanted match, open it, expand **Match management**, choose **Delete match**, and confirm **Delete permanently**. This works for standalone games and tournament matches in any status. Deletion removes the match, its sets, and all its events together; saved teams, the tournament, and other matches remain. Ties and unusual scores are accepted. Set win totals are simple comparisons, not rule enforcement. New matches are initially `not_started`; MATCH_STARTED is recorded when the first set begins. Multiple unfinished matches are allowed; the most recently selected appears first in Resume.

On iPhone, open Safari’s Share menu and choose Add to Home Screen. On Android, use the browser’s install action. Real-device installation, screen lock/relaunch, and wake-lock behavior should be smoke-tested on the target phones before tournament use.

## Reliability and data

Every action captures `Date.now()` at the handler before writing. ISO timestamps are UTC with milliseconds; `epochMs` is the authoritative instant. Device time must be set accurately. Event ordering for display/export is epoch milliseconds, then creation sequence, then ID. Undo targets use creation sequence so clock rollback cannot undo the wrong point.

IndexedDB uses eight stores: teams, tournaments, matches, sets, events, appState, broadcasts, syncQueue. Mutations read and write within a single strict-durability transaction; React updates only after commit. Concurrent tabs serialize writes and receive refresh notifications. Buttons are briefly disabled during a write. A failed save is visibly reported; it is never displayed as a successful point. Events use insert-only writes, except explicit match or tournament deletion. Scores are reconstructed from point and undo events. No running timer is required.

The app requests persistent browser storage and a screen wake lock when supported. Browser storage can still be cleared or evicted; no browser app can guarantee data survives clearing site data, private sessions, uninstall behavior, or device loss. Export backups regularly. Storage is specific to the browser/profile/origin. Changing the site domain or GitHub repository path can affect access; export before moving the site.

Service-worker updates are checked on launch, on returning to the app or reconnecting (at most once per minute), and with **Check for updates**. A downloaded version shows **Update & reload**, disabled while scoring, saving, or editing a match. Only the tab choosing that action reloads; other scoring tabs continue. Neither updates nor update checks clear IndexedDB. No external runtime resources are needed offline.

## Export contract (version 2; version 1 import supported)

Tournament JSON contains `schemaVersion`, `exportedAt`, tournament metadata, referenced reusable teams, matches with frozen appearance snapshots, sets, and all events. Logos are embedded raster data URLs, so backups and restored matches work offline. Saved team edits never change existing match appearances. Sets have no authoritative stored score; reconstruct it from events. CSV includes the spec’s suggested columns plus `event_id`, `set_id`, and `sequence` for unambiguous references and ordering. CSV retains original input text, so treat team/tournament names as text when importing into spreadsheet software.

Import accepts version 1 and version 2 exports, validates types/references/timestamps, and generates fresh IDs for every entity and reference. Existing data is never overwritten. Event sequence numbers receive an offset; original timestamps and scores are retained. Imported active matches are available from Resume and the tournament match list.

For video alignment, map a SYNC_MARKER’s `epochMs` to the known video timestamp, then apply the offset to the complete event stream. Preserve UNDO and set/match boundaries.

The updated product requirements are in [SPEC.md](SPEC.md).

Build/deployment references: [Vite static deployment](https://vite.dev/guide/static-deploy.html), [Vite PWA registration](https://vite-pwa-org.netlify.app/guide/register-service-worker).

### Camera sync timing

Each new marker stores `syncNumber`, numbered per match across sets and reloads, plus `syncCue: "black-white-black-v1"`. CSV and JSON preserve both. New markers require an active set and always include its ID and number. Existing markers are never reassigned or rewritten.

The sequence is black (at least 250 ms) → white (about 200 ms) → black (about 200 ms) → context card (3 seconds after saving). The authoritative instant is captured immediately before the DOM switches to white, after the database read and before the write commits. A failed save dismisses the sequence and reports the error. Use only saved markers for alignment. Browser rendering, display refresh, and camera frame rates introduce frame-level uncertainty; this is not a guarantee of exact camera exposure timing. Keep the app visible throughout the sequence.

### Reusable teams and build identification

Use **Your teams** to create or edit reusable teams. Logos accept PNG, JPEG, or WebP up to 5 MB and are resized locally to at most 256 pixels per side. Tournament defaults can reference a saved team. New games remain available without a tournament.

The IndexedDB version 2 migration adds the teams store without rewriting old matches or event history. Legacy matches keep their original names and colors. JSON imports create new IDs, including team references, and never overwrite current teams.

The footer shows the app version and seven-character build commit. Local modified builds have a `-local` suffix; the build timestamp appears in the label’s tooltip. Installed offline copies show their own cached build identity. Use **Check for updates**, then **Update & reload** after leaving scoring. Older installs that predate these controls need all Scorekeeper tabs and installed app windows closed once so the downloaded worker can activate.

### Standalone games

Matches and events may omit `tournamentId`. No placeholder tournament is created. A standalone game backup uses the same version 2 JSON envelope (`matches`, `sets`, `events`) with exactly one match and no `tournament` property. CSV tournament columns are blank for these games. Import restores a standalone game with new IDs and preserves its scoring history; existing tournament backups remain supported.

### Live score sharing

Open a match, choose **Start live sharing**, then **Share live score**. Anyone with the link can follow the score without signing in. The page shows team colors/logos, the current score, set history, final results, and when the latest score arrived. After 90 seconds without an update it says **Waiting for updates**; this is not a claim that the scorer is disconnected. Viewers reconnect automatically.

Scoring and the latest pending broadcast snapshot are committed in the same IndexedDB transaction. Uploads run separately, retry on reconnect, and coalesce offline changes. Server-enforced increasing revisions prevent delayed uploads or another tab from replacing a newer score. Sharing requires an initial connection; subsequent scoring works offline. Keep or reopen the scorer app while connected to send pending updates—iOS does not guarantee background uploads.

**Stop sharing**, match deletion, and tournament deletion queue a withdrawal. If offline, the last published score remains visible until this device reconnects with the app open. An ownership/revision record remains in Firebase after withdrawal, with the score removed, to reject delayed uploads. Backups contain scoring data but do not copy publishing identities or live links. Clearing site data loses the anonymous publishing identity as well as local matches.

Deployment uses project `ew-volleyball-scorekeeper`. The scorer stays on GitHub Pages; public links use Firebase Hosting. To configure another project, enable Anonymous authentication, create a Realtime Database, and deploy `database.rules.json`. Copy `.env.example` to `.env.local` and fill `VITE_FIREBASE_CONFIG` with the public web-app configuration. Set `VITE_LIVE_BASE_URL` to the viewer hosting URL. These are public settings, not service-account credentials. GitHub Actions reads the corresponding repository variables. With no configuration the app still scores locally.

```sh
npx firebase login --no-localhost
npm run test:live
npm run build
npx firebase deploy --only database,hosting
```

Live tests require Java 21+ for Firebase's local emulator, plus installed Chromium and WebKit. On macOS, `brew install openjdk@21` is sufficient; the test runner detects Homebrew's installation without changing your shell's Java default. The suite builds into `dist-live` using a demo project and never uses production Firebase. It verifies access rules, public viewing, offline points/undo/reload, set results, stopping, and deletion. CI runs these tests before deploying. Firebase Hosting and database rules are deployed separately with the signed-in Firebase CLI.
