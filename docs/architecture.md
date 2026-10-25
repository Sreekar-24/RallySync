# Architecture and scope

## Local-first data flow

The UI updates a typed AppData snapshot through one store. Every accepted UI change is queued into IndexedDB in order. A synchronous localStorage write-ahead journal protects the latest pending action from an immediate reload; committed journal entries are cleared without removing newer pending changes. A storage failure is visible and prompts a backup; it is not reported as a successful save. Browser Web Locks guard same-origin editing when supported.

Players have stable IDs independent of display names. Sessions record rules and attendance changes. Matches record sides, court, timestamps, revisions, and immutable point/undo actions. `scoreMatch` replays accepted operations; duplicate operation IDs are ignored. Explicit match finalization makes a result eligible for statistics.

Final-result entry synthesizes a valid rally sequence for the submitted game scores. Those synthetic events are **not evidence of actual rally order**, momentum, service statistics, or individual contribution. The UI does not report such analytics. Corrections retain earlier events and append undo/replacement operations.

## Scheduling

Hard constraints exclude unavailable players, occupied courts, duplicate participants, and players already in an active match. Available court opportunity integrates attendance intervals and court capacity. The scheduler compares elapsed court time to that opportunity, then waiting, and chooses a pairing based on the selected mode.

This is an explainable heuristic, not a globally optimal future schedule. All modes prioritize participation first. Balanced mode then reduces the provisional team-rating gap; variety mode emphasizes different partners. Historical partnerships inform variety, while accepted past results inform strength. There is no unbounded participation debt from missed sessions.

Elapsed match duration includes pauses; it is not active rally time. Stopped matches still consume participation time but do not affect competitive standings. Data without attendance events falls back to availability from session start. Player breaks and late arrivals recorded in the current UI use exact event timestamps.

Ratings use local, level-seeded Elo (600–1400 seed, K=24) with average side strength. Every participant receives a team-result update; this is not player-attributed scoring. A scoped rating calculation restarts from starting levels. Rankings state their ordering and sample sizes; small samples are not reliable measures of ability.

## Optional synchronization

Google Sheets synchronization is opt-in and uses full snapshots with optimistic revisions. Each mutation has a unique ID for acknowledgement retry. The script writes checksummed chunks before publishing their manifest and retains the prior snapshot. It never performs a partial automatic merge.

The organizer is the authoritative writer. Viewers replace their local shared view from accepted snapshots. Conflicting local/shared edits pause automatic progress and require a backed-up, explicit resolution. This design does not claim reliable concurrent offline scoring by several organizers.

Apps Script mocks verify storage integrity and conflict behavior. A real deployment is still required to validate Google permissions, quotas, redirects, and browser cross-origin access. The optional anonymous endpoint has no genuine role enforcement.

## Validation

Unit tests cover scoring, deuce/cap, best-of-three, undo, result corrections, attendance fairness, scheduling exclusions, and scoped accepted-result statistics. Storage tests exercise reference checks and IndexedDB. Apps Script contract tests use mocked platform services. Production-browser tests cover sessions, collections, rules, persistence, offline reload, backups, synchronization scenarios, and responsive layouts.

Automated accessibility checks complement keyboard labels and manual visual inspection. Browser automation uses Chromium; real iOS/Android installation and screen-reader behavior still warrant device checks.

## Next increments

1. Validate the owner-deployed Sheets bridge end to end.
2. Add timed-match policies and richer participation reporting.
3. Add explicit tournament entities, standings rules, brackets, and withdrawals.
4. Add authenticated shared-group access before broader public use.
5. Add further formats or player-attributed metrics only with the data needed to support them.

Core scoring and scheduling remain independent of the persistence adapter so a managed database can replace Sheets later.
