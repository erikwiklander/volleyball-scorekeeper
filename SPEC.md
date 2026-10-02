# Volleyball Scorekeeper PWA --- Product & Implementation Specification

## 1. Purpose

Build a simple, reliable, phone-first web application for recording
volleyball scores during tournaments.

The scorekeeper records every scoring action with an accurate wall-clock
timestamp. The resulting event data can later be synchronized with match
video so a separate video-processing tool can render a scoreboard
overlay at the correct times.

The application should work well for tournaments containing many matches
and should retain tournament, match, set, and scoring history on the
device.

The first version should be intentionally small and require no backend,
account, login, or internet connection during scoring.

------------------------------------------------------------------------

## 2. Primary Goals

1.  Make scoring a point require one obvious tap.
2.  Record an accurate timestamp for every scoring action.
3.  Make accidental scoring mistakes easy to undo.
4.  Never lose an in-progress match because the browser sleeps, reloads,
    closes, or navigates away.
5.  Support multiple matches within a tournament.
6.  Preserve completed tournaments and matches locally.
7.  Export score/event data for later video processing.
8.  Work offline after installation/loading.
9.  Be installable as a PWA on iPhone and Android.
10. Keep the UI simple enough to operate while watching a live
    volleyball match.

------------------------------------------------------------------------

## 3. Non-Goals for V1

Do not implement these unless required by the core architecture:

-   User accounts
-   Authentication
-   Backend/API
-   Cloud synchronization
-   Multi-device synchronization
-   Player rosters
-   Player statistics
-   Rotations
-   Serving order
-   Lineups
-   Volleyball rule enforcement
-   Automatic winner detection beyond simple score display
-   Video editing/rendering
-   Video upload
-   Live public score sharing
-   Push notifications

The scorekeeper should record what the operator enters rather than
attempt to referee the match.

------------------------------------------------------------------------

## 4. Target Platform

Primary target:

-   iPhone using Safari / installed PWA

Secondary targets:

-   Android Chrome
-   Desktop browsers for reviewing/exporting data

Suggested implementation:

-   React
-   TypeScript
-   Vite
-   PWA/service worker
-   IndexedDB for persistent application data

Avoid introducing a backend for V1.

------------------------------------------------------------------------

## 5. Core Data Hierarchy

The application data hierarchy is:

``` text
Tournament
  └── Match
       └── Set
            └── Score Events
```

A tournament contains multiple matches.

A match contains one or more sets.

Every score-changing action produces an immutable event.

------------------------------------------------------------------------

## 6. Tournament Model

Suggested fields:

``` ts
interface Tournament {
  id: string;
  name: string;
  date?: string;
  location?: string;

  defaultTeamName?: string;
  defaultTeamShortName?: string;

  createdAt: string;
  updatedAt: string;
}
```

Example:

``` json
{
  "id": "tournament_01",
  "name": "Grizzly Classic",
  "date": "2026-09-12",
  "defaultTeamName": "Vandegrift",
  "defaultTeamShortName": "VHS"
}
```

### Tournament behavior

The user must be able to:

-   Create a tournament
-   View existing tournaments
-   Open a tournament
-   Edit tournament metadata
-   See all matches belonging to a tournament
-   Start a new match
-   Resume an unfinished match
-   Review a completed match
-   Export tournament data
-   Delete a tournament after confirmation

Deleting a tournament deletes its matches and events.

A strong confirmation should be required.

------------------------------------------------------------------------

## 7. Match Model

Suggested fields:

``` ts
type MatchStatus = "not_started" | "in_progress" | "completed";

interface Match {
  id: string;
  tournamentId: string;

  homeTeam: string;
  awayTeam: string;

  status: MatchStatus;

  startedAt?: string;
  completedAt?: string;

  createdAt: string;
  updatedAt: string;
}
```

The app does not need to assume that the user's team is always home or
away.

### Match list

Example tournament screen:

``` text
Grizzly Classic
September 12, 2026

Vandegrift vs Manor          W 2-0
Vandegrift vs Lake Travis    W 2-1
Vandegrift vs Westlake       L 1-2

+ New Match
```

An unfinished match should be visually obvious:

``` text
Vandegrift vs Westlake
IN PROGRESS — Set 2 — 14-11
```

------------------------------------------------------------------------

## 8. Set Model

Suggested fields:

``` ts
interface VolleyballSet {
  id: string;
  matchId: string;

  setNumber: number;

  homeScore: number;
  awayScore: number;

  startedAt: string;
  completedAt?: string;
}
```

