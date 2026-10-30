# RallySync

**Less organizing. More badminton.** A responsive, installable courtside companion for your regular crew, hosted as a static app with no required backend or player accounts.

Interface previews: [desktop clubhouse](docs/screenshots/desktop.png) · [mobile scoring](docs/screenshots/mobile-scoring.png) · [focused scoring](docs/screenshots/focused-scoring.png) · [dark scoring](docs/screenshots/dark-scoring.png) · [interactive rules](docs/screenshots/rules.png) · [full schedule](docs/screenshots/schedule.png) · [partnership insights](docs/screenshots/partnerships.png).

## What works

- Singles and doubles sessions, with up to six courts, player attendance, breaks, arrival and departure windows.
- Full-session schedules based on total match count or estimated hours, match length, and changeovers. Review all rounds, playing/rest time, and planning tradeoffs before playing.
- Weighted fair, balanced, or social-variety recommendations using court opportunity, play/rest sequences, provisional strength, partner/opponent history, and conservative partnership evidence. Contribution weighting is opt-in and requires sufficient attribution coverage.
- Lock future lineups, edit pairings, swap an equivalent future matchup where practical, and repair remaining assignments. Active/completed matches stay intact.
- A personal “What’s next?” card remembers your selected player on this device and shows current court, next partners/opponents, and estimated wait. Live-game finish times remain estimates.
- Concrete matchup explanations and before/after participation previews make manual schedule changes easier to judge.
- Team, individual, or combined doubles scoring: a credited player point adds exactly one to their side. Unassigned points remain explicit.
- Editable totals and per-game/player allocation, atomic undo, deuce/caps, 11/15-point house games, 21-point games, and one-game/best-of-three matches. A winning score is provisional until **Confirm result**.
- Touch-friendly plus/minus counters beside directly editable score boxes, including individual credited-point removal. Known rallies replay exactly; typed corrections remain auditable and undoable.
- Protected score/position drafts, an optional focused scoreboard, recent scoring actions, and optional screen-awake support while scoring. Point-entry preferences stay local to each match; changing the session default is explicit.
- Pause/resume timing for matches, with play duration separate from elapsed occupancy and result confirmation. Older records retain their original elapsed timing.
- A compact next-serve court: tap the first server, swap partners to match actual service positions, and flip the view. Server, diagonal receiver, and right/left courts follow rallies automatically. Position checks after manual corrections avoid guessing doubles rotation.
- Correct accepted results from History or the schedule without double-counting a match. Delete one session without clearing unrelated sessions or player identities.
- All-time, today, custom-date, session, format, and selected-player rankings. Compare partnerships, opposing sides, contribution coverage, and participation. Weighted performance and provisional strength are explained separately from wins.
- End-of-session recaps combine results, participation and partnership sample sizes with exports/backups. “Play again” copies players and settings into a fresh attendance check without copying scores, breaks or teams.
- Scoped JSON/CSV analysis exports and print-ready PDF reports. Complete JSON backups remain a separate recovery format.
- Optional external LLM planning: export context/prompt, import revision-checked JSON, preview, and apply. No AI API or subscription is needed by the app.
- Searchable rules, named-player service rotations, optional step/play/pause lessons, and interactive service/rally boundaries. Receiving players stay fixed when service changes.
- Device-local Light, Dark, High contrast, and System themes with keyboard-accessible controls and reduced-motion-aware interactions.
- Offline PWA with **in-memory demo isolation**. Exit or reload to return to real data; demo changes never save or upload. Settings includes targeted cleanup for sample data from v0.1.
- Optional Google Sheets snapshot sync with one organizer writer, polling viewers, and explicit conflict resolution.

The planner is a bounded, explainable heuristic rather than a trained ML model or a proof of optimal fairness. Availability and hard constraints take precedence; estimates and subjective credited points do not establish actual rally order or objective individual ability. Tournament brackets, timed-match stopping rules, handicap scoring, authentication, and automatic multi-writer merging remain outside this release.

## Upgrading from v0.1

Existing version-1 histories are migrated to version 2 without inventing individual attribution. Download a backup before updating important histories. If you use Google Sheets, **redeploy the updated Apps Script before syncing v2 data**, then update the other devices. The old script rejects v2 rather than silently discarding new fields. See the [upgrade guide](google-apps-script/README.md).

The improved demo no longer uses real storage. Old persisted sample records are not silently removed; review **Settings → Sample data from the first version? → Review cleanup**. Renamed sample profiles and those referenced by real sessions are preserved.

## Serving and score corrections

In a live scoreboard, tap **Set first serve** or a player’s dot. Choose the server, swap each pair to match the real court, and select **Start tracking**. Right/left means each player’s own view facing the net; the opposite end is mirrored. The highlighted player serves and the dashed player receives. These show service courts, not fixed positions during rallies.

