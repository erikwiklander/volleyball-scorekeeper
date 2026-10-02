# Club Volleyball Scorekeeper, Live Scores & Video Score Bug

## Product / Implementation Specification

### 1. Vision

Build a phone-first club-volleyball scoring system where each courtside
scoring action serves three purposes:

1.  Keep an authoritative local match record.
2.  Optionally broadcast the live score to family and friends.
3.  Create timestamped data that can later drive an automated, polished
    score bug on recorded video.

The system has three separate components sharing the same match/event
model:

-   **Scorekeeper PWA** - iPhone-first, offline-first courtside app.
-   **Live Scores** - public realtime webpages backed by Firebase.
-   **Video Renderer** - later Mac/desktop tool using FFmpeg to add a
    broadcast-style score bug.

The scorekeeper is the core and must never depend on Firebase or the
video renderer.

------------------------------------------------------------------------

## 2. Guiding Principles

-   Reliability is more important than visual sophistication.
-   Scoring must work with no internet connection.
-   Persist every action locally immediately.
-   IndexedDB is authoritative on the scoring phone.
-   Firebase is only a synchronized broadcast copy.
-   Never depend on a JavaScript stopwatch continuing in the background.
-   Store absolute timestamps with millisecond precision.
-   Event history is append-only and authoritative.
-   Keep courtside interaction extremely simple.
-   Reuse the same domain/event model for scoring, live scores, exports,
    and video rendering.

Suggested stack:

-   React + TypeScript + Vite
-   PWA/service worker
-   IndexedDB, preferably via Dexie
-   Firebase Hosting + Firebase Realtime Database for live scores
-   Node/TypeScript + FFmpeg for the future video renderer

------------------------------------------------------------------------

## 3. Domain Model

``` text
Team
Tournament
  └── Match
       ├── MatchTeam / appearance
       └── Set
            ├── Score Events
            └── Sync Markers
```

Each volleyball set is expected to have its own separate video
recording.

### Team

Teams are reusable across tournaments and matches.

``` ts
interface Team {
  id: string;
  name: string;
  shortName?: string;
  logo?: string;
  primaryColor: string;
  secondaryColor?: string;
  createdAt: string;
  updatedAt: string;
}
```

A team such as `Roots 15 Green` should be configured once and reused.
Opponents can also be saved for future matches.

### Match-specific appearance

Jersey colors can change, so a match can override a team's default
appearance.

``` ts
interface MatchTeam {
  teamId: string;
  displayName: string;
  shortName?: string;
  color: string;
  secondaryColor?: string;
  logo?: string;
}
```

### Tournament

``` ts
interface Tournament {
  id: string;
  name: string;
  date?: string;
  location?: string;
  defaultTeamId?: string;
  createdAt: string;
  updatedAt: string;
}
```

### Match

``` ts
type MatchStatus = "not_started" | "in_progress" | "completed";

interface Match {
  id: string;
  tournamentId: string;
  home: MatchTeam;
  away: MatchTeam;
  status: MatchStatus;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

Do not assume the user's club is always home.

### Set

``` ts
interface VolleyballSet {
  id: string;
  matchId: string;
  setNumber: number;
  startedAt: string;
  completedAt?: string;
}
```

Current scores should be reconstructed from events.

------------------------------------------------------------------------

## 4. Event Model

The event model is central to the product.

``` ts
type MatchEventAction =
  | "MATCH_STARTED"
  | "SET_STARTED"
  | "HOME_POINT"
  | "AWAY_POINT"
  | "UNDO"
  | "SYNC_MARKER"
  | "SET_ENDED"
  | "MATCH_ENDED";

interface MatchEvent {
  id: string;
  tournamentId: string;
  matchId: string;
  setId?: string;
  setNumber?: number;

  timestamp: string; // ISO-8601 with offset
  epochMs: number;   // authoritative instant

  action: MatchEventAction;

  homeScore: number;
  awayScore: number;