The displayed score may be derived from events rather than treated as
authoritative persisted state.

Event history should be the source of truth.

------------------------------------------------------------------------

## 9. Score Event Model

This is the most important data structure in the application.

Suggested model:

``` ts
type ScoreAction =
  | "HOME_POINT"
  | "AWAY_POINT"
  | "UNDO"
  | "SET_STARTED"
  | "SET_ENDED"
  | "MATCH_STARTED"
  | "MATCH_ENDED"
  | "SYNC_MARKER";

interface ScoreEvent {
  id: string;

  tournamentId: string;
  matchId: string;
  setId?: string;
  setNumber?: number;

  timestamp: string;
  epochMs: number;

  action: ScoreAction;

  homeScore: number;
  awayScore: number;

  targetEventId?: string;
}
```

### Timestamp requirements

Every event must store:

1.  ISO-8601 wall-clock timestamp
2.  Unix epoch timestamp in milliseconds

Example:

``` json
{
  "timestamp": "2026-09-12T19:14:32.183-05:00",
  "epochMs": 1789258472183
}
```

Milliseconds should be preserved.

Do not use an incrementing JavaScript timer as the authoritative clock.

The timestamp should be captured when the scoring action occurs.

------------------------------------------------------------------------

## 10. Immutable Event History

Scoring history should be append-only.

If the operator accidentally awards a point and presses Undo, do not
delete the original point event.

Instead create an `UNDO` event referring to the event being reversed.

Example:

``` text
19:14:32.183 HOME_POINT  12-9
19:15:01.442 AWAY_POINT  12-10
19:15:18.917 UNDO        12-9
19:15:23.104 AWAY_POINT  12-10
```

This provides:

-   Recovery from mistakes
-   Auditability
-   Better video synchronization
-   Ability to reconstruct the exact scoring session

The UI can present a simplified history while retaining the complete
event log.

------------------------------------------------------------------------

## 11. Scoring Screen

This is the most important UI.

It should be optimized for portrait phone use and require minimal
attention.

Example:

``` text
Vandegrift vs Westlake
SET 2

┌─────────────────────────┐
│      VANDEGRIFT         │
│                         │
│           14            │
│                         │
│         + POINT         │
└─────────────────────────┘

            14 - 11

┌─────────────────────────┐
│       WESTLAKE          │
│                         │
│           11            │
│                         │
│         + POINT         │
└─────────────────────────┘

            UNDO

        END SET
```

Alternative side-by-side layout is acceptable on larger screens.

### Requirements

The point controls must:

-   Be very large
-   Be visually distinct
-   Have generous touch targets
-   Respond immediately
-   Avoid tiny controls near the scoring buttons

A successful tap should provide subtle feedback such as:

-   Brief visual animation
-   Optional vibration using supported browser APIs

Do not require confirmation for adding a normal point.

------------------------------------------------------------------------

## 12. Undo Behavior

Undo must be easy to access but harder to trigger accidentally than a
scoring button.

Pressing Undo:

1.  Finds the most recent active score-changing event.
2.  Appends an `UNDO` event referencing it.
3.  Recalculates the displayed score.
4.  Immediately persists the new event.

Undo should support repeated corrections.

Example:

``` text
Home +1
Away +1
Away +1
UNDO
UNDO
```

Result should correctly reconstruct the state.

Do not simply decrement whichever score currently appears.

------------------------------------------------------------------------

## 13. Set Management

The user should explicitly start and end sets.

### Start Set

When starting a set:

-   Increment/set the set number
-   Reset displayed scores to 0-0
-   Create a `SET_STARTED` event
-   Persist immediately

### End Set

The user taps `End Set`.

Display confirmation:

``` text
End Set 2?

Vandegrift 25
Westlake   21

[Cancel] [End Set]
```

The app should not require scores to satisfy official volleyball winning
rules.

The operator may be recording unusual formats, shortened tournament
sets, or corrections.

------------------------------------------------------------------------

## 14. Match Completion

After ending a set, offer:

``` text
Start Set 3
Complete Match
```

Completing the match creates a `MATCH_ENDED` event and records
`completedAt`.

Completed matches remain editable only through explicit
correction/reopen functionality if implemented.

For V1, reopening a completed match can be omitted if it significantly
increases complexity.

------------------------------------------------------------------------

## 15. Persistence and Crash Recovery

This is a critical requirement.

Every meaningful action must be persisted immediately.

