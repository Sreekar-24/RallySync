import type {
  AppData,
  Match,
  MatchScore,
  MatchSuggestion,
  Player,
  PlayerStats,
  Session,
  Side,
} from './model'

function tally(points: Side[], session: Session): MatchScore {
  const target = Math.max(1, session.target)
  const winBy = Math.max(1, session.winBy)
  const cap = Math.max(target, session.cap)
  const needed = session.bestOf === 3 ? 2 : 1
  const score: MatchScore = { a: 0, b: 0, gamesA: 0, gamesB: 0, games: [], complete: false }

  for (const side of points) {
    if (score.complete) break
    if (side === 'A') score.a += 1
    else score.b += 1

    const high = Math.max(score.a, score.b)
    if (high < cap && (high < target || Math.abs(score.a - score.b) < winBy)) continue
    const winner: Side = score.a > score.b ? 'A' : 'B'
    score.games.push({ a: score.a, b: score.b, winner })
    if (winner === 'A') score.gamesA += 1
    else score.gamesB += 1
    if (score.gamesA === needed || score.gamesB === needed) {
      score.complete = true
      score.winner = winner
    } else {
      score.a = 0
      score.b = 0
    }
  }
  return score
}

function replayScoreActions(match: Match, session: Session): { score: MatchScore; points: Side[] } {
  const points: Side[] = []
  const seen = new Set<string>()
  let score = tally(points, session)
  for (const action of match.actions) {
    // A retried command must not add another point (or apply undo twice).
    if (seen.has(action.id)) continue
    seen.add(action.id)
    if (action.kind === 'undo') {
      points.pop()
    } else if ((action.side === 'A' || action.side === 'B') && !score.complete) {
      points.push(action.side)
    } else {
      continue
    }
    score = tally(points, session)
  }
  return { score, points }
}

/** Replays the immutable action log, including undo across game boundaries. */
export function scoreMatch(match: Match, session: Session): MatchScore {
  return replayScoreActions(match, session).score
}

/**
 * Builds a final-score entry or correction without deleting the prior audit
 * log. The generated sequence represents the score, not an observed rally
 * sequence; it must not be used for momentum or individual-event analytics.
 */
export function buildFinalResult(
  match: Match,
  session: Session,
  games: { a: number; b: number }[],
  now = Date.now(),
): Match {
  if (!games.length) throw new Error('Enter at least one complete game.')
  if (games.length > session.bestOf)
    throw new Error('Remove games entered after the match was already won.')
  const needed = session.bestOf === 3 ? 2 : 1
  let aWins = 0
  let bWins = 0
  const newPoints: Side[] = []
  for (const game of games) {
    if (aWins >= needed || bWins >= needed)
      throw new Error('Remove games entered after the match was already won.')
    const { a, b } = game
    if (
      !Number.isInteger(a) ||
      !Number.isInteger(b) ||
      a < 0 ||
      b < 0 ||
      a === b ||
      Math.max(a, b) > session.cap
    ) {
      throw new Error(
        `Check game scores: reach ${session.target}, win by ${session.winBy}, cap ${session.cap}.`,
      )
    }
    const winner: Side = a > b ? 'A' : 'B'
    const loser: Side = winner === 'A' ? 'B' : 'A'
    const low = Math.min(a, b)
    const high = Math.max(a, b)
    const gamePoints: Side[] = []
    for (let i = 0; i < low; i++) gamePoints.push(winner, loser)
    for (let i = low; i < high; i++) gamePoints.push(winner)
    const verified = tally(gamePoints, { ...session, bestOf: 1 })
    // Merely reaching the cap is insufficient: 30–0 would have ended at 21–0.
    if (!verified.complete || verified.a !== a || verified.b !== b) {
      throw new Error(
        `Check game scores: reach ${session.target}, win by ${session.winBy}, cap ${session.cap}.`,
      )
    }
    newPoints.push(...gamePoints)
    if (winner === 'A') aWins += 1
    else bWins += 1
  }
  if (aWins < needed && bWins < needed) throw new Error('Enter enough games to decide the match.')
  const effectivePoints = replayScoreActions(match, session).points.length
  const actions = [...match.actions]
  for (let i = 0; i < effectivePoints; i++)
    actions.push({ id: crypto.randomUUID(), kind: 'undo', at: now })
  for (const side of newPoints)
    actions.push({ id: crypto.randomUUID(), kind: 'point', side, at: now })
  const changed: Match = {
    ...match,
    actions,
    revision: match.revision + 1,
    status: 'completed',
    endedAt: match.endedAt ?? now,
  }
  const verified = scoreMatch(changed, session)
  if (
    !verified.complete ||
    verified.games.length !== games.length ||
    verified.games.some((game, index) => game.a !== games[index].a || game.b !== games[index].b)
  ) {
    throw new Error('The result could not be verified. Please check the game scores.')
  }
  return changed
}

function baseRating(player: Player): number {
  return 600 + (Math.max(1, Math.min(5, player.level)) - 1) * 200
}

function matchEnd(match: Match): number {
  return match.endedAt ?? match.actions.at(-1)?.at ?? match.startedAt
}

