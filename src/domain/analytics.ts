import { getStandings, scoreMatch } from './engine'
import type { AppData, Match, PlayerStats, Session } from './model'
import { matchPlayIntervals } from './timing'

export interface AnalyticsFilters {
  sessionId?: string
  format?: 'all' | 'singles' | 'doubles'
  /** Inclusive lower / exclusive upper result timestamp in milliseconds. */
  from?: number
  to?: number
  /** Matches involving any selected player; standings show selected players only. */
  playerIds?: string[]
}

export interface AnalyticsPlayer extends PlayerStats {
  playerId: string
  name: string
  winRate: number
  pointShare: number
  creditedPoints: number | null
  attributionCoverage: number
  performanceIndex: number
}

export interface PartnershipStats {
  playerIds: [string, string]
  names: [string, string]
  played: number
  wins: number
  losses: number
  pointsFor: number
  pointsAgainst: number
  winRate: number
  expectedWins: number
  /** Wins above expectation per match, shrunk toward zero with five neutral matches. */
  adjustedPerformance: number
}

export interface OpponentStats {
  playerIds: [string, string]
  names: [string, string]
  played: number
  winsA: number
  winsB: number
  pointsA: number
  pointsB: number
}

export interface ParticipationStats {
  playerId: string
  name: string
  played: number
  minutes: number
  availableMinutes: number
  waitingMinutes: number
  longestWaitMinutes: number
  maxConsecutivePlays: number
  maxConsecutiveRests: number
}

export interface Analytics {
  filters: AnalyticsFilters
  matches: Match[]
  acceptedMatches: Match[]
  players: AnalyticsPlayer[]
  partnerships: PartnershipStats[]
  opponents: OpponentStats[]
  participation: ParticipationStats[]
  summary: {
    completedMatches: number
    stoppedMatches: number
    activeMatches: number
    attributionCoverage: number
  }
  definitions: Record<string, string>
}

const round = (n: number) => Math.round(n * 10) / 10
const contains = (m: Match, id: string) => m.teamA.includes(id) || m.teamB.includes(id)
const pair = (a: string, b: string): [string, string] => (a.localeCompare(b) <= 0 ? [a, b] : [b, a])
const pairKey = (ids: [string, string]) => JSON.stringify(ids)
const ratio = (n: number, d: number) => (d > 0 ? n / d : 0)

/** One filter function is shared by visible statistics, JSON, CSV, and PDF reports. */
export function filterAnalyticsMatches(data: AppData, filters: AnalyticsFilters = {}): Match[] {
  const sessions = new Map(data.sessions.map((s) => [s.id, s]))
  const selection = new Set(filters.playerIds)
  return data.matches
    .filter((m) => {
      const s = sessions.get(m.sessionId)
      const at = m.endedAt ?? m.startedAt
      return (
        Boolean(s) &&
        (!filters.sessionId || m.sessionId === filters.sessionId) &&
        (!filters.format || filters.format === 'all' || s?.format === filters.format) &&
        (filters.from === undefined || at >= filters.from) &&
        (filters.to === undefined || at < filters.to) &&
        (!selection.size || [...m.teamA, ...m.teamB].some((id) => selection.has(id)))
      )
    })
    .slice()
    .sort(
      (a, b) => (a.endedAt ?? a.startedAt) - (b.endedAt ?? b.startedAt) || a.id.localeCompare(b.id),
    )
}

function availabilityIntervals(
  session: Session,
  playerId: string,
  now: number,
): [number, number][] {
  const end = Math.max(session.startedAt, Math.min(now, session.endedAt ?? now))
  const personalEvents = (session.attendance ?? []).filter((a) => a.playerId === playerId)
  const events = personalEvents
    .filter((a) => a.at <= end)
    .slice()
    .sort((a, b) => a.at - b.at)
  const window = session.availability?.[playerId]
  const clip = (intervals: [number, number][]) =>
    intervals
      .map(
        ([a, b]) =>
          [Math.max(a, window?.from ?? session.startedAt), Math.min(b, window?.until ?? end)] as [
            number,
            number,
          ],
      )
      .filter(([a, b]) => b > a)
  if (!events.length) return personalEvents.length ? [] : clip([[session.startedAt, end]])
  const intervals: [number, number][] = []
  let start = session.startedAt
  let available = false
  for (const event of events) {
    const at = Math.max(session.startedAt, event.at)
    if (available && at > start) intervals.push([start, at])
    available = event.available
    start = at
  }
  if (available && end > start) intervals.push([start, end])
  return clip(intervals)
}