Use IndexedDB rather than relying solely on React state.

Persist:

-   Tournaments
-   Matches
-   Sets
-   Score events
-   Current active tournament
-   Current active match
-   Current active set

If the browser:

-   Refreshes
-   Crashes
-   Is killed by iOS
-   Navigates away
-   Phone locks
-   PWA closes

the user must be able to reopen the app and continue from the previously
persisted state.

Example:

``` text
Resume Match?

Vandegrift vs Westlake
Set 2
14 - 11

[Resume]
```

There should never be a requirement for the JavaScript process to remain
running to preserve match timing.

------------------------------------------------------------------------

## 16. Screen Wake Lock

While the scoring screen is active, request the Screen Wake Lock API
where supported.

Requirements:

-   Request wake lock when scoring begins/resumes.
-   Re-request when the page becomes visible again if necessary.
-   Gracefully handle unsupported browsers or denied wake locks.
-   Never make scoring depend on wake lock availability.

If wake lock cannot be maintained, scoring still works correctly because
events use wall-clock timestamps.

------------------------------------------------------------------------

## 17. Navigation Protection

Accidental navigation during scoring should not destroy state.

Because state is persisted continuously, navigation is recoverable.

Additionally:

-   Minimize navigation controls on the scoring screen.
-   Warn before intentionally abandoning an active match where
    appropriate.
-   Use `beforeunload` where useful, but do not rely on it for
    persistence.
-   Returning to the app should prominently offer to resume the active
    match.

------------------------------------------------------------------------

## 18. Offline / PWA Requirements

The application should be installable as a PWA.

After initial installation/load, core functionality must work without
network connectivity.

Cache the application shell using a service worker.

Offline functionality must include:

-   Opening the app
-   Viewing tournaments
-   Creating matches
-   Scoring
-   Undo
-   Starting/ending sets
-   Completing matches
-   Viewing history
-   Exporting data

No network request should be required to record a point.

------------------------------------------------------------------------

## 19. Synchronization Marker

Provide an optional `SYNC` action intended for later video
synchronization.

Pressing it creates:

``` ts
action: "SYNC_MARKER"
```

with an exact timestamp.

The UI could present:

``` text
Video Sync Marker
```

or place it in a secondary menu so it cannot be confused with scoring.

A sync marker can be created while performing an obvious visual action
visible on camera, such as showing the phone or making a deliberate
gesture.

Multiple sync markers may exist.

The video-processing system can later use one of these timestamps to
calculate the offset between video time and score-event time.

------------------------------------------------------------------------

## 20. Match History

Opening a completed match should show:

``` text
Vandegrift vs Westlake

Final: 2-1

Set 1    25-18
Set 2    21-25
Set 3    15-12

Started: 2:04 PM
Ended:   3:17 PM

View Events
Export CSV
```

`View Events` can display a chronological log.

Example:

``` text
14:04:02.112  Match started
14:04:08.441  Set 1 started
14:04:22.819  Vandegrift +1   1-0
14:04:49.102  Westlake +1     1-1
...
```

------------------------------------------------------------------------

## 21. CSV Export

Each match must be exportable as CSV.

Suggested columns:

``` csv
tournament_id,tournament_name,match_id,set_number,timestamp,epoch_ms,action,home_team,away_team,home_score,away_score,target_event_id
```

Example:

``` csv
tournament_01,Grizzly Classic,match_03,1,2026-09-12T19:14:32.183-05:00,1789258472183,HOME_POINT,Vandegrift,Westlake,12,9,
tournament_01,Grizzly Classic,match_03,1,2026-09-12T19:15:01.442-05:00,1789258501442,AWAY_POINT,Vandegrift,Westlake,12,10,
```

CSV should contain the complete event history, including undo and sync
events.

Do not export only the final score sequence.

------------------------------------------------------------------------

## 22. Tournament Export

Provide an `Export Tournament` action.

Preferred V1 options:

### Option A --- JSON

Export one JSON document containing:

-   Tournament metadata
-   Matches
-   Sets
-   Complete event history

This is easiest to implement and preserves the complete model.

### Option B --- ZIP

A later enhancement may produce:

``` text
grizzly-classic/
  tournament.json
  vandegrift-manor.csv
  vandegrift-lake-travis.csv
  vandegrift-westlake.csv
```

For V1, JSON tournament export plus individual match CSV export is
sufficient.

------------------------------------------------------------------------

## 23. Import / Backup

If straightforward, support importing a previously exported tournament
JSON file.

