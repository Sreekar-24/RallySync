import type {
  AppData,
  Match,
  MatchScore,
  MatchSuggestion,
  ScoreAction,
  Player,
  PlayerStats,
  Session,
  Side,
} from './model'
import { matchPlayMinutes, syncMatchTiming } from './timing'

export interface ScoreEntry {
  a: number
  b: number
  credits?: Record<string, number>
}
type GameState = { a: number; b: number; credits: Record<string, number> }
const emptyGame = (): GameState => ({ a: 0, b: 0, credits: {} })
const cloneGames = (games: GameState[]): GameState[] =>
  games.map((g) => ({ ...g, credits: { ...g.credits } }))

function winningSide(game: Pick<GameState, 'a' | 'b'>, session: Session): Side | undefined {
  const high = Math.max(game.a, game.b)
  if (game.a === game.b || high < session.target) return
  if (high >= session.cap || Math.abs(game.a - game.b) >= session.winBy)
    return game.a > game.b ? 'A' : 'B'
}

/** A legal score must be reachable without continuing past an earlier game point. */
function validateGameScore(game: ScoreEntry, session: Session): void {
  const { a, b } = game
  if (
    !Number.isInteger(a) ||
    !Number.isInteger(b) ||
    a < 0 ||
    b < 0 ||
    Math.max(a, b) > session.cap
  )
    throw new Error('Scores must be whole numbers between 0 and the game cap.')
  const winner = winningSide(game, session)
  if (Math.max(a, b) === session.cap && !winner)
    throw new Error('A game cannot be tied at its score cap.')
  if (winner) {
    const prior = { a: a - Number(winner === 'A'), b: b - Number(winner === 'B') }
    if (winningSide(prior, session))
      throw new Error(
        `That game would have ended earlier. Reach ${session.target}, win by ${session.winBy}, cap ${session.cap}.`,
      )
  }
}

function validateEntries(match: Match, session: Session, entries: ScoreEntry[]): GameState[] {
  if (!entries.length || entries.length > session.bestOf)
    throw new Error('Enter games in order, within the match length.')
  let aWins = 0
  let bWins = 0
  const needed = session.bestOf === 3 ? 2 : 1
  const output: GameState[] = []
  for (let i = 0; i < entries.length; i++) {
    if (aWins >= needed || bWins >= needed)
      throw new Error('Remove games entered after the match was already won.')
    const entry = entries[i]
    validateGameScore(entry, session)
    const credits = { ...(entry.credits ?? {}) }
    for (const [id, value] of Object.entries(credits)) {
      if (![...match.teamA, ...match.teamB].includes(id) || !Number.isInteger(value) || value < 0)
        throw new Error(
          'Credited points must belong to a player in this match and be non-negative whole numbers.',
        )
    }
    const sum = (ids: string[]) => ids.reduce((total, id) => total + (credits[id] ?? 0), 0)
    if (sum(match.teamA) > entry.a || sum(match.teamB) > entry.b)
      throw new Error(
        'Player credits exceed the side’s total. Adjust player points, or choose unassigned points.',
      )
    const winner = winningSide(entry, session)
    if (!winner && i < entries.length - 1)
      throw new Error('Finish a game before entering the next one.')
    if (winner === 'A') aWins++
    else if (winner === 'B') bWins++
    output.push({ a: entry.a, b: entry.b, credits })
  }
  if (winningSide(output.at(-1)!, session) && aWins < needed && bWins < needed)
    output.push(emptyGame())
  return output
}

function describeScore(games: GameState[], session: Session): MatchScore {
  const completed: MatchScore['games'] = []
  let gamesA = 0
  let gamesB = 0
  const needed = session.bestOf === 3 ? 2 : 1
  const allCredits: Record<string, number> = {}
  let totalPoints = 0
  for (const game of games) {
    totalPoints += game.a + game.b
    for (const [id, points] of Object.entries(game.credits))
      allCredits[id] = (allCredits[id] ?? 0) + points
    const winner = winningSide(game, session)
    if (winner) {
      completed.push({ a: game.a, b: game.b, winner })
      if (winner === 'A') gamesA++
      else gamesB++
    }
  }
  const complete = gamesA >= needed || gamesB >= needed
  const current = games.at(-1) ?? emptyGame()
  return {
    a: current.a,
    b: current.b,
    gamesA,
    gamesB,
    games: completed,
    complete,
    winner: complete ? (gamesA >= needed ? 'A' : 'B') : undefined,
    credits: { ...current.credits },
    allCredits,
    totalPoints,
    attributedPoints: Object.values(allCredits).reduce((a, b) => a + b, 0),
  }
}

