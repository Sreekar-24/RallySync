import { getAnalytics, type AnalyticsFilters } from '../domain/analytics'
import { scoreMatch } from '../domain/engine'
import type { AppData, Match, Session } from '../domain/model'
import { matchElapsedMinutes, matchPlayMinutes } from '../domain/timing'

export interface ReportOptions {
  sessionId?: string
  scopeLabel?: string
  filters?: AnalyticsFilters
  generatedAt?: number
  rankBy?: 'wins' | 'rate' | 'rating' | 'performance' | 'credit'
}

export interface ReportMatch {
  id: string
  sessionId: string
  sessionName: string
  format: Session['format']
  court: number
  teamA: string[]
  teamB: string[]
  namesA: string[]
  namesB: string[]
  status: Match['status']
  startedAt: number
  endedAt: number | null
  elapsedMinutes: number
  playMinutes: number
  timingBasis: 'recorded-pauses' | 'legacy-elapsed'
  games: { a: number; b: number; winner: 'A' | 'B' }[]
  currentGame: { a: number; b: number } | null
  winner: 'A' | 'B' | null
  creditedPoints: Record<string, number>
  unassignedPoints: { a: number; b: number }
  attributionCoverage: number
  observedRallyOrder: boolean
}

export interface RallyReport {
  schemaVersion: 1
  reportType: 'session' | 'leaderboard'
  application: 'RallySync'
  generatedAt: string
  scope: AnalyticsFilters & { label: string; timeBoundary: 'from-inclusive-to-exclusive' }
  ranking: { by: NonNullable<ReportOptions['rankBy']>; description: string }
  definitions: Record<string, string>
  summary: ReturnType<typeof getAnalytics>['summary']
  players: { id: string; name: string; startingLevel: number }[]
  sessions: {
    id: string
    name: string
    format: Session['format']
    startedAt: number
    endedAt: number | null
    status: Session['status']
    scoringRules: { target: number; winBy: number; cap: number; bestOf: number }
  }[]
  matches: ReportMatch[]
  standings: ReturnType<typeof getAnalytics>['players']
  partnerships: ReturnType<typeof getAnalytics>['partnerships']
  opponents: ReturnType<typeof getAnalytics>['opponents']
  participation: ReturnType<typeof getAnalytics>['participation']
}