This provides simple backup/restore without requiring a backend.

Import must:

-   Validate file structure
-   Avoid silently overwriting existing tournaments
-   Generate new IDs or ask for confirmation if IDs conflict

This is desirable but may be deferred until after the core scoring
workflow works.

------------------------------------------------------------------------

## 24. Home Screen

Suggested home screen:

``` text
VOLLEYBALL SCOREKEEPER

Active
────────────────────────
Grizzly Classic
Vandegrift vs Westlake
Set 2 — 14-11

[RESUME]

Tournaments
────────────────────────
Grizzly Classic        Sep 12
Westwood Showcase      Sep 19
AISD Tournament        Sep 26

+ New Tournament
```

If an active match exists, Resume should be the dominant action.

------------------------------------------------------------------------

## 25. New Match Flow

Within a tournament:

``` text
New Match

Home Team
[Vandegrift          ]

Away Team
[Westlake            ]

[Start Match]
```

Tournament defaults should reduce repetitive typing.

If `defaultTeamName = Vandegrift`, pre-populate one team field.

The user should still be able to swap home/away.

------------------------------------------------------------------------

## 26. Reliability Principles

The application is being used live. Reliability matters more than visual
sophistication.

Follow these principles:

### Persist first

When a score button is tapped:

1.  Construct event with timestamp.
2.  Persist event.
3.  Update/reconcile UI.

Avoid designs where important state exists only in React memory.

### Events are authoritative

The current score should always be reconstructable from persisted
events.

### Never depend on connectivity

Scoring must not wait for a network operation.

### Never depend on a running timer

Use timestamps from the system clock.

### Make destructive actions explicit

Deleting tournaments/matches requires confirmation.

Normal scoring does not.

------------------------------------------------------------------------

## 27. Suggested IndexedDB Stores

One possible schema:

``` text
tournaments
matches
sets
events
appState
```

Suggested indexes:

``` text
matches:
  tournamentId

sets:
  matchId

events:
  matchId
  setId
  timestamp
  epochMs
```

`appState` can contain:

``` ts
interface AppState {
  activeTournamentId?: string;
  activeMatchId?: string;
  activeSetId?: string;
}
```

Use a small IndexedDB wrapper library if helpful, for example Dexie.

Avoid localStorage for the authoritative event store.

------------------------------------------------------------------------

## 28. Event Ordering

Normally events are ordered by `epochMs`.

Because two actions could theoretically receive the same millisecond
timestamp, each event must also have a unique ID.

Use ordering:

1.  `epochMs`
2.  Event creation sequence or sortable unique ID

Do not assume timestamps alone are globally unique.

------------------------------------------------------------------------

## 29. Time Changes

Persist absolute timestamps.

The application should not rewrite old timestamps if:

-   Time zone changes
-   Daylight saving time changes
-   Device locale changes

Store `epochMs` as the authoritative instant.

ISO timestamp is retained for readability/export.

------------------------------------------------------------------------

## 30. Score Reconstruction

Implement score calculation as a pure function where practical.

Conceptually:

``` ts
calculateScore(events): {
  homeScore: number;
  awayScore: number;
}
```

It should:

-   Process events in deterministic order
-   Apply point events
-   Account for undo events
-   Ignore metadata events for scoring
-   Produce current score from event history

This logic should have strong automated tests.

------------------------------------------------------------------------

## 31. Testing Requirements

At minimum, automated tests should cover:

### Score calculation

-   Home scores one point
-   Away scores one point
-   Multiple points
-   Undo home point
-   Undo away point
-   Multiple undos
-   Point after undo

### Sets

-   Starting new set resets displayed score
-   Previous set remains unchanged
-   Events belong to correct set

### Persistence

-   Reload restores active match
-   Reload restores current set and score
-   Completed matches remain available

### Export

-   CSV contains correct timestamps
-   CSV contains undo events
-   CSV contains sync markers
-   CSV correctly escapes team/tournament names containing commas or
    quotes

### Time

-   Millisecond timestamps retained
-   Event ordering deterministic

------------------------------------------------------------------------

## 32. UX Safety Requirements

Because the user is watching a match rather than the phone:

-   Important buttons must be usable one-handed.
-   Avoid modal dialogs during normal scoring.
-   Avoid gestures as the only way to perform an action.
-   Do not place destructive controls close to point buttons.
-   Keep text readable outdoors.
-   Support high contrast.
-   Avoid screen layouts that shift when a score changes from one to two
    digits.