/** A surviving, verified scoring operation and its one-based game number. */
export interface EffectiveScoreAction {
  action: ScoreAction
  game: number
  sourceIndex: number
}

function applyScoreAction(
  games: GameState[],
  action: ScoreAction,
  match: Match,
  session: Session,
): GameState[] | null {
  if (action.kind === 'adjust' && action.scores) {
    try {
      return validateEntries(match, session, action.scores)
    } catch {
      return null
    }
  }
  if (action.kind !== 'point' || !action.side || describeScore(games, session).complete) return null
  const next = cloneGames(games)
  const game = next.at(-1)!
  if (action.side === 'A') game.a++
  else game.b++
  const team = action.side === 'A' ? match.teamA : match.teamB
  if (action.playerId && team.includes(action.playerId) && !action.synthetic)
    game.credits[action.playerId] = (game.credits[action.playerId] ?? 0) + 1
  if (winningSide(game, session) && !describeScore(next, session).complete) next.push(emptyGame())
  return next
}

function replayScoreActions(
  match: Match,
  session: Session,
): { score: MatchScore; games: GameState[]; undoDepth: number; effective: EffectiveScoreAction[] } {
  let games = [emptyGame()]
  let effective: EffectiveScoreAction[] = []
  // Patches keep undo atomic without copying an entire rally log for every tap.
  const history: {
    games: GameState[]
    added?: boolean
    removed?: { event: EffectiveScoreAction; index: number }
  }[] = []
  const seen = new Set<string>()
  for (let sourceIndex = 0; sourceIndex < match.actions.length; sourceIndex++) {
    const action = match.actions[sourceIndex]
    if (seen.has(action.id)) continue
    seen.add(action.id)
    if (action.kind === 'undo') {
      const previous = history.pop()
      if (previous) {
        games = previous.games
        if (previous.added) effective.pop()
        else if (previous.removed)
          effective.splice(previous.removed.index, 0, previous.removed.event)
      }
      continue
    }
    if (action.kind === 'remove') {
      const index = effective.findIndex((event) => event.action.id === action.targetId)
      const target = effective[index]
      // Minus never reaches back into a previous game. Use the full editor for that.
      if (
        !target ||
        target.action.kind !== 'point' ||
        target.game !== games.length ||
        (action.side && target.action.side !== action.side)
      )
        continue
      const remaining = effective.filter((_, i) => i !== index)
      let rebuilt = [emptyGame()]
      let valid = true
      for (const event of remaining) {
        const next = applyScoreAction(rebuilt, event.action, match, session)
        if (!next) {
          valid = false
          break
        }
        rebuilt = next
      }
      if (!valid) continue
      history.push({ games: cloneGames(games), removed: { event: target, index } })
      effective = remaining
      games = rebuilt
      continue
    }
    const next = applyScoreAction(games, action, match, session)
    if (!next) continue
    history.push({ games: cloneGames(games), added: true })
    effective.push({ action, game: games.length, sourceIndex })
    games = next
  }
  return { score: describeScore(games, session), games, undoDepth: history.length, effective }
}

/** Exact surviving operations; removes and undo are resolved without fabricated rallies. */
export function getEffectiveScoreActions(match: Match, session: Session): EffectiveScoreAction[] {
  return replayScoreActions(match, session).effective
}