  targetEventId?: string;
  syncNumber?: number;
}
```

Every event stores both an ISO timestamp and Unix epoch milliseconds.

Example:

``` json
{
  "timestamp": "2026-10-02T14:42:17.382-05:00",
  "epochMs": 1790960537382
}
```

Milliseconds must be preserved.

------------------------------------------------------------------------

## 5. Immutable History and Undo

Never delete a scoring event during ordinary correction.

If the wrong team receives a point, append an `UNDO` event referencing
the event being reversed.

``` text
19:14:32.183  HOME_POINT  12-9
19:15:01.442  AWAY_POINT  12-10
19:15:18.917  UNDO        12-9
19:15:23.104  AWAY_POINT  12-10
```

Implement deterministic pure domain functions such as:

``` ts
calculateSetScore(events)
calculateMatchState(events)
```

Tests must cover multiple points, home/away undo, repeated undo, points
after undo, set boundaries, and completed-set results.

------------------------------------------------------------------------

## 6. Team and Match Setup

Creating a match should allow selection of reusable teams and their
match-specific colors.

``` text
NEW MATCH

Team A
[ Roots 15 Green ▼ ]
Color: [ GREEN ]
Logo:  [ Roots logo ]

Team B
[ Austin Juniors ▼ ]
Color: [ BLUE ]
Logo:  [ Austin Juniors logo ]

[ START MATCH ]
```

If the opponent does not exist, allow `+ Add New Team` with:

-   Team name
-   Short name
-   Primary color
-   Optional secondary color
-   Optional logo

Save it for reuse.

------------------------------------------------------------------------

## 7. Courtside Scoring UI

The live scoring screen must be optimized for portrait phone use and
one-handed operation.

``` text
ROOTS vs AUSTIN JUNIORS
SET 2

┌───────────────────────────┐
│       [ROOTS LOGO]        │
│     ROOTS 15 GREEN        │
│            18             │
│          + POINT          │
└───────────────────────────┘

             18 - 16

┌───────────────────────────┐
│       [AUSTIN LOGO]       │
│      AUSTIN JUNIORS       │
│            16             │
│          + POINT          │
└───────────────────────────┘

          [ UNDO ]
          [ SYNC ]
        [ END SET ]
```

Each team's large scoring button should prominently use that team's
selected match color. This is specifically intended to make the buttons
easy to remember while watching the court.

Never rely only on color. Also show team name, logo when available, and
score.

Normal scoring must require exactly one tap and no confirmation.

------------------------------------------------------------------------

## 8. Persistence and Recovery

Suggested IndexedDB stores:

``` text
teams
tournaments
matches
sets
events
appState
syncQueue
```

`appState` should identify the active tournament, match, and set.

Persist every meaningful action immediately.

The app must recover correctly after:

-   Browser refresh
-   Safari/PWA being killed
-   Phone lock/sleep
-   Accidental navigation
-   Temporary network loss

On reopen:

``` text
RESUME MATCH

Roots 15 Green vs Austin Juniors
Set 2
18 - 16

[ RESUME ]
```

React memory must never be the only copy of scoring state.

------------------------------------------------------------------------

## 9. PWA and Wake Lock

The app should be installable as a PWA.

After initial caching/install, all core scoring functionality must work
offline.

Request Screen Wake Lock while actively scoring where supported.
Re-request when the page becomes visible again if necessary.

Wake lock is convenience only. Correct scoring/timestamps must not
depend on it.

------------------------------------------------------------------------

## 10. Set-Level Video Recording

A core workflow assumption is **one movie per set**.

``` text
Roots vs Austin Juniors
├── Set 1 → set-1.mov
├── Set 2 → set-2.mov
└── Set 3 → set-3.mov
```

This makes each recording independently synchronizable and simplifies
rendering.

------------------------------------------------------------------------

## 11. Video SYNC Workflow

At the beginning of every set:

1.  Start the camera recording.
2.  Point the camera toward the scoring phone.
3.  Tap `SYNC`.
4.  The scorekeeper records an exact `SYNC_MARKER`.
5.  The phone displays a distinctive visual synchronization sequence.
6.  Point the camera back at the court.
7.  Record the set.

The sync screen should include human-readable context:

``` text
           SYNC 2

   ROOTS vs AUSTIN JUNIORS

           SET 2