-   Keep team names visible while scoring.
-   Display set number prominently.
-   Make Undo visible at all times during active scoring.

------------------------------------------------------------------------

## 33. Accessibility

At minimum:

-   Semantic buttons
-   Accessible labels
-   Sufficient contrast
-   Large touch targets
-   Do not rely exclusively on color to identify teams/actions
-   Support browser text scaling reasonably

------------------------------------------------------------------------

## 34. Future Video Processing Integration

Video processing is outside V1, but the scorekeeper data format must
support it.

Future workflow:

``` text
Video file
     +
Match event export
     +
Synchronization point
     ↓
Video processor
     ↓
MP4 with scoreboard overlay
```

If:

``` text
syncEventTimestamp = 19:14:32.183
```

corresponds to:

``` text
videoTime = 00:03:12.500
```

then the processor can derive the offset and map every scoring event to
a video timestamp.

For this reason, do not discard:

-   Milliseconds
-   Undo events
-   Sync events
-   Set boundaries
-   Original wall-clock timestamps

------------------------------------------------------------------------

## 35. Potential Future Enhancements

Not part of initial implementation:

-   Video overlay generator using FFmpeg
-   Automatic matching of videos to matches
-   Cloud backup
-   Shared tournament scoring
-   Live spectator scoreboard
-   Apple Watch scoring
-   Team presets
-   Opponent history
-   Season organization
-   Match notes
-   Serve tracking
-   Score correction/history editor
-   Automatic sync using audio/visual markers
-   Direct video import
-   Automatic scoreboard rendering
-   iCloud/file-system backup
-   Tournament CSV/ZIP bundle

Architecture should not unnecessarily prevent these additions, but V1
should not implement them.

------------------------------------------------------------------------

## 36. Suggested Implementation Phases

### Phase 1 --- Core Domain

Implement:

-   Data types
-   IndexedDB schema
-   Event persistence
-   Score reconstruction
-   Unit tests

No elaborate UI required.

### Phase 2 --- Tournament Management

Implement:

-   Tournament list
-   Create tournament
-   Tournament detail
-   New match
-   Match list

### Phase 3 --- Live Scoring

Implement:

-   Start match
-   Start set
-   Large scoring controls
-   Undo
-   End set
-   Complete match
-   Resume after reload

This phase should be considered the first usable version.

### Phase 4 --- PWA Reliability

Implement:

-   Service worker
-   Offline application shell
-   Installability
-   Wake lock
-   Visibility/resume handling
-   Navigation protection

### Phase 5 --- History and Export

Implement:

-   Match history
-   Event history
-   CSV export
-   Tournament JSON export
-   Sync markers

### Phase 6 --- Polish

Implement:

-   Better responsive layout
-   Haptic feedback where supported
-   Accessibility review
-   Outdoor/high-contrast usability
-   Import/backup if desired

------------------------------------------------------------------------

## 37. Definition of Done for V1

V1 is complete when this scenario works reliably:

1.  User installs/opens the PWA.
2.  User creates `Grizzly Classic`.
3.  User sets `Vandegrift` as the default team.
4.  User creates a match against `Manor`.
5.  User starts Set 1.
6.  User records points throughout the set.
7.  User accidentally awards the wrong team a point.
8.  User presses Undo.
9.  Correct event history is retained.
10. Phone locks during the match.
11. User unlocks/reopens the app.
12. Match resumes with the correct score.
13. User finishes the match.
14. User creates several additional matches in the same tournament.
15. All completed matches remain visible.
16. User opens any previous match and reviews its set scores.
17. User exports a match CSV.
18. CSV contains accurate millisecond timestamps and complete scoring
    history.
19. User exports the tournament as JSON.
20. All of the above works without a network connection after the app
    has been cached/installed.

------------------------------------------------------------------------

## 38. Codex Implementation Guidance

When implementing this specification:

-   Favor simple, explicit code over unnecessary abstraction.
-   Keep domain/event logic separate from React components.
-   Treat IndexedDB as authoritative persistence.
-   Write score reconstruction as testable pure logic.
-   Add tests as domain behavior is implemented.
-   Do not introduce a backend.
-   Do not introduce authentication.
-   Do not expand scope into player statistics or volleyball rule
    enforcement.
-   Ensure the application can recover correctly after reload before
    spending significant effort on styling.
-   Implement incrementally so each phase leaves the application
    runnable.

If a requirement is ambiguous, favor reliability and simplicity for a
parent operating a phone while watching a live volleyball match.
