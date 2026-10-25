# RallySync

**Less organizing. More badminton.** A responsive, installable courtside companion for your regular crew, hosted as a static app with no required backend or player accounts.

Interface previews: [desktop clubhouse](docs/screenshots/desktop.png) · [mobile scoring](docs/screenshots/mobile-scoring.png) · [interactive rules](docs/screenshots/rules.png).

## What works

- Create singles or doubles sessions, with up to six courts in the interface.
- Add guests by name, estimate starting skill, and track late arrivals and breaks.
- Suggest lineups using available court opportunity, elapsed playing time, waiting time, provisional strength, and partner variety. Manually adjust teams anytime before starting.
- Score rally by rally, undo, or enter final game scores. Supports 11/15-point house games, 21-point games, win-by-two, caps, and one-game or best-of-three matches.
- Preserve completed, stopped, and active matches. Correct accepted results with an auditable scoring log; rankings recalculate.
- View overall, today, or session standings and match history. Points are credited to sides, not attributed to individual winners/errors.
- Learn service positioning through an interactive court, searchable rules, and official/house-rule distinctions.
- Use offline after initial caching. Export complete JSON backups, restore with validation, and export spreadsheet-safe CSV results.
- Optionally connect Google Sheets through the included Apps Script: one organizer writer, polling viewers, revision checks, and explicit conflict resolution.

This first release does **not** implement tournament brackets, timed-match endings, handicap points, shot attribution, user authentication, or automatic merging of independently edited histories. The rules guide describes some formats beyond the implemented scoring controls. Do not mistake house presets or provisional ratings for official competition certification.

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