```

### Machine-detectable flash

The visual sequence should also be deliberately easy for software to
detect.

Suggested sequence:

``` text
normal → black → white → black → SYNC information → normal
```

The exact transition/frame chosen as the synchronization instant must be
defined consistently.

This provides:

-   Easy manual synchronization by scrubbing to the obvious frame.
-   Future automatic synchronization by detecting the brightness
    pattern.

Allow multiple numbered sync markers (`SYNC 1`, `SYNC 2`, etc.) in case
recording is interrupted.

------------------------------------------------------------------------

## 12. Export

### Match CSV

Suggested columns:

``` csv
tournament_id,tournament_name,match_id,set_number,timestamp,epoch_ms,action,home_team,away_team,home_score,away_score,target_event_id,sync_number
```

Export the complete event history, including undo and sync events.

### Tournament JSON

Export:

-   Tournament metadata
-   Reusable team data needed by the match
-   Match appearance/colors
-   Sets
-   Events
-   Sync markers
-   Logo references/assets as appropriate

Design this format so the future video renderer can consume it directly.

------------------------------------------------------------------------

## 13. Live Score Architecture

Live scoring is separate from video processing.

``` text
Scorekeeper
   │
   ├── IndexedDB (authoritative)
   │
   └── async sync queue
           │
           ▼
        Firebase
           │
           ▼
     Public webpage
```

When a scoring event occurs:

1.  Persist locally.
2.  Recalculate local state.
3.  Update local UI.
4.  Queue cloud synchronization.
5.  Attempt Firebase update asynchronously.

If offline, continue scoring normally. When connectivity returns,
Firebase must eventually converge to the authoritative local state.

Use Firebase Hosting and Firebase Realtime Database initially for
simplicity.

------------------------------------------------------------------------

## 14. Public Live Score Page

No viewer account should be required.

Possible permanent team URL:

``` text
scores.example.com/roots-15-green
```

Possible match URL:

``` text
scores.example.com/roots-15-green/match/abc123
```

Example:

``` text
        ROOTS VOLLEYBALL

   [logo]                 [logo]

ROOTS 15 GREEN       AUSTIN JRS

        18  -  16

          SET 2

SETS        1      2
ROOTS      25     18
AUSTIN     21     16

          ● LIVE

Grizzly Classic
Court 7
```

The page updates automatically without manual refresh.

A later permanent team page can show:

-   Current live match
-   Earlier matches today
-   Upcoming entered matches

Eventually add a `Share Live Score` action using the Web Share API where
supported.

------------------------------------------------------------------------

## 15. Video Renderer

Do not automate iMovie as the core solution.

Create a separate custom renderer, initially as a Node/TypeScript CLI
using FFmpeg.

Example:

``` bash
volleyball-video   --video set-2.mov   --match match.json   --set 2   --sync 00:00:14.520   --output set-2-scored.mp4
```

Inputs:

-   One set video
-   Match/tournament JSON
-   Score events
-   Team logos
-   Team colors
-   Sync mapping

Output:

-   MP4 with polished persistent score bug

The resulting video can optionally be edited later in iMovie or Final
Cut Pro.

------------------------------------------------------------------------

## 16. Video Time Mapping

Example:

``` text
SYNC app timestamp:  18:42:17.382
SYNC video position: 00:00:13.500

Point timestamp:     18:43:02.181
Difference:          +44.799 sec