function participation(
  data: AppData,
  matches: Match[],
  filters: AnalyticsFilters,
  now: number,
): ParticipationStats[] {
  const selected = new Set(filters.playerIds)
  const sessions = data.sessions.filter(
    (s) =>
      (!filters.sessionId || s.id === filters.sessionId) &&
      (!filters.format || filters.format === 'all' || s.format === filters.format) &&
      (s.endedAt ?? now) >= (filters.from ?? 0) &&
      s.startedAt < (filters.to ?? Infinity),
  )
  const ids = new Set(
    sessions.flatMap((s) => s.playerIds).filter((id) => !selected.size || selected.has(id)),
  )
  const names = new Map(data.players.map((p) => [p.id, p.name]))
  return [...ids]
    .filter((id) => names.has(id))
    .map((playerId) => {
      let available = 0
      let playedMs = 0
      let longestWait = 0
      let maxConsecutivePlays = 0
      let maxConsecutiveRests = 0
      const personal = matches.filter((m) => contains(m, playerId))
      for (const session of sessions.filter((s) => s.playerIds.includes(playerId))) {
        const sessionMatches = data.matches.filter(
          (m) =>
            m.sessionId === session.id &&
            (m.endedAt ?? now) >= (filters.from ?? 0) &&
            m.startedAt < (filters.to ?? Infinity),
        )
        const intervals = availabilityIntervals(session, playerId, now)
          .map(
            ([a, b]) =>
              [Math.max(a, filters.from ?? 0), Math.min(b, filters.to ?? Infinity)] as [
                number,
                number,
              ],
          )
          .filter(([a, b]) => b > a)
        const courtIntervals = sessionMatches
          .filter((m) => contains(m, playerId))
          .flatMap((m) => matchPlayIntervals(m, now))
          .sort((a, b) => a[0] - b[0])
        for (const [start, end] of intervals) {
          available += end - start
          let cursor = start
          for (const [a, b] of courtIntervals) {
            const left = Math.max(start, a)
            const right = Math.min(end, b)
            if (right <= left) continue
            longestWait = Math.max(longestWait, left - cursor)
            playedMs += Math.max(0, right - Math.max(cursor, left))
            cursor = Math.max(cursor, right)
          }
          longestWait = Math.max(longestWait, end - cursor)
        }
        // Planned round identities are exact. Legacy sessions group starts within
        // one minute as an estimate; durations above remain timestamp-based.
        const rounds = new Map<string, Match[]>()
        for (const match of sessionMatches) {
          const slot = session.plan?.slots.find(
            (slot) => slot.id === match.planSlotId || slot.matchId === match.id,
          )
          const key = slot ? `round:${slot.round}` : `minute:${Math.floor(match.startedAt / 60000)}`
          rounds.set(key, [...(rounds.get(key) ?? []), match])
        }
        let plays = 0
        let rests = 0
        for (const group of [...rounds.values()].sort(
          (a, b) => Math.min(...a.map((m) => m.startedAt)) - Math.min(...b.map((m) => m.startedAt)),
        )) {
          const at = Math.min(...group.map((m) => m.startedAt))
          const isAvailable = intervals.some(([a, b]) => at >= a && at <= b)
          if (!isAvailable) {
            plays = 0
            rests = 0
            continue
          }
          const isPlaying =
            group.some((m) => contains(m, playerId)) ||
            courtIntervals.some(([a, b]) => at >= a && at < b)
          if (isPlaying) {
            plays++
            rests = 0
          } else {
            rests++
            plays = 0
          }
          maxConsecutivePlays = Math.max(maxConsecutivePlays, plays)
          maxConsecutiveRests = Math.max(maxConsecutiveRests, rests)
        }
      }
      return {
        playerId,
        name: names.get(playerId)!,
        played: personal.length,
        minutes: round(playedMs / 60000),
        availableMinutes: round(available / 60000),
        waitingMinutes: round(Math.max(0, available - playedMs) / 60000),
        longestWaitMinutes: round(longestWait / 60000),
        maxConsecutivePlays,
        maxConsecutiveRests,
      }
    })
    .sort((a, b) => b.longestWaitMinutes - a.longestWaitMinutes || a.name.localeCompare(b.name))
}