/** Retract the latest known rally for this side in the displayed game. */
export function removePoint(
  match: Match,
  session: Session,
  side: Side,
  playerId?: string,
  now = Date.now(),
): Match {
  if (match.status !== 'playing') throw new Error('Only a playing match can be scored.')
  const replay = replayScoreActions(match, session)
  const current = replay.games.at(-1)!
  const key = side === 'A' ? 'a' : 'b'
  const team = side === 'A' ? match.teamA : match.teamB
  if (playerId && !team.includes(playerId)) throw new Error('Choose a player on this side.')
  if (current[key] === 0 || (playerId && !(current.credits[playerId] > 0))) return match
  // An adjustment is a new score baseline: never remove a pre-baseline rally whose
  // value the snapshot would simply restore.
  const lastAdjustment = replay.effective.map((event) => event.action.kind).lastIndexOf('adjust')
  const target = replay.effective
    .slice(lastAdjustment + 1)
    .reverse()
    .find(
      (event) =>
        event.game === replay.games.length &&
        event.action.kind === 'point' &&
        event.action.side === side &&
        (!playerId || (event.action.playerId === playerId && !event.action.synthetic)),
    )
  if (target) {
    const changed: Match = {
      ...match,
      revision: match.revision + 1,
      actions: [
        ...match.actions,
        {
          id: crypto.randomUUID(),
          kind: 'remove',
          side,
          targetId: target.action.id,
          at: now,
        },
      ],
    }
    const actual = replayScoreActions(changed, session).games
    if (actual.length === replay.games.length && actual.at(-1)![key] === current[key] - 1)
      return changed
  }
  // Imported/typed totals have no rally order. Correct the snapshot, keeping
  // unassigned points first and reducing a known credit only when necessary.
  const entries = cloneGames(replay.games)
  const entry = entries.at(-1)!
  entry[key]--
  if (playerId) entry.credits[playerId]--
  else {
    const credited = team.reduce((sum, id) => sum + (entry.credits[id] ?? 0), 0)
    if (credited > entry[key]) {
      const candidates = team.filter((id) => (entry.credits[id] ?? 0) > 0)
      if (candidates.length > 1)
        throw new Error(
          'Choose which player’s point to remove using their − button, or edit the point allocation.',
        )
      const id = candidates[0]
      if (id) entry.credits[id]--
    }
  }
  return adjustMatchScores(match, session, entries, now)
}

/** Replays legacy rallies and explicit adjustments. Undo restores one whole previous operation. */
export function scoreMatch(match: Match, session: Session): MatchScore {
  return replayScoreActions(match, session).score
}

export function canUndoScore(match: Match, session: Session): boolean {
  return replayScoreActions(match, session).undoDepth > 0
}

/** Completed games plus the current game. No synthetic rally-order claims are made. */
export function getScoreEntries(match: Match, session: Session): GameState[] {
  return cloneGames(replayScoreActions(match, session).games)
}

export function adjustMatchScores(
  match: Match,
  session: Session,
  entries: ScoreEntry[],
  now = Date.now(),
): Match {
  const old = getScoreEntries(match, session)
  const withCredits = entries.map((entry, i) => ({
    ...entry,
    credits: entry.credits ?? old[i]?.credits ?? {},
  }))
  const verified = validateEntries(match, session, withCredits)
  // Omit an implicit empty game from the event; replay will reopen it as needed.
  const scores =
    verified.length > 1 && verified.at(-1)!.a === 0 && verified.at(-1)!.b === 0
      ? verified.slice(0, -1)
      : verified
  return syncMatchTiming(
    {
      ...match,
      status: 'playing',
      endedAt: undefined,
      revision: match.revision + 1,
      actions: [...match.actions, { id: crypto.randomUUID(), kind: 'adjust', at: now, scores }],
    },
    session,
    now,
  )
}

/** An accepted result uses one auditable correction, never fabricated per-rally history. */
export function buildFinalResult(
  match: Match,
  session: Session,
  entries: ScoreEntry[],
  now = Date.now(),
): Match {
  if (!entries.length) throw new Error('Enter at least one complete game.')
  const changed = adjustMatchScores(match, session, entries, now)
  if (!scoreMatch(changed, session).complete)
    throw new Error('Enter enough games to decide the match.')
  return {
    ...changed,
    status: 'completed',
    endedAt: match.endedAt ?? now,
    ...(match.timing && match.status === 'completed'
      ? {
          timing: {
            ...changed.timing!,
            finishedAt: match.timing.finishedAt ?? match.endedAt ?? now,
          },
        }
      : {}),
  }
}

function baseRating(player: Player): number {
  return 600 + (Math.max(1, Math.min(5, player.level)) - 1) * 200
}

function matchEnd(match: Match): number {
  return match.endedAt ?? match.actions.at(-1)?.at ?? match.startedAt
}

function duration(match: Match): number {
  return matchPlayMinutes(match, match.endedAt ?? match.actions.at(-1)?.at ?? match.startedAt)
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
    (id) =>
      membership.has(id) &&
      playerMap.has(id) &&
      !busy.has(id) &&
      (session.availability?.[id]?.from ?? -Infinity) <= now &&
      (session.availability?.[id]?.until ?? Infinity) > now,
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