/** Creates an analysis report, deliberately distinct from a restorable full backup. */
export function buildReport(data: AppData, options: ReportOptions = {}): RallyReport {
  const filters: AnalyticsFilters = {
    ...options.filters,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
  }
  const now = options.generatedAt ?? Date.now()
  const analytics = getAnalytics(data, filters, now)
  const sessionMap = new Map(data.sessions.map((session) => [session.id, session]))
  const names = new Map(data.players.map((player) => [player.id, player.name]))
  const sessionIds = new Set(analytics.matches.map((match) => match.sessionId))
  if (filters.sessionId && sessionMap.has(filters.sessionId)) sessionIds.add(filters.sessionId)
  const sessions = data.sessions.filter((session) => sessionIds.has(session.id))
  const playerIds = new Set(analytics.matches.flatMap((match) => [...match.teamA, ...match.teamB]))
  for (const row of analytics.participation) playerIds.add(row.playerId)
  if (filters.sessionId && !filters.playerIds?.length)
    for (const id of sessionMap.get(filters.sessionId)?.playerIds ?? []) playerIds.add(id)
  const matches: ReportMatch[] = analytics.matches.map((match) => {
    const session = sessionMap.get(match.sessionId)!
    const score = scoreMatch(match, session)
    const completedGames = score.games
    const pointsA =
      completedGames.reduce((sum, game) => sum + game.a, 0) + (score.complete ? 0 : score.a)
    const pointsB =
      completedGames.reduce((sum, game) => sum + game.b, 0) + (score.complete ? 0 : score.b)
    const credits = score.allCredits ?? {}
    const creditedA = match.teamA.reduce((sum, id) => sum + (credits[id] ?? 0), 0)
    const creditedB = match.teamB.reduce((sum, id) => sum + (credits[id] ?? 0), 0)
    const total = pointsA + pointsB
    return {
      id: match.id,
      sessionId: match.sessionId,
      sessionName: session.name,
      format: session.format,
      court: match.court,
      teamA: [...match.teamA],
      teamB: [...match.teamB],
      namesA: match.teamA.map((id) => names.get(id) ?? 'Unknown player'),
      namesB: match.teamB.map((id) => names.get(id) ?? 'Unknown player'),
      status: match.status,
      startedAt: match.startedAt,
      endedAt: match.endedAt ?? null,
      elapsedMinutes: Math.round(matchElapsedMinutes(match, now) * 10) / 10,
      playMinutes: Math.round(matchPlayMinutes(match, now) * 10) / 10,
      timingBasis: match.timing ? 'recorded-pauses' : 'legacy-elapsed',
      games: completedGames.map((game) => ({ ...game })),
      currentGame: score.complete ? null : { a: score.a, b: score.b },
      winner: match.status === 'completed' && score.complete ? (score.winner ?? null) : null,
      creditedPoints: { ...credits },
      unassignedPoints: {
        a: Math.max(0, pointsA - creditedA),
        b: Math.max(0, pointsB - creditedB),
      },
      attributionCoverage: total ? Math.min(1, (creditedA + creditedB) / total) : 0,
      // Older final-score entries generated point sequences without a source
      // marker. Only explicitly observed points establish rally provenance.
      observedRallyOrder:
        match.actions.some((action) => action.kind === 'point') &&
        !match.actions.some((action) => action.kind === 'adjust') &&
        match.actions
          .filter((action) => action.kind === 'point')
          .every((action) => action.synthetic === false),
    }
  })
  const selectedSession = filters.sessionId ? sessionMap.get(filters.sessionId) : undefined
  const rankBy = options.rankBy ?? 'wins'
  const standings = analytics.players.slice().sort((a, b) => {
    const primary =
      rankBy === 'rate'
        ? b.winRate - a.winRate
        : rankBy === 'rating'
          ? b.rating - a.rating
          : rankBy === 'performance'
            ? b.performanceIndex - a.performanceIndex
            : rankBy === 'credit'
              ? (b.creditedPoints ?? -1) - (a.creditedPoints ?? -1)
              : b.wins - a.wins
    const secondary =
      rankBy === 'wins'
        ? b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst) || b.winRate - a.winRate
        : rankBy === 'rate'
          ? b.wins - a.wins
          : rankBy === 'credit'
            ? b.attributionCoverage - a.attributionCoverage
            : b.played - a.played
    return primary || secondary || a.name.localeCompare(b.name)
  })
  const rankingDescriptions = {
    wins: 'Most wins, then point difference, win percentage, and alphabetical name.',
    rate: 'Win percentage, then wins and alphabetical name.',
    rating: 'Provisional strength rating, then matches played and alphabetical name.',
    performance: 'Weighted performance index, then matches played and alphabetical name.',
    credit:
      'Recorded credited points (unknown last), then attribution coverage and alphabetical name.',
  }
  return {
    schemaVersion: 1,
    // A session selected inside Rankings still exports player standings.
    // Only the explicit session-results option selects match-row CSV output.
    reportType: options.sessionId ? 'session' : 'leaderboard',
    application: 'RallySync',
    generatedAt: new Date(now).toISOString(),
    scope: {
      ...filters,
      label: options.scopeLabel ?? selectedSession?.name ?? 'Player standings',
      timeBoundary: 'from-inclusive-to-exclusive',
    },
    ranking: {
      by: rankBy,
      description: rankingDescriptions[rankBy],
    },
    definitions: {
      ...analytics.definitions,
      report:
        'Scoped analysis export, not an application backup. Use Settings → Download full backup for recovery.',
      points:
        'Points belong to a side. Individual credited points are manually attributed and may be incomplete; unassigned is not zero individual contribution.',
      status:
        'Only accepted completed matches with a verified winner affect competitive statistics. Active and stopped matches remain in session reports.',
      minutes:
        'Elapsed minutes include pauses and result-review time. Play minutes exclude recorded pauses and tracked review time; legacy records retain elapsed duration. Neither measures active rally time. Running durations use report-generation time.',
      rallyOrder:
        'Only explicitly observed point events establish rally order. Final-score entries, score adjustments, and legacy records without provenance do not.',
      scope:
        'Date boundaries are from-inclusive and to-exclusive. Player selection includes matches involving any selected player; standings show selected players only.',
    },
    summary: { ...analytics.summary },
    players: data.players
      .filter((player) => playerIds.has(player.id))
      .map((player) => ({ id: player.id, name: player.name, startingLevel: player.level })),
    sessions: sessions.map((session) => ({
      id: session.id,
      name: session.name,
      format: session.format,
      startedAt: session.startedAt,
      endedAt: session.endedAt ?? null,
      status: session.status,
      scoringRules: {
        target: session.target,
        winBy: session.winBy,
        cap: session.cap,
        bestOf: session.bestOf,
      },
    })),
    matches,
    standings,
    partnerships: analytics.partnerships,
    opponents: analytics.opponents,
    participation: analytics.participation,
  }
}

export function reportToJSON(report: RallyReport): string {
  return JSON.stringify(report, null, 2)
}

/** Formula injection prevention is separate from ordinary CSV quote escaping. */
export function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value)
  const safe = typeof value === 'string' && /^\s*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