function duration(match: Match): number {
  return Math.max(0, matchEnd(match) - match.startedAt) / 60_000
}

function includesPlayer(match: Match, playerId: string): boolean {
  return match.teamA.includes(playerId) || match.teamB.includes(playerId)
}

function sessionEnd(session: Session, now: number): number {
  return Math.max(session.startedAt, Math.min(now, session.endedAt ?? now))
}

/** Eligibility includes court time; it is not a claim of continuous waiting. */
export function attendanceSummary(
  session: Session,
  playerId: string,
  now = Date.now(),
): {
  availableMs: number
  waitingSince: number
} {
  const end = sessionEnd(session, now)
  if (!session.playerIds.includes(playerId)) return { availableMs: 0, waitingSince: end }
  const personalEvents = (session.attendance ?? []).filter(
    (event) => event.playerId === playerId && Number.isFinite(event.at),
  )
  const events = personalEvents
    .filter((event) => event.at <= end)
    .slice()
    .sort((a, b) => a.at - b.at)
  if (!personalEvents.length) {
    return {
      availableMs: end - session.startedAt,
      waitingSince: session.availablePlayerIds.includes(playerId) ? session.startedAt : end,
    }
  }
  let available = false
  let segmentStart = session.startedAt
  let availableMs = 0
  let waitingSince = end
  for (const event of events) {
    const at = Math.max(session.startedAt, event.at)
    if (available) availableMs += at - segmentStart
    if (!available && event.available) waitingSince = at
    available = event.available
    segmentStart = at
  }
  if (available) availableMs += end - segmentStart
  return {
    availableMs,
    waitingSince: available && session.availablePlayerIds.includes(playerId) ? waitingSince : end,
  }
}

/** Integrates expected fair-share court minutes only while each player is available. */
function courtOpportunity(session: Session, now: number): Map<string, number> {
  const end = sessionEnd(session, now)
  const members = new Set(session.playerIds)
  const allEvents = (session.attendance ?? []).filter(
    (event) => members.has(event.playerId) && Number.isFinite(event.at),
  )
  const eventful = new Set(allEvents.map((event) => event.playerId))
  const available = new Set(session.playerIds.filter((id) => !eventful.has(id)))
  const opportunity = new Map(session.playerIds.map((id) => [id, 0]))
  const events = allEvents
    .filter((event) => event.at <= end)
    .slice()
    .sort((a, b) => a.at - b.at)
  const slots = session.courtCount * (session.format === 'singles' ? 2 : 4)
  let previous = session.startedAt
  const accumulate = (until: number) => {
    const share = available.size ? Math.min(1, slots / available.size) : 0
    const minutes = (Math.max(0, until - previous) / 60_000) * share
    for (const id of available) opportunity.set(id, opportunity.get(id)! + minutes)
    previous = until
  }
  for (const event of events) {
    accumulate(Math.max(session.startedAt, event.at))
    if (event.available) available.add(event.playerId)
    else available.delete(event.playerId)
  }
  accumulate(end)
  return opportunity
}

/**
 * Provisional doubles/singles Elo: initial level seeds 600..1400; each accepted
 * result updates everyone on a side by 24 * (outcome - expected), using the
 * side's average rating. This estimates team-result strength, not individual
 * rally contribution. A scoped calculation restarts from declared levels.
 */
function allStats(data: AppData, sessionIds?: string[]): Map<string, PlayerStats> {
  const stats = new Map(
    data.players.map((player) => [
      player.id,
      {
        played: 0,
        wins: 0,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        minutes: 0,
        rating: baseRating(player),
      },
    ]),
  )
  const sessionMap = new Map(data.sessions.map((session) => [session.id, session]))
  const scope = sessionIds === undefined ? undefined : new Set(sessionIds)
  const matches = data.matches
    .filter((match) => match.status === 'completed' && (!scope || scope.has(match.sessionId)))
    .slice()
    .sort((left, right) => matchEnd(left) - matchEnd(right) || left.id.localeCompare(right.id))

  for (const match of matches) {
    const session = sessionMap.get(match.sessionId)
    if (!session) continue
    const participants = [...match.teamA, ...match.teamB]
    if (
      !match.teamA.length ||
      !match.teamB.length ||
      new Set(participants).size !== participants.length ||
      participants.some((id) => !stats.has(id))
    )
      continue
    const score = scoreMatch(match, session)
    // A status flag on its own is not proof of a finished match.
    if (!score.complete || !score.winner) continue
    const average = (ids: string[]) =>
      ids.reduce((sum, id) => sum + stats.get(id)!.rating, 0) / ids.length
    const expectedA = 1 / (1 + 10 ** ((average(match.teamB) - average(match.teamA)) / 400))
    const changeA = 24 * ((score.winner === 'A' ? 1 : 0) - expectedA)
    const pointsA = score.games.reduce((sum, game) => sum + game.a, 0)
    const pointsB = score.games.reduce((sum, game) => sum + game.b, 0)
    for (const [side, ids] of [
      ['A', match.teamA],
      ['B', match.teamB],
    ] as const) {
      for (const id of ids) {
        const row = stats.get(id)!
        row.played += 1
        row.wins += Number(score.winner === side)
        row.losses += Number(score.winner !== side)
        row.pointsFor += side === 'A' ? pointsA : pointsB
        row.pointsAgainst += side === 'A' ? pointsB : pointsA
        row.minutes += duration(match)
        row.rating += side === 'A' ? changeA : -changeA
      }
    }
  }
  for (const row of stats.values()) {
    row.rating = Math.round(row.rating)
    row.minutes = Math.round(row.minutes * 10) / 10
  }
  return stats
}