Point video position:
00:00:58.299
```

Once one sync point is known, every event in that recording can be
mapped to video time.

A later version should automatically scan the beginning of the video for
the distinctive SYNC flash, show the detected point for confirmation,
and allow manual correction.

------------------------------------------------------------------------

## 17. Score Bug

Use the term **score bug** for the persistent broadcast-style graphic
rendered over the video.

Use:

-   **Score bug** - visual graphic on recorded video
-   **Score overlay renderer** - software that creates/applies it
-   **Live scoreboard** - separate public realtime webpage

The score bug should look polished and broadcast-like, not like a
generic iMovie title.

It should contain:

-   Team logos
-   Team names or short names
-   Restrained team-color accents
-   Completed-set scores
-   Current set score
-   Clear visual emphasis on the current set

Avoid large bright blocks of team color. Use color as an accent while
keeping the graphic legible.

------------------------------------------------------------------------

## 18. Stacked Set Scores

The score bug must show previous completed-set scores in addition to the
current set.

This is important because viewers may scrub/jump directly into the
middle of a recorded set.

Example during Set 2:

``` text
┌────────────────────────────────┐
│ [logo] ROOTS       25 │  18   │
│ [logo] AUSTIN JRS  21 │  16   │
│                     S1    S2   │
└────────────────────────────────┘
```

This immediately communicates:

-   Roots won Set 1, 25-21.
-   Current Set 2 score is 18-16.

Example during Set 3:

``` text
┌────────────────────────────────────┐
│ [logo] ROOTS       25  21 │  8    │
│ [logo] AUSTIN JRS  18  25 │  6    │
│                     S1  S2    S3   │
└────────────────────────────────────┘
```

Completed sets should be visually smaller/more muted. The current set
should be emphasized.

At the beginning of Set 3, show:

``` text
ROOTS       25  21 | 0
AUSTIN      18  25 | 0
             S1  S2  S3
```

Therefore even a standalone Set 3 video contains the match context.

------------------------------------------------------------------------

## 19. Score Bug Rendering Strategy

Avoid using FFmpeg's primitive text drawing as the main design system.

Preferred architecture:

1.  Domain logic calculates score states and their video intervals.
2.  A rendering component creates polished transparent score bug assets.
3.  FFmpeg composites those assets during the correct intervals.

Possible generated assets:

``` text
score-000.png
score-001.png
score-002.png
...
```

Each asset can contain logos, typography, colors, completed sets,
current score, transparency, and visual styling.

This separates score-bug design from video encoding.

------------------------------------------------------------------------

## 20. Future Renderer UI

After the CLI is reliable, create a simple Mac-friendly UI:

``` text
CREATE SCORED VIDEO

Video
[ Set-2.mov ]

Match
Roots 15 Green vs Austin Juniors

Set
[ 2 ]

Synchronization
SYNC 2 detected at 00:00:13.500

[ Preview Sync ]

Score Bug Position
[ Top Left ▼ ]

[ SCORE BUG PREVIEW ]