export function reportToCSV(report: RallyReport): string {
  const rows: (string | number | null)[][] =
    report.reportType === 'session'
      ? [
          [
            'Session',
            'Format',
            'Court',
            'Side A',
            'Side B',
            'Game scores A–B',
            'Current game A–B',
            'Status',
            'Winning side',
            'Elapsed minutes',
            'Play minutes',
            'Timing basis',
            'Attribution coverage',
            'Scope',
          ],
          ...report.matches.map((match) => [
            match.sessionName,
            match.format,
            match.court,
            match.namesA.join(' & '),
            match.namesB.join(' & '),
            match.games.map((game) => `${game.a}–${game.b}`).join('; '),
            match.currentGame ? `${match.currentGame.a}–${match.currentGame.b}` : '',
            match.status,
            match.winner ?? '',
            match.elapsedMinutes,
            match.playMinutes,
            match.timingBasis,
            match.attributionCoverage,
            scopeDescription(report),
          ]),
        ]
      : [
          [
            'Player',
            'Player ID',
            'Played',
            'Wins',
            'Losses',
            'Win rate',
            'Points for',
            'Points against',
            'Court minutes',
            'Provisional rating',
            'Performance index',
            'Credited points',
            'Attribution coverage',
            'Scope',
          ],
          ...report.standings.map((player) => [
            player.name,
            player.playerId,
            player.played,
            player.wins,
            player.losses,
            player.winRate,
            player.pointsFor,
            player.pointsAgainst,
            player.minutes,
            player.rating,
            player.performanceIndex,
            player.creditedPoints,
            player.attributionCoverage,
            `${scopeDescription(report)} · ${report.ranking.description}`,
          ]),
        ]
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

function scopeDescription(report: RallyReport): string {
  const parts = [report.scope.label]
  if (report.scope.format && report.scope.format !== 'all') parts.push(report.scope.format)
  if (report.scope.from !== undefined)
    parts.push(`from ${new Date(report.scope.from).toISOString()} (inclusive)`)
  if (report.scope.to !== undefined)
    parts.push(`until ${new Date(report.scope.to).toISOString()} (exclusive)`)
  if (report.scope.playerIds?.length)
    parts.push(
      `Selected players: ${report.scope.playerIds.map((id) => report.players.find((player) => player.id === id)?.name ?? id).join(', ')}`,
    )
  return parts.join(' · ')
}

export function escapeHTML(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  )
}

function table(headers: string[], rows: (string | number | null)[][]): string {
  return `<table><thead><tr>${headers.map((header) => `<th scope="col">${escapeHTML(header)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHTML(cell === null ? '—' : cell)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}">No matching records.</td></tr>`}</tbody></table>`
}