export function playerStats(data: AppData, playerId: string, sessionIds?: string[]): PlayerStats {
  return (
    allStats(data, sessionIds).get(playerId) ?? {
      played: 0,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      minutes: 0,
      rating: 1000,
    }
  )
}

/** Standings contain players with at least one accepted result in this scope. */
export function getStandings(
  data: AppData,
  sessionIds?: string[],
): (PlayerStats & { playerId: string })[] {
  return [...allStats(data, sessionIds)]
    .filter(([, row]) => row.played > 0)
    .map(([playerId, row]) => ({ playerId, ...row }))
    .sort(
      (a, b) =>
        b.wins - a.wins ||
        b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst) ||
        b.rating - a.rating ||
        a.playerId.localeCompare(b.playerId),
    )
}

/**
 * Selects participants by court time relative to available fair-share
 * opportunity, then waiting and side balance. Legacy data without attendance
 * events assumes availability from session start. Court capacity is the
 * session's current configuration; this remains a scheduling heuristic.
 */
export function suggestMatch(
  data: AppData,
  session: Session,
  court: number,
  now = Date.now(),
): MatchSuggestion | null {
  if (session.status !== 'active' || court < 1 || court > session.courtCount) return null
  const current = data.matches.filter((match) => match.sessionId === session.id)
  if (current.some((match) => match.court === court && match.status === 'playing')) return null
  const busy = new Set(
    data.matches
      .filter((match) => match.status === 'playing')
      .flatMap((match) => [...match.teamA, ...match.teamB]),
  )
  const playerMap = new Map(data.players.map((player) => [player.id, player]))
  const membership = new Set(session.playerIds)
  const eligible = [...new Set(session.availablePlayerIds)].filter(
    (id) => membership.has(id) && playerMap.has(id) && !busy.has(id),
  )
  const teamSize = session.format === 'singles' ? 1 : 2
  if (eligible.length < teamSize * 2) return null

  const opportunity = courtOpportunity(session, now)
  const priority = (id: string) => {
    const played = current.filter(
      (match) => includesPlayer(match, id) && match.status !== 'playing',
    )
    const minutes = played.reduce((sum, match) => sum + duration(match), 0)
    const lastEnd = Math.max(
      attendanceSummary(session, id, now).waitingSince,
      ...played.map(matchEnd),
    )
    const waiting = Math.max(0, now - lastEnd) / 60_000
    // A small count term resolves immediate/zero-duration demo results.
    return minutes - (opportunity.get(id) ?? 0) + played.length * 0.25 - waiting * 0.2
  }
  const selected = eligible
    .sort(
      (a, b) =>
        priority(a) - priority(b) || session.playerIds.indexOf(a) - session.playerIds.indexOf(b),
    )
    .slice(0, teamSize * 2)
  const stats = allStats(data)
  const repeats = (ids: string[]) => {
    if (ids.length < 2) return 0
    // Include recent sessions, not just today's rotation.
    return data.matches.filter(
      (match) =>
        match.status !== 'abandoned' &&
        [match.teamA, match.teamB].some((team) => ids.every((id) => team.includes(id))),
    ).length
  }
  const partitions =
    teamSize === 1
      ? [[selected.slice(0, 1), selected.slice(1, 2)]]
      : [
          [
            [selected[0], selected[1]],
            [selected[2], selected[3]],
          ],
          [
            [selected[0], selected[2]],
            [selected[1], selected[3]],
          ],
          [
            [selected[0], selected[3]],
            [selected[1], selected[2]],
          ],
        ]
  const cost = ([a, b]: string[][]) => {
    const strength = (ids: string[]) =>
      ids.reduce((sum, id) => sum + stats.get(id)!.rating, 0) / ids.length
    const gap = Math.abs(strength(a) - strength(b)) / 200
    const history = repeats(a) + repeats(b)
    return session.mode === 'variety'
      ? history * 10 + gap
      : session.mode === 'balanced'
        ? gap + history * 0.15
        : gap * 0.05 + history * 0.1
  }
  const [teamA, teamB] = partitions.sort((a, b) => cost(a) - cost(b))[0]
  const reason =
    session.mode === 'variety'
      ? 'Prioritizes less court time and longer waits, then avoids repeated partnerships.'
      : session.mode === 'balanced'
        ? 'Prioritizes less court time and longer waits, then balances provisional player strength.'
        : 'Prioritizes less court time and longer waits, with partner variety as a tie-breaker.'
  return { teamA, teamB, reason }
}