[ CREATE VIDEO ]
```

Eventually support dropping all set videos and selecting
`RENDER ALL SETS`.

------------------------------------------------------------------------

## 21. UX Requirements

Courtside UI must:

-   Work one-handed
-   Use very large scoring touch targets
-   Avoid modal dialogs during normal scoring
-   Keep team names visible
-   Keep current set visible
-   Keep Undo accessible
-   Prevent layout shifts as scores gain digits
-   Have strong outdoor readability
-   Support high contrast
-   Work well in portrait orientation
-   Remain fully usable without internet

Destructive actions such as deleting teams, matches, or tournaments
require confirmation.

------------------------------------------------------------------------

## 22. Testing Requirements

### Domain

Test:

-   Home point
-   Away point
-   Multiple points
-   Undo home/away
-   Multiple undos
-   Point after undo
-   Multiple sets
-   Correct completed-set results

### Persistence

Test:

-   Reload during active set
-   Close/reopen PWA
-   Correct score/set restored
-   Historical matches retained

### Offline/live synchronization

Test:

-   Score while offline
-   Undo while offline
-   End set while offline
-   Reconnect
-   Firebase converges to correct state

### Export

Test:

-   Millisecond timestamps preserved
-   CSV escaping
-   Undo retained
-   Sync markers retained
-   Team appearance/logo metadata represented

### Video timing

Test:

-   Sync offset calculation
-   Event-to-video time mapping
-   Set 2 includes Set 1 final score
-   Set 3 includes Sets 1 and 2
-   Undo produces correct score-bug timeline

------------------------------------------------------------------------

## 23. Implementation Phases

### Phase 1 - Core Domain

Implement TypeScript models, IndexedDB schema, event processing, score
reconstruction, and unit tests.

### Phase 2 - Courtside Scorekeeper

Implement reusable teams, logos/colors, tournaments, new matches,
match-specific colors, scoring, undo, sets, match completion, and reload
recovery.

This should be the first genuinely usable tournament version.

### Phase 3 - PWA Reliability

Implement service worker, offline app shell, installability, wake lock,
resume handling, and reliability testing.

### Phase 4 - Video Sync and Export

Implement SYNC button, machine-visible flash sequence, numbered sync
markers, event history, CSV export, and tournament JSON.

### Phase 5 - Firebase Live Scores

Implement Firebase, local sync queue, reconnect handling, public match
page, realtime updates, and share URL.

Never compromise local scoring reliability.

### Phase 6 - Permanent Team Live Page

Add current live match, earlier results, and upcoming entered matches
under one bookmarkable team URL.

### Phase 7 - Video Renderer CLI

Read tournament JSON, accept one set video, support manual sync,
calculate timeline, generate score bug assets, use FFmpeg, output MP4.

### Phase 8 - Renderer Automation

Add automatic SYNC detection, preview/correction, multiple set videos,
and Render All.

### Phase 9 - Renderer UI

Add a simple Mac-friendly interface around the renderer.

------------------------------------------------------------------------

## 24. First Usable Version - Definition of Done

The courtside MVP is complete when:

1.  User creates Roots 15 Green as a reusable team.
2.  User uploads its logo and selects default colors.
3.  User creates a tournament.
4.  User creates/selects an opponent.
5.  User selects match-specific colors.
6.  User starts a match and Set 1.
7.  Scoring buttons clearly reflect each team identity/color.
8.  User starts the camera and presses SYNC.
9.  The phone records the sync event and produces the visual
    flash/screen.
10. User scores the set.
11. User makes an error and successfully uses Undo.
12. Phone locks or app closes.
13. User reopens and resumes with correct state.
14. User completes Set 1 and repeats for Set 2.
15. Previous set scores remain available.
16. Match history can be reviewed.
17. Complete timestamped event history can be exported.
18. All of the above works offline.

Firebase and video rendering are subsequent milestones and must not
block this MVP.

------------------------------------------------------------------------

## 25. Codex Implementation Guidance

-   Favor simple, explicit code over unnecessary abstraction.
-   Keep domain/event logic separate from React components.
-   Keep Firebase code separate from core scoring logic.
-   Keep video rendering outside the PWA.
-   Persist first, synchronize second.
-   Treat IndexedDB/events as authoritative.
-   Never require network access for scoring.
-   Preserve timestamps at millisecond precision.
-   Make reconstruction deterministic and heavily tested.
-   Do not add authentication to the courtside MVP.
-   Do not expand into player stats, rotations, lineups, or volleyball
    rule enforcement yet.
-   Keep each implementation phase runnable.
-   Prove persistence/recovery before spending substantial effort on
    polish.

------------------------------------------------------------------------

## 26. Future Ideas - Out of Initial Scope

Possible later additions:

-   Season organization
-   Schedules
-   Player rosters/stats
-   Serve tracking
-   Rotations/lineups
-   Highlight markers
-   Automatic highlight clips
-   Cloud backup
-   Multi-device scoring
-   Apple Watch scoring
-   Live video streaming
-   QR codes for live scoreboard
-   Score bug themes
-   Automatic opponent/logo lookup
-   Automatic video association
-   Direct Final Cut workflows
-   Social-video generation

Do not implement these until the core workflow is stable.

------------------------------------------------------------------------

## 27. Product Summary

The central product principle is:

> **One courtside tap creates the authoritative score event used
> everywhere else.**

When the operator taps `ROOTS +1`, that action:

1.  Immediately updates and persists the local match.
2.  Optionally synchronizes the public live scoreboard.
3.  Creates the timestamped event later used by the video renderer.

The operator should never separately maintain a live score or manually
reconstruct the scoring timeline during video editing.