/** Every data-derived string is escaped; no script or untrusted markup is embedded. */
export function reportToHTML(report: RallyReport): string {
  const percent = (value: number) => `${Math.round(value * 100)}%`
  const rules = report.sessions
    .map(
      (session) =>
        `${session.name}: ${session.format}, first to ${session.scoringRules.target}, win by ${session.scoringRules.winBy}, cap ${session.scoringRules.cap}, best of ${session.scoringRules.bestOf}`,
    )
    .join(' · ')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(report.scope.label)} — RallySync report</title><style>
    *{box-sizing:border-box}body{margin:0;padding:36px;font:12px/1.65 system-ui,sans-serif;color:#20352f;background:#fff}main{max-width:1080px;margin:auto}h1{font-size:30px;letter-spacing:-1px;line-height:1.2;margin:8px 0}h2{font-size:16px;margin:28px 0 10px}p{margin:8px 0}.brand{font-weight:800;letter-spacing:.08em;color:#466331}.meta,.note{color:#526355;font-size:11px}.summary{display:flex;gap:24px;flex-wrap:wrap;padding:18px 0;border-top:1px solid #dce5d7;border-bottom:1px solid #dce5d7;margin:24px 0}.summary strong{font-size:20px;display:block}table{width:100%;border-collapse:collapse;margin:10px 0;table-layout:auto}th,td{padding:9px 7px;text-align:left;border-bottom:1px solid #e2e8de;overflow-wrap:anywhere}th{background:#eef4e5;font-size:10px}tr{break-inside:avoid}td{font-size:10px}dl{font-size:10px}dt{font-weight:700;margin-top:8px}dd{margin-left:0;color:#526355}.print-help{background:#f1f6e8;border:1px solid #dce6cf;padding:12px;border-radius:8px}footer{margin-top:30px;border-top:1px solid #dce5d7;padding-top:12px;font-size:10px;color:#526355}@page{size:auto;margin:14mm}@media print{body{padding:0}.print-help{display:none}thead{display:table-header-group}h2{break-after:avoid}a{color:inherit;text-decoration:none}}
    </style></head><body><main><p class="brand">RALLYSYNC · COURTSIDE REPORT</p><h1>${escapeHTML(report.scope.label)}</h1><p class="meta">Generated ${escapeHTML(new Date(report.generatedAt).toLocaleString())}</p><p class="meta">${escapeHTML(scopeDescription(report))}</p><p class="print-help">In your print dialog, choose <strong>Save as PDF</strong>. If it does not open automatically, use your browser’s Print command.</p>${rules ? `<p class="note">${escapeHTML(rules)}</p>` : ''}
    <div class="summary"><div><strong>${report.summary.completedMatches}</strong>completed matches</div><div><strong>${report.standings.length}</strong>ranked players</div><div><strong>${report.summary.activeMatches}</strong>active matches</div><div><strong>${report.summary.stoppedMatches}</strong>stopped matches</div><div><strong>${percent(report.summary.attributionCoverage)}</strong>point attribution</div></div>
    <h2>Player standings</h2><p class="note">Completed verified results only. Provisional ratings are estimates, not official rankings. ${escapeHTML(report.ranking.description)}</p>${table(
      [
        'Player',
        'Played',
        'W',
        'L',
        'Win %',
        'Point share',
        'Rating',
        'Index',
        'Credit / coverage',
      ],
      report.standings.map((player) => [
        player.name,
        player.played,
        player.wins,
        player.losses,
        percent(player.winRate),
        percent(player.pointShare),
        player.rating,
        player.performanceIndex,
        player.creditedPoints === null
          ? 'Unassigned'
          : `${player.creditedPoints} / ${percent(player.attributionCoverage)}`,
      ]),
    )}
    <h2>Match results</h2>${table(
      ['Session / court', 'Side A', 'Side B', 'Scores A–B', 'Status', 'Winner', 'Play min'],
      report.matches.map((match) => [
        `${match.sessionName} / ${match.court}`,
        match.namesA.join(' & '),
        match.namesB.join(' & '),
        [
          ...match.games.map((game) => `${game.a}–${game.b}`),
          ...(match.currentGame ? [`${match.currentGame.a}–${match.currentGame.b} (current)`] : []),
        ].join(' / '),
        match.status,
        match.winner ?? '—',
        match.playMinutes,
      ]),
    )}
    <h2>Partnerships</h2><p class="note">Adjusted performance compares wins with expected wins and shrinks small samples toward neutral.</p>${table(
      ['Partnership', 'Together', 'W', 'L', 'Win %', 'Adjusted performance'],
      report.partnerships.map((pair) => [
        pair.names.join(' & '),
        pair.played,
        pair.wins,
        pair.losses,
        percent(pair.winRate),
        `${pair.adjustedPerformance > 0 ? '+' : ''}${Math.round(pair.adjustedPerformance * 100)} pp`,
      ]),
    )}
    <h2>Opposing-side records</h2><p class="note">Doubles records describe players on opposing sides, not isolated individual contests.</p>${table(
      ['Player A', 'Player B', 'Opposed', 'A wins', 'B wins', 'Side points A–B'],
      report.opponents.map((pair) => [
        pair.names[0],
        pair.names[1],
        pair.played,
        pair.winsA,
        pair.winsB,
        `${pair.pointsA}–${pair.pointsB}`,
      ]),
    )}
    <h2>Participation</h2>${table(
      [
        'Player',
        'Played',
        'Court min',
        'Available min',
        'Waiting min',
        'Longest wait',
        'Max play / rest streak',
      ],
      report.participation.map((player) => [
        player.name,
        player.played,
        Math.round(player.minutes),
        Math.round(player.availableMinutes),
        Math.round(player.waitingMinutes),
        Math.round(player.longestWaitMinutes),
        `${player.maxConsecutivePlays} / ${player.maxConsecutiveRests}`,
      ]),
    )}
    <h2>How to read this report</h2><dl>${Object.entries(report.definitions)
      .map(([key, definition]) => `<dt>${escapeHTML(key)}</dt><dd>${escapeHTML(definition)}</dd>`)
      .join(
        '',
      )}</dl><footer>RallySync · Play fair. Play together. · Analysis report, not a recovery backup.</footer></main></body></html>`
}

export function printReport(report: RallyReport): boolean {
  const popup = window.open('', '_blank', 'width=1100,height=800')
  if (!popup) return false
  popup.opener = null
  popup.document.open()
  popup.document.write(reportToHTML(report))
  popup.document.close()
  popup.focus()
  // Layout is complete before the print dialog captures the report.
  popup.setTimeout(() => {
    popup.print()
  }, 250)
  return true
}

export function reportFileName(report: RallyReport, extension: 'json' | 'csv'): string {
  const label =
    report.scope.label
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || report.reportType
  return `rallysync-${label.toLowerCase()}-${report.generatedAt.slice(0, 10)}.${extension}`
}