When the serving side wins, only its partners swap courts. When the receiving side wins, nobody swaps; the next server follows that side’s new score parity. Singles uses the serving score to place both players diagonally. Each new game needs a first-server check; the previous game’s winning side serves first, with either partner selectable. Standard 21-point best-of-three automatically changes ends between games and at 11 in game three.

**Minus** removes the latest eligible rally for that side in the displayed game and replays the surviving history. Individual minus removes the selected player’s latest known credited point. If a typed/imported total has no rally order, minus corrects its snapshot and asks you to check positions. When all snapshot points are credited to multiple partners, choose a player’s minus button or edit allocation rather than guessing whose credit to remove. Undo restores either operation in one step. To correct an earlier game after the next game starts, use **Undo last action** or **Edit all scores**.

Typing totals cannot reconstruct doubles positions. **Check positions → Reset positions** saves a new court checkpoint without changing points. When a lower typed total conflicts with credited points, you can edit allocation or explicitly apply that game’s totals as unassigned. You can keep scoring without setting up the court; the app does not claim a server until positions are confirmed.

This serving update adds optional checkpoint and rally-retraction fields to schema v2. Existing local histories still load. **Existing Sheets users must redeploy the latest script and update all devices**, including users already on v0.2; older strict validators reject the new fields rather than discard them.

## Develop

Node 24 is used in development and CI (`.nvmrc`).

```sh
npm ci
npm run dev
```

Vite prints the development address; the default repository base path is `/RallySync/`. Routes use hashes, so direct navigation works on a static host.

```sh
npm run check       # Type-check, production build, unit tests, Apps Script contracts
npm run test:e2e    # Production build + Chromium browser tests
npm run format     # Format source and configuration
```

Before the first browser run, install Playwright Chromium with `npx playwright install chromium`. In a cloud machine with system Chromium, use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e` instead.

If the machine's default npm cache is not writable, pass `--cache /workspace/.npm-cache` to `npm ci`.

## Publish to GitHub Pages

1. Open the repository's **Settings → Pages** and set **Source → GitHub Actions**.
2. The **Check RallySync** workflow validates pushes to `main`.
3. After successful checks, **Deploy GitHub Pages** builds and publishes the tested commit. You can also run that workflow manually from Actions.
4. Confirm the deployed address in the deployment's output. A committed workflow alone does not prove publication succeeded.

The build is configured for this repository's `/RallySync/` path. For another repository or static host, set `VITE_BASE_PATH` to its base path before building (for a root-hosted site, `/`). Keep both trailing and leading slashes.

Never commit player backups, spreadsheet data, access tokens, or service-account keys. The code is public; player records remain on the device unless you explicitly export them or enable sync.

## Google Sheets

See [the complete Apps Script setup and access guide](google-apps-script/README.md). Local play needs no Google configuration.

The supplied bridge uses a **versioned snapshot**, not a distributed database. It stores chunked JSON in application-managed tabs; use CSV exports for ordinary spreadsheet analysis. Do not edit storage tabs manually.

The anonymous execute-as-owner deployment option is a trusted-group prototype: anyone possessing its endpoint can read or write. Viewer mode is not server authorization. Do not publish the endpoint or use it for sensitive information. Deploying a Google-owned script and approving its permissions requires the owner's Google account.

No real Google deployment was available during initial development. Backend behavior is contract-tested with Apps Script mocks, and browser sync is tested against simulated endpoints. Validate cross-origin read/write from the deployed app before relying on shared scoring. Do not use `no-cors` or treat an opaque response as successful synchronization.

## Offline, installation, and recovery

- Open online first and allow the service worker to cache application files. Installed app behavior varies by browser; iOS typically uses Safari → Share → Add to Home Screen.
- IndexedDB stores session state. The app also works in an ordinary browser tab.
- Clearing website data, private browsing, browser eviction, or losing the device can lose local history. Export a JSON backup after important sessions and save it somewhere independent, such as Drive.
- CSV is an analysis export, not a complete recovery format. Restoring JSON replaces a history; it does not merge copies.
- Use one scoring tab and one organizer device. Browsers supporting Web Locks prevent a second tab from editing; reload the second tab after closing the first to take over. Cross-device conflicts require explicit choice.
- Sync runs while the app is open and online, with a 15-second polling interval. Background execution is not assumed.
- App updates are offered explicitly and deferred while a session is active.

## Architecture

- **React + TypeScript + Vite:** responsive client and static build.
- **Dexie / IndexedDB:** local snapshot persistence; Zod validates imported/shared records.
- **Domain modules:** scoring replay, accepted-result statistics, provisional Elo, attendance-aware scheduling.
- **PWA / Workbox:** local assets, fonts, lazy-loaded screens, and offline navigation.
- **Optional Apps Script:** locked, revision-checked Google Sheets snapshot adapter.

See [architecture and scope](docs/architecture.md) for design decisions, algorithm limits, and the next increments.