/** Statistics are derived from accepted results, never projected schedule results. */
export function getAnalytics(
  data: AppData,
  filters: AnalyticsFilters = {},
  now = Date.now(),
): Analytics {
  const matches = filterAnalyticsMatches(data, filters)
  const sessions = new Map(data.sessions.map((s) => [s.id, s]))
  const playerMap = new Map(data.players.map((p) => [p.id, p]))
  const selected = new Set(filters.playerIds)
  const acceptedMatches = matches.filter((m) => {
    const s = sessions.get(m.sessionId)
    const ids = [...m.teamA, ...m.teamB]
    const size = s?.format === 'singles' ? 1 : 2
    return (
      m.status === 'completed' &&
      s &&
      m.teamA.length === size &&
      m.teamB.length === size &&
      new Set(ids).size === ids.length &&
      ids.every((id) => playerMap.has(id)) &&
      scoreMatch(m, s).complete
    )
  })
  const scoped = { ...data, matches: acceptedMatches }
  const standings = getStandings(scoped)
  const ratings = new Map(
    data.players.map((p) => [p.id, 600 + (Math.max(1, Math.min(5, p.level)) - 1) * 200]),
  )
  const expected = new Map<string, number>()
  const credits = new Map<string, { points: number; covered: number; total: number }>()
  const partnerships = new Map<string, PartnershipStats>()
  const opponents = new Map<string, OpponentStats>()
  let attributedPoints = 0
  let totalPoints = 0
  for (const match of acceptedMatches) {
    const score = scoreMatch(match, sessions.get(match.sessionId)!)
    const aPoints = score.games.reduce((sum, g) => sum + g.a, 0)
    const bPoints = score.games.reduce((sum, g) => sum + g.b, 0)
    const average = (ids: string[]) =>
      ids.reduce((sum, id) => sum + (ratings.get(id) ?? 1000), 0) / ids.length
    const expectedA = 1 / (1 + 10 ** ((average(match.teamB) - average(match.teamA)) / 400))
    const change = 24 * (Number(score.winner === 'A') - expectedA)
    const allCredits = score.allCredits ?? {}
    attributedPoints += Object.values(allCredits).reduce((sum, n) => sum + n, 0)
    totalPoints += aPoints + bPoints
    for (const [side, ids, pointsFor, pointsAgainst, expectedWin] of [
      ['A', match.teamA, aPoints, bPoints, expectedA],
      ['B', match.teamB, bPoints, aPoints, 1 - expectedA],
    ] as const) {
      const won = score.winner === side
      const covered = ids.reduce((sum, id) => sum + (allCredits[id] ?? 0), 0)
      for (const id of ids) {
        expected.set(id, (expected.get(id) ?? 0) + expectedWin)
        const credit = credits.get(id) ?? { points: 0, covered: 0, total: 0 }
        credit.points += allCredits[id] ?? 0
        credit.covered += covered
        credit.total += pointsFor
        credits.set(id, credit)
        ratings.set(id, (ratings.get(id) ?? 1000) + (side === 'A' ? change : -change))
      }
      if (ids.length === 2 && (!selected.size || ids.some((id) => selected.has(id)))) {
        const playerIds = pair(ids[0], ids[1])
        const key = pairKey(playerIds)
        const entry = partnerships.get(key) ?? {
          playerIds,
          names: playerIds.map((id) => playerMap.get(id)!.name) as [string, string],
          played: 0,
          wins: 0,
          losses: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          winRate: 0,
          expectedWins: 0,
          adjustedPerformance: 0,
        }
        entry.played++
        entry.wins += Number(won)
        entry.losses += Number(!won)
        entry.pointsFor += pointsFor
        entry.pointsAgainst += pointsAgainst
        entry.expectedWins += expectedWin
        partnerships.set(key, entry)
      }
    }
    for (const a of match.teamA)
      for (const b of match.teamB) {
        if (selected.size && !selected.has(a) && !selected.has(b)) continue
        const playerIds = pair(a, b)
        const key = pairKey(playerIds)
        const firstIsA = playerIds[0] === a
        const entry = opponents.get(key) ?? {
          playerIds,
          names: playerIds.map((id) => playerMap.get(id)!.name) as [string, string],
          played: 0,
          winsA: 0,
          winsB: 0,
          pointsA: 0,
          pointsB: 0,
        }
        entry.played++
        entry.winsA += Number(score.winner === (firstIsA ? 'A' : 'B'))
        entry.winsB += Number(score.winner !== (firstIsA ? 'A' : 'B'))
        entry.pointsA += firstIsA ? aPoints : bPoints
        entry.pointsB += firstIsA ? bPoints : aPoints
        opponents.set(key, entry)
      }
  }
  const players = standings
    .filter((row) => !selected.size || selected.has(row.playerId))
    .map((row) => {
      const credit = credits.get(row.playerId)
      const winRate = ratio(row.wins, row.played)
      const pointShare = ratio(row.pointsFor, row.pointsFor + row.pointsAgainst)
      const adjusted =
        (row.wins - (expected.get(row.playerId) ?? row.played / 2)) / (row.played + 5)
      const performanceIndex = Math.round(
        100 *
          (0.5 * ((row.wins + 1) / (row.played + 2)) +
            0.3 * pointShare +
            0.2 * (0.5 + adjusted / 2)),
      )
      return {
        ...row,
        playerId: row.playerId,
        name: playerMap.get(row.playerId)?.name ?? 'Unknown player',
        winRate,
        pointShare,
        creditedPoints:
          credit && credit.covered > 0 && (credit.points > 0 || credit.covered >= credit.total)
            ? credit.points
            : null,
        attributionCoverage: ratio(credit?.covered ?? 0, credit?.total ?? 0),
        performanceIndex,
      }
    })
  return {
    filters: { ...filters },
    matches,
    acceptedMatches,
    players,
    partnerships: [...partnerships.values()]
      .map((p) => ({
        ...p,
        winRate: ratio(p.wins, p.played),
        adjustedPerformance: (p.wins - p.expectedWins) / (p.played + 5),
        expectedWins: Math.round(p.expectedWins * 100) / 100,
      }))
      .sort(
        (a, b) =>
          b.adjustedPerformance - a.adjustedPerformance ||
          b.played - a.played ||
          a.names.join().localeCompare(b.names.join()),
      ),
    opponents: [...opponents.values()].sort(
      (a, b) => b.played - a.played || a.names.join().localeCompare(b.names.join()),
    ),
    participation: participation(data, matches, filters, now),
    summary: {
      completedMatches: acceptedMatches.length,
      stoppedMatches: matches.filter((m) => m.status === 'abandoned').length,
      activeMatches: matches.filter((m) => m.status === 'playing').length,
      attributionCoverage: ratio(attributedPoints, totalPoints),
    },
    definitions: {
      scope:
        'Results use their completion timestamp (or start if unfinished). From is inclusive; to is exclusive. Selected-player views include matches involving any selected player; standings show selected players and relationship views retain their counterparts.',
      accepted:
        'Only confirmed, legally completed matches affect competitive statistics. Active and stopped matches appear in session reports and participation, not wins or ratings.',
      points:
        'Points for/against are side totals credited to each participant, not individual rally winners.',
      attribution:
        'Credited points are optional organizer attribution. Unrecorded attribution is unknown, not zero. Coverage is attributed side points divided by all side points in the scope.',
      partnership:
        'Adjusted performance = (actual wins − pre-match expected wins) / (matches + 5). Expected wins use level-seeded team Elo; the neutral five-match prior shrinks small samples toward zero. This is not proof of personal compatibility.',
      opponents:
        'Each row compares two players when they were on opposite sides. In doubles these are team-result encounters, not singles head-to-head results.',
      performance:
        'Experimental index, 0–100: 50% smoothed win rate ((wins+1)/(matches+2)) + 30% point share + 20% opposition-adjusted form (0.5 + (wins−expectedWins)/(2×(matches+5))). It is not an official rating and never controls court priority.',
      participation:
        'Recorded play minutes exclude recorded match pauses and tracked result-review time; older records use elapsed duration. Available time excludes recorded attendance breaks. Waiting is available time outside recorded play, including match pauses. Round streaks use recorded plan rounds; legacy starts within one minute are grouped as an estimate. Rankings do not award participation priority.',
      rating:
        'Provisional level-seeded Elo, average team strength and K=24. Scoped ratings restart from declared levels and include only accepted results in that scope.',
    },
  }
}
