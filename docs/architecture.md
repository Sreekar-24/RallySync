# Architecture and scope

## Local-first data flow

The UI updates a typed AppData snapshot through one store. Every accepted UI change is queued into IndexedDB in order. A synchronous localStorage write-ahead journal protects the latest pending action from an immediate reload; committed journal entries are cleared without removing newer pending changes. A storage failure is visible and prompts a backup; it is not reported as a successful save. Browser Web Locks guard same-origin editing when supported.

Players have stable IDs independent of display names. Sessions record rules and attendance changes. Matches record sides, court, timestamps, revisions, and immutable point/undo/adjustment actions. `scoreMatch` replays accepted operations; duplicate operation IDs are ignored. Explicit match finalization makes a result eligible for statistics.

Direct score edits append a validated game-score snapshot with optional player-credit allocation. Undo restores the previous effective operation atomically. Live adjustments remain provisional; explicit confirmation records a competitive result. Historical corrections replace the accepted result without creating another match. Legacy synthetic rally sequences remain readable but do not establish observed rally order. Attribution is preserved only where explicitly recorded; unknown points are unassigned.

Version-1 snapshots migrate into version 2, including removal of a known legacy recommendation-description field accidentally spread into old match objects. New schemas reject unsupported fields instead of silently stripping them. Demo mode has a separate in-memory dataset: neither the IndexedDB queue, local recovery journal, nor Sheets accepts demo writes. Destructive real-data operations have scoped previews and backup controls.

## Scheduling

A session stores planning settings and a revisioned list of court/time slots. Each slot contains teams, round, estimated start, pairing lock, and an optional link to an actual match. Planned fixtures do not create results or rating updates.

Full planning considers match/time budgets, duration/changeovers, attendance windows, available court opportunity, play/rest sequences, provisional strength, partner/opponent repetitions, and shrunk partnership residuals. The browser evaluates bounded candidate groups and three doubles partitions. The three presets have different weights; advanced weights are optional. Individual credited contribution is opt-in, small, and requires per-side coverage and sufficient samples.

Past opportunity integrates attendance changes. Replanning seeds actual sequence history and preserves active/completed/stopped assignments, while only repairing unplayed fixtures. Pairing locks preserve teams, but inaccurate start estimates can move. An infeasible future lock is released with a warning if a player leaves or its time window no longer fits. Exact equality is not guaranteed; warnings identify constrained projections. An explicit manual edit can swap a matching future encounter or regenerate the counterpart if a reciprocal swap conflicts.

Availability and finalized-result/level changes trigger future-plan review. Live rally taps do not reshuffle published fixtures. UI previews use revision guards to prevent stale manual/imported schedules from overriding newer changes.

LLM exchange exports player IDs, history, availability, weights, and existing slots plus a JSON template. Imports must cover every unplayed slot, match the current revision, respect locks and exact slot times, and avoid unknown/duplicate/unavailable players or overlaps. Imports never alter actual match records.

Elapsed duration includes pauses. Ratings use level-seeded Elo (600–1400 seed, K=24) with average side strength. Standings, weighted form, estimated strength, and participation remain separate views; sample-size and attribution coverage are visible. The weighted index is a documented local heuristic, not an official badminton ranking.

## Reports

A shared scope/filter function drives visible statistics and JSON/CSV/PDF exports. Reports include definitions, generated time, selected scope, and confirmed-result eligibility. JSON analysis is distinct from a full restorable backup. CSV neutralizes formula-like cells. PDF uses a safely escaped print-ready window and the browser's Save as PDF, with no remote rendering or paid dependency.

## Optional synchronization

Google Sheets synchronization is opt-in and uses full snapshots with optimistic revisions. Each mutation has a unique ID for acknowledgement retry. The script writes checksummed chunks before publishing their manifest and retains the prior snapshot. It never performs a partial automatic merge.

The organizer is the authoritative writer. Viewers replace their local shared view from accepted snapshots. Conflicting local/shared edits pause automatic progress and require a backed-up, explicit resolution. This design does not claim reliable concurrent offline scoring by several organizers.

Apps Script mocks verify storage integrity and conflict behavior. A real deployment is still required to validate Google permissions, quotas, redirects, and browser cross-origin access. The optional anonymous endpoint has no genuine role enforcement.

## Validation

Unit tests cover scoring, deuce/cap, best-of-three, undo, result corrections, attendance fairness, scheduling exclusions, and scoped accepted-result statistics. Storage tests exercise reference checks and IndexedDB. Apps Script contract tests use mocked platform services. Production-browser tests cover sessions, collections, rules, persistence, offline reload, backups, synchronization scenarios, and responsive layouts.

Automated accessibility checks complement keyboard labels and manual visual inspection. Browser automation uses Chromium; real iOS/Android installation and screen-reader behavior still warrant device checks.

## Next increments

1. Validate the owner-deployed Sheets bridge end to end.
2. Add timed-match stopping policies and calibrated performance-model evaluation.
3. Add explicit tournament entities, standings rules, brackets, and withdrawals.
4. Add authenticated shared-group access before broader public use.
5. Evaluate additional formats and predictions only with sufficient verified data.

Core scoring and scheduling remain independent of the persistence adapter so a managed database can replace Sheets later.
