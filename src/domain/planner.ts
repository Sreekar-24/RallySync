import { attendanceSummary, getStandings, playerStats, scoreMatch } from './engine'
import type { AppData, Match, PlannedMatch, PlanningSettings, Session, SessionPlan } from './model'

type Weights = NonNullable<PlanningSettings['weights']>
type Assignment = { slotId: string; teamA: string[]; teamB: string[] }
type PlayerLoad = {
  minutes: number
  opportunity: number
  matches: number
  plays: number
  rests: number
  lastRound: number
}
type History = {
  partners: Map<string, number>
  opponents: Map<string, number>
  encounters: Map<string, number>
  residuals: Map<string, { count: number; total: number }>
}
const MINUTE = 60_000
const MAX_MATCHES = 200
const pairKey = (ids: string[]) => [...ids].sort().join('|')
const matchupKey = (a: string[], b: string[]) => [pairKey(a), pairKey(b)].sort().join(' vs ')
const members = (slot: Pick<PlannedMatch, 'teamA' | 'teamB'>) => [...slot.teamA, ...slot.teamB]
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
const increment = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1)

export function defaultPlannerWeights(mode: Session['mode']): Weights {
  if (mode === 'fair')
    return { fairness: 10, rest: 9, balance: 1, variety: 3, partnership: 1, contribution: 0 }
  if (mode === 'variety')
    return { fairness: 8, rest: 7, balance: 2, variety: 10, partnership: 1, contribution: 0 }
  return { fairness: 8, rest: 7, balance: 6, variety: 3, partnership: 2, contribution: 0 }
}

function settings(session: Session): PlanningSettings {
  const input = session.planning
  return {
    basis: input?.basis === 'duration' ? 'duration' : 'matches',
    matchCount: Math.round(clamp(input?.matchCount ?? 12, 1, MAX_MATCHES)),
    durationMinutes: clamp(input?.durationMinutes ?? 120, 5, 720),
    matchMinutes: clamp(input?.matchMinutes ?? (session.bestOf === 3 ? 30 : 12), 2, 120),
    changeoverMinutes: clamp(input?.changeoverMinutes ?? 2, 0, 20),
    weights: Object.fromEntries(
      Object.entries(defaultPlannerWeights(session.mode)).map(([key, fallback]) => [
        key,
        clamp(input?.weights?.[key as keyof Weights] ?? fallback, 0, 10),
      ]),
    ) as Weights,
  }
}

function expectedEnd(match: Match, config: PlanningSettings, now: number) {
  return match.status === 'playing'
    ? Math.max(
        match.startedAt + config.matchMinutes * MINUTE,
        now + Math.min(2, config.matchMinutes * 0.2) * MINUTE,
      )
    : (match.endedAt ?? match.startedAt)
}

function strengthRatings(data: AppData) {
  const ratings = new Map(data.players.map((p) => [p.id, 600 + (clamp(p.level, 1, 5) - 1) * 200]))
  for (const row of getStandings(data)) ratings.set(row.playerId, row.rating)
  return ratings
}

function availableAt(
  session: Session,
  playerId: string,
  start: number,
  config: PlanningSettings,
  now: number,
) {
  const window = session.availability?.[playerId]
  const scheduledArrival = window?.from !== undefined && window.from > now
  if (!session.availablePlayerIds.includes(playerId) && !scheduledArrival) return false
  const from = window?.from ?? attendanceSummary(session, playerId, now).waitingSince
  return (
    start >= from &&
    (window?.until === undefined || start + config.matchMinutes * MINUTE <= window.until)
  )
}

function overlapping(
  a: Pick<PlannedMatch, 'startsAt'>,
  b: Pick<PlannedMatch, 'startsAt'>,
  minutes: number,
) {
  return a.startsAt < b.startsAt + minutes * MINUTE && b.startsAt < a.startsAt + minutes * MINUTE
}

function recordEncounter(history: History, a: string[], b: string[]) {
  if (a.length === 2) increment(history.partners, pairKey(a))
  if (b.length === 2) increment(history.partners, pairKey(b))
  for (const left of a) for (const right of b) increment(history.opponents, pairKey([left, right]))
  increment(history.encounters, matchupKey(a, b))
}

function createHistory(data: AppData, ratings: Map<string, number>): History {
  const history: History = {
    partners: new Map(),
    opponents: new Map(),
    encounters: new Map(),
    residuals: new Map(),
  }
  const sessions = new Map(data.sessions.map((s) => [s.id, s]))
  for (const match of data.matches) {
    if (match.status === 'abandoned') continue
    recordEncounter(history, match.teamA, match.teamB)
    const session = sessions.get(match.sessionId)
    if (match.status !== 'completed' || !session) continue
    const score = scoreMatch(match, session)
    if (!score.complete || !score.winner) continue
    const mean = (ids: string[]) =>
      ids.reduce((sum, id) => sum + (ratings.get(id) ?? 1000), 0) / ids.length
    const expected = 1 / (1 + 10 ** ((mean(match.teamB) - mean(match.teamA)) / 400))
    for (const [side, ids, probability] of [
      ['A', match.teamA, expected],
      ['B', match.teamB, 1 - expected],
    ] as const) {
      if (ids.length !== 2) continue
      const key = pairKey(ids)
      const row = history.residuals.get(key) ?? { count: 0, total: 0 }
      row.count += 1
      row.total += Number(score.winner === side) - probability
      history.residuals.set(key, row)
    }
  }
  return history
}

function contributionAdjustments(data: AppData): Map<string, number> {
  const rows = new Map<string, { count: number; sum: number }>()
  const sessions = new Map(data.sessions.map((s) => [s.id, s]))
  for (const match of data.matches) {
    const session = sessions.get(match.sessionId)
    if (match.status !== 'completed' || !session || session.format !== 'doubles') continue
    const score = scoreMatch(match, session)
    if (!score.complete || !score.totalPoints || score.attributedPoints / score.totalPoints < 0.6)
      continue
    for (const [team, side] of [
      [match.teamA, 'a'],
      [match.teamB, 'b'],
    ] as const) {
      const total = team.reduce((sum, id) => sum + (score.allCredits?.[id] ?? 0), 0)
      const sidePoints = score.games.reduce((sum, game) => sum + game[side], 0)
      if (!total || !sidePoints || total / sidePoints < 0.6) continue
      for (const id of team) {
        const row = rows.get(id) ?? { count: 0, sum: 0 }
        row.count++
        row.sum += (score.allCredits?.[id] ?? 0) / total - 1 / team.length
        rows.set(id, row)
      }
    }
  }
  return new Map(
    [...rows].map(([id, row]) => [id, row.count >= 3 ? (100 * row.sum) / (row.count + 6) : 0]),
  )
}

function combinations<T>(values: T[], count: number): T[][] {
  const results: T[][] = []
  const visit = (start: number, chosen: T[]) => {
    if (chosen.length === count) {
      results.push(chosen)
      return
    }
    for (let index = start; index <= values.length - count + chosen.length; index++)
      visit(index + 1, [...chosen, values[index]])
  }
  visit(0, [])
  return results
}

function historicallyAvailable(session: Session, id: string, at: number) {
  const personal = (session.attendance ?? [])
    .filter((e) => e.playerId === id)
    .slice()
    .sort((a, b) => a.at - b.at)
  const previous = personal.filter((e) => e.at <= at).at(-1)
  const window = session.availability?.[id]
  return (
    (previous ? previous.available : personal.length === 0) &&
    at >= (window?.from ?? session.startedAt) &&
    (window?.until === undefined || at < window.until)
  )
}

/** Integrate changing attendance instead of applying today's roster size to the entire past. */
export function courtOpportunityBefore(session: Session, now = Date.now()): Map<string, number> {
  const end = Math.max(session.startedAt, Math.min(now, session.endedAt ?? now))
  const boundaries = new Set([session.startedAt, end])
  for (const event of session.attendance ?? [])
    if (event.at > session.startedAt && event.at < end) boundaries.add(event.at)
  for (const window of Object.values(session.availability ?? {}))
    for (const at of [window.from, window.until])
      if (at !== undefined && at > session.startedAt && at < end) boundaries.add(at)
  const times = [...boundaries].sort((a, b) => a - b)
  const totals = new Map(session.playerIds.map((id) => [id, 0]))
  const capacity = session.courtCount * (session.format === 'doubles' ? 4 : 2)
  for (let i = 0; i < times.length - 1; i++) {
    const available = session.playerIds.filter((id) => historicallyAvailable(session, id, times[i]))
    const share = available.length ? Math.min(1, capacity / available.length) : 0
    const minutes = ((times[i + 1] - times[i]) / MINUTE) * share
    for (const id of available) totals.set(id, totals.get(id)! + minutes)
  }
  return totals
}

function partitions(players: string[], size: number): [string[], string[]][] {
  if (size === 1) return [[[players[0]], [players[1]]]]
  return [
    [
      [players[0], players[1]],
      [players[2], players[3]],
    ],
    [
      [players[0], players[2]],
      [players[1], players[3]],
    ],
    [
      [players[0], players[3]],
      [players[1], players[2]],
    ],
  ]
}

function actualSlots(data: AppData, session: Session, config: PlanningSettings): PlannedMatch[] {
  return data.matches
    .filter((m) => m.sessionId === session.id)
    .map((match) => {
      const existing = session.plan?.slots.find(
        (s) => s.matchId === match.id || s.id === match.planSlotId,
      )
      return {
        id: existing?.id ?? match.planSlotId ?? `actual-${match.id}`,
        court: match.court,
        round:
          existing?.round ??
          Math.max(
            1,
            Math.floor(
              (match.startedAt - session.startedAt) /
                ((config.matchMinutes + config.changeoverMinutes) * MINUTE),
            ) + 1,
          ),
        startsAt: existing?.startsAt ?? match.startedAt,
        teamA: [...match.teamA],
        teamB: [...match.teamB],
        locked: existing?.locked ?? true,
        matchId: match.id,
        reason: existing?.reason ?? 'Recorded match. Its lineup is preserved.',
      }
    })
}

function assertAssignments(data: AppData, session: Session, slots: PlannedMatch[], now: number) {
  const config = settings(session)
  const size = session.format === 'doubles' ? 2 : 1
  const known = new Set(data.players.map((p) => p.id))
  const active = data.matches.filter((m) => m.sessionId === session.id && m.status === 'playing')
  const seen = new Set<string>()
  for (const slot of slots) {
    if (seen.has(slot.id)) throw new Error('Each schedule slot must appear only once.')
    seen.add(slot.id)
    const ids = members(slot)
    if (
      slot.teamA.length !== size ||
      slot.teamB.length !== size ||
      new Set(ids).size !== size * 2 ||
      ids.some((id) => !known.has(id) || !session.playerIds.includes(id))
    )
      throw new Error('Use distinct session players and the correct team size in every match.')
    if (
      slot.court < 1 ||
      slot.court > session.courtCount ||
      !Number.isInteger(slot.court) ||
      !Number.isFinite(slot.startsAt)
    )
      throw new Error('The schedule contains an invalid court or time.')
    if (slot.matchId) continue
    if (ids.some((id) => !availableAt(session, id, slot.startsAt, config, now)))
      throw new Error(
        'A player is unavailable for one of the scheduled matches. Update availability or regenerate the plan.',
      )
    for (const match of active) {
      if (
        slot.startsAt < expectedEnd(match, config, now) &&
        (slot.court === match.court || members(match).some((id) => ids.includes(id)))
      )
        throw new Error('This assignment overlaps a match already in progress.')
    }
  }
  const future = slots.filter((s) => !s.matchId)
  for (let i = 0; i < future.length; i++)
    for (let j = i + 1; j < future.length; j++) {
      if (!overlapping(future[i], future[j], config.matchMinutes)) continue
      if (
        future[i].court === future[j].court ||
        members(future[i]).some((id) => members(future[j]).includes(id))
      )
        throw new Error('A player or court is assigned to overlapping matches.')
    }
}

/**
 * Bounded per-slot search: attendance-normalized court opportunity and rest
 * sequences are evaluated before pair balance, repeat opponents/partners, and
 * shrunk partnership evidence. No hypothetical result enters competitive stats.
 */
export function generatePlan(
  data: AppData,
  session: Session,
  options: { now?: number; preserve?: PlannedMatch[] } = {},
): SessionPlan {
  const now = Math.max(session.startedAt, options.now ?? Date.now())
  const config = settings(session)
  const step = (config.matchMinutes + config.changeoverMinutes) * MINUTE
  const durationEnd = session.startedAt + config.durationMinutes * MINUTE
  const size = session.format === 'doubles' ? 2 : 1
  const target =
    config.basis === 'duration'
      ? Math.min(
          MAX_MATCHES,
          Math.floor(
            (config.durationMinutes + config.changeoverMinutes) /
              (config.matchMinutes + config.changeoverMinutes),
          ) * session.courtCount,
        )
      : config.matchCount
  const actual = actualSlots(data, session, config)
  const actualIds = new Set(actual.map((s) => s.id))
  const explicit =
    options.preserve ?? session.plan?.slots.filter((s) => s.locked && !s.matchId) ?? []
  let fixed = explicit
    .filter((s) => !actualIds.has(s.id) && !s.matchId)
    .map((s) => ({ ...s, teamA: [...s.teamA], teamB: [...s.teamB] }))
  const warnings: string[] = []
  if (session.status === 'completed')
    return {
      revision: (session.plan?.revision ?? 0) + 1,
      generatedAt: now,
      slots: session.plan?.slots ?? actual,
      warnings: session.plan?.warnings ?? [],
    }

  // A locked pairing is retained, but an already-past estimate is moved forward
  // as a whole round. Explicit edits still reject hard-constraint conflicts.
  if (fixed.length) {
    const earliest = Math.min(...fixed.map((s) => s.startsAt))
    if (earliest < now) {
      const delta = now - earliest
      for (const slot of fixed) slot.startsAt += delta
    }
    if (options.preserve === undefined) {
      const retained: PlannedMatch[] = []
      const active = data.matches.filter(
        (m) => m.sessionId === session.id && m.status === 'playing',
      )
      for (const slot of fixed.sort((a, b) => a.startsAt - b.startsAt || a.court - b.court)) {
        let earliest = slot.startsAt
        // Pairing locks do not freeze an inaccurate estimated start time.
        for (const match of active)
          if (slot.court === match.court || members(slot).some((id) => members(match).includes(id)))
            earliest = Math.max(earliest, expectedEnd(match, config, now))
        for (let attempt = 0; attempt < MAX_MATCHES; attempt++) {
          const collision = retained.find(
            (other) =>
              overlapping({ startsAt: earliest }, other, config.matchMinutes) &&
              (slot.court === other.court ||
                members(slot).some((id) => members(other).includes(id))),
          )
          if (!collision) break
          earliest = collision.startsAt + step
        }
        const changed = { ...slot, startsAt: earliest }
        const outOfWindow = members(slot).some(
          (id) => !availableAt(session, id, earliest, config, now),
        )
        if (
          outOfWindow ||
          (config.basis === 'duration' && earliest + config.matchMinutes * MINUTE > durationEnd)
        ) {
          warnings.push(
            'A future pairing lock was released because its players or time window are no longer available. Recorded matches were preserved.',
          )
          continue
        }
        retained.push(changed)
      }
      fixed = retained
    }
    assertAssignments(data, session, fixed, now)
  }
  const slots: PlannedMatch[] = [...actual, ...fixed]
  const ids = session.playerIds.filter((id) => data.players.some((p) => p.id === id))
  const ratings = strengthRatings(data)
  const history = createHistory(data, ratings)
  const contribution = config.weights!.contribution
    ? contributionAdjustments(data)
    : new Map<string, number>()
  const weights = config.weights!
  const active = data.matches.filter((m) => m.sessionId === session.id && m.status === 'playing')
  const currentMatches = data.matches.filter((m) => m.sessionId === session.id)
  const pastOpportunity = courtOpportunityBefore(session, now)
  const load = new Map<string, PlayerLoad>(
    ids.map((id) => {
      const prior = currentMatches.filter((m) => members(m).includes(id))
      const minutes = prior.reduce(
        (sum, m) => sum + Math.max(0, (expectedEnd(m, config, now) - m.startedAt) / MINUTE),
        0,
      )
      return [
        id,
        {
          minutes,
          opportunity: pastOpportunity.get(id) ?? 0,
          matches: prior.length,
          plays: 0,
          rests: 0,
          lastRound: -1,
        },
      ]
    }),
  )
  // Seed sequence penalties from real attendance and actual match order. Equal
  // total minutes must not erase that someone played the last two matches.
  for (const pastRound of [...new Set(actual.map((s) => s.round))].sort((a, b) => a - b)) {
    const roundMatches = actual.filter((s) => s.round === pastRound)
    const roundAt = Math.min(
      ...roundMatches.map(
        (s) => data.matches.find((m) => m.id === s.matchId)?.startedAt ?? s.startsAt,
      ),
    )
    for (const id of ids) {
      const state = load.get(id)!
      const startsHere = roundMatches.some((s) => members(s).includes(id))
      const continuesHere = currentMatches.some(
        (m) =>
          members(m).includes(id) && m.startedAt < roundAt && expectedEnd(m, config, now) > roundAt,
      )
      if (startsHere) {
        state.plays++
        state.rests = 0
      } else if (continuesHere) {
        state.plays = Math.max(1, state.plays)
        state.rests = 0
      } else if (historicallyAvailable(session, id, roundAt)) {
        state.rests++
        state.plays = 0
      } else {
        state.rests = 0
        state.plays = 0
      }
      state.lastRound = pastRound
    }
  }
  const base = Math.max(now, session.startedAt)
  let round = Math.max(1, ...actual.map((s) => s.round + 1))
  let generated = 0
  let attempts = 0
  const goal = Math.max(target, slots.length)
  // Search is bounded even if all players leave or no court can fit a match.
  while (slots.length < goal && attempts < MAX_MATCHES * 3) {
    const start = base + attempts * step
    attempts++
    if (config.basis === 'duration' && start + config.matchMinutes * MINUTE > durationEnd) break
    const eligible = ids.filter((id) => availableAt(session, id, start, config, now))
    const already = slots.filter(
      (s) => !s.matchId && overlapping(s, { startsAt: start }, config.matchMinutes),
    )
    const unavailable = new Set(already.flatMap(members))
    const occupiedCourts = new Set(already.map((s) => s.court))
    for (const match of active)
      if (start < expectedEnd(match, config, now)) {
        occupiedCourts.add(match.court)
        members(match).forEach((id) => unavailable.add(id))
      }
    const capacity =
      Math.floor(
        Math.max(
          0,
          Math.min(
            (session.courtCount - occupiedCourts.size) * size * 2,
            Math.max(0, goal - slots.length) * size * 2,
            eligible.filter((id) => !unavailable.has(id)).length,
          ),
        ) /
          (size * 2),
      ) *
      size *
      2
    const projectedShare = eligible.length
      ? Math.min(1, (capacity + already.length * size * 2) / eligible.length)
      : 0
    for (const id of eligible) load.get(id)!.opportunity += config.matchMinutes * projectedShare
    const selectedThisRound = new Set(already.flatMap(members))
    const continuingPlayers = new Set(
      active.filter((m) => start < expectedEnd(m, config, now)).flatMap(members),
    )
    for (const id of continuingPlayers) selectedThisRound.add(id)
    for (const fixedSlot of already) {
      // Fixed future encounters are accounted once when their start is visited.
      if (fixedSlot.startsAt >= start && fixedSlot.startsAt < start + step) {
        recordEncounter(history, fixedSlot.teamA, fixedSlot.teamB)
        for (const id of members(fixedSlot)) {
          load.get(id)!.minutes += config.matchMinutes
          load.get(id)!.matches++
        }
      }
    }
    const selectionCost = (id: string) => {
      const state = load.get(id)!
      const deficit = (state.minutes - state.opportunity) / config.matchMinutes
      const restCost = state.plays ** 2 * 0.7 - state.rests ** 2 * 0.85
      return deficit * weights.fairness + restCost * weights.rest
    }
    for (let court = 1; court <= session.courtCount && slots.length < goal; court++) {
      if (occupiedCourts.has(court)) continue
      const available = eligible.filter((id) => !unavailable.has(id))
      if (available.length < size * 2) continue
      const pool = available
        .slice()
        .sort((a, b) => selectionCost(a) - selectionCost(b) || ids.indexOf(a) - ids.indexOf(b))
        .slice(0, Math.max(size * 2, 8))
      let best: { a: string[]; b: string[]; cost: number } | undefined
      const preferred = session.plan?.slots.find(
        (s) =>
          !s.matchId &&
          !fixed.some((f) => f.id === s.id) &&
          s.court === court &&
          Math.abs(s.startsAt - start) < step / 2,
      )
      for (const group of combinations(pool, size * 2))
        for (const [a, b] of partitions(group, size)) {
          const mean = (team: string[]) =>
            team.reduce(
              (sum, id) =>
                sum +
                (ratings.get(id) ?? 1000) +
                ((contribution.get(id) ?? 0) * weights.contribution) / 10,
              0,
            ) / team.length
          const residual = (team: string[]) => {
            const row = history.residuals.get(pairKey(team))
            return row ? (row.total / (row.count + 6)) * 120 : 0
          }
          const gap = Math.abs(mean(a) - mean(b)) / 400
          const partnerGap = Math.abs(mean(a) + residual(a) - mean(b) - residual(b)) / 400
          const repeats =
            (history.partners.get(pairKey(a)) ?? 0) + (history.partners.get(pairKey(b)) ?? 0)
          const opponents =
            a.reduce(
              (sum, left) =>
                sum +
                b.reduce((n, right) => n + (history.opponents.get(pairKey([left, right])) ?? 0), 0),
              0,
            ) /
            (size * size)
          const encounter = history.encounters.get(matchupKey(a, b)) ?? 0
          const stable =
            preferred && matchupKey(preferred.teamA, preferred.teamB) === matchupKey(a, b)
              ? -0.8
              : 0
          const cost =
            group.reduce((sum, id) => sum + selectionCost(id), 0) +
            gap * weights.balance +
            partnerGap * weights.partnership +
            (repeats * 0.7 + opponents * 0.25 + encounter * 1.5) * weights.variety +
            stable
          if (!best || cost < best.cost - 1e-8) best = { a, b, cost }
        }
      if (!best) continue
      const reused = preferred && !slots.some((s) => s.id === preferred.id) ? preferred : undefined
      const slot: PlannedMatch = {
        id: reused?.id ?? `plan-${session.id}-${session.plan?.revision ?? 0}-${round}-${court}`,
        court,
        round,
        startsAt: start,
        teamA: [...best.a],
        teamB: [...best.b],
        locked: false,
        reason:
          session.mode === 'fair'
            ? 'Court opportunity and even rest intervals first; repeated partners and opponents are secondary.'
            : session.mode === 'variety'
              ? 'Fair turns with more partner and opponent variety; strength remains a secondary check.'
              : 'Balances attendance-adjusted court time, rest intervals, estimated strength, and partnership history.',
      }
      slots.push(slot)
      recordEncounter(history, best.a, best.b)
      for (const id of members(slot)) {
        unavailable.add(id)
        selectedThisRound.add(id)
        load.get(id)!.minutes += config.matchMinutes
        load.get(id)!.matches++
      }
      generated++
    }
    for (const id of eligible) {
      const state = load.get(id)!
      if (selectedThisRound.has(id)) {
        state.plays = continuingPlayers.has(id)
          ? Math.max(1, state.plays)
          : state.lastRound === round - 1
            ? state.plays + 1
            : 1
        state.rests = 0
      } else {
        state.rests = state.lastRound === round - 1 ? state.rests + 1 : 1
        state.plays = 0
      }
      state.lastRound = round
    }
    round++
    if (
      !generated &&
      config.basis === 'matches' &&
      !ids.some((id) => (session.availability?.[id]?.from ?? 0) > start) &&
      !active.length
    )
      break
  }
  if (!target)
    warnings.push(
      'No complete match fits this time budget. Increase session duration or shorten the match estimate.',
    )
  if (slots.length < target)
    warnings.push(
      `Only ${slots.length} of ${target} estimated matches fit the current availability and court constraints.`,
    )
  if (ids.length < session.courtCount * size * 2)
    warnings.push(
      'There are not enough available players to use every court at once; some courts may rest.',
    )
  if (config.basis === 'duration')
    warnings.push(
      'Times are estimates, including changeovers. Longer matches can reduce how many games fit.',
    )
  if (weights.contribution)
    warnings.push(
      'Credited points are subjective. Contribution adjustments require at least three sufficiently attributed matches and remain small.',
    )
  if (Math.max(...Object.values(weights)) === 0)
    warnings.push(
      'All preference weights are zero. Hard constraints still apply, but fairness and balance are not optimized.',
    )
  const ordered = slots.sort(
    (a, b) => a.startsAt - b.startsAt || a.court - b.court || a.id.localeCompare(b.id),
  )
  const result: SessionPlan = {
    revision: (session.plan?.revision ?? 0) + 1,
    generatedAt: now,
    slots: ordered,
    warnings,
  }
  const totals = planSummary(data, { ...session, plan: result })
  const comparable = totals.filter(
    (row) =>
      session.availablePlayerIds.includes(row.playerId) && !session.availability?.[row.playerId],
  )
  if (
    comparable.length > 1 &&
    Math.max(...comparable.map((r) => r.plannedMatches)) -
      Math.min(...comparable.map((r) => r.plannedMatches)) >
      1
  )
    warnings.push(
      'Some players have different projected match counts. Availability, locks, and competitive preferences can prevent equal turns.',
    )
  return result
}

export function replanSession(data: AppData, session: Session, now = Date.now()): Session {
  return { ...session, plan: generatePlan(data, session, { now }) }
}

export function editPlanSlot(
  data: AppData,
  session: Session,
  slotId: string,
  teamA: string[],
  teamB: string[],
  now = Date.now(),
): Session {
  if (!session.plan) throw new Error('Generate a session schedule first.')
  const target = session.plan.slots.find((s) => s.id === slotId)
  if (!target || target.matchId) throw new Error('Only an unplayed match can be edited.')
  const edited = {
    ...target,
    teamA: [...teamA],
    teamB: [...teamB],
    locked: true,
    reason: 'Organizer-selected lineup. Future assignments were repaired around this match.',
  }
  const equivalent = session.plan.slots.find(
    (s) =>
      s.id !== slotId &&
      !s.matchId &&
      !s.locked &&
      matchupKey(s.teamA, s.teamB) === matchupKey(teamA, teamB),
  )
  const fixed = session.plan.slots.filter((s) => s.id !== slotId && !s.matchId && s.locked)
  fixed.push(edited)
  if (equivalent)
    fixed.push({
      ...equivalent,
      teamA: [...target.teamA],
      teamB: [...target.teamB],
      reason: 'Moved here to avoid duplicating the organizer’s edited matchup.',
    })
  const temporary = {
    ...session,
    plan: { ...session.plan, slots: session.plan.slots.map((s) => (s.id === slotId ? edited : s)) },
  }
  try {
    return { ...session, plan: generatePlan(data, temporary, { now, preserve: fixed }) }
  } catch (error) {
    // A reciprocal swap may conflict with another court. Keep the explicit edit
    // and regenerate the counterpart instead of failing a valid organizer edit.
    if (!equivalent) throw error
    return {
      ...session,
      plan: generatePlan(data, temporary, {
        now,
        preserve: fixed.filter((s) => s.id !== equivalent.id),
      }),
    }
  }
}

export function planSummary(
  data: AppData,
  session: Session,
): {
  playerId: string
  name: string
  plannedMatches: number
  playedMatches: number
  projectedMinutes: number
  restRounds: number
  maxConsecutivePlays: number
  maxConsecutiveRests: number
}[] {
  const config = settings(session)
  const slots = session.plan?.slots ?? []
  const rounds = [...new Set(slots.map((s) => s.round))].sort((a, b) => a - b)
  const current = data.matches.filter((m) => m.sessionId === session.id)
  return session.playerIds.map((playerId) => {
    const own = slots.filter((s) => members(s).includes(playerId))
    let maxConsecutivePlays = 0
    let maxConsecutiveRests = 0
    let plays = 0
    let rests = 0
    let restRounds = 0
    for (const round of rounds) {
      const roundSlots = slots.filter((s) => s.round === round)
      const start = Math.min(...roundSlots.map((s) => s.startsAt))
      const assigned =
        own.some((s) => s.round === round) ||
        current.some(
          (m) =>
            members(m).includes(playerId) &&
            m.startedAt < start &&
            expectedEnd(m, config, session.plan?.generatedAt ?? Date.now()) > start,
        )
      const window = session.availability?.[playerId]
      const available =
        assigned ||
        (session.availablePlayerIds.includes(playerId) &&
          start >= (window?.from ?? session.startedAt) &&
          (window?.until === undefined || start + config.matchMinutes * MINUTE <= window.until))
      if (!available) {
        plays = 0
        rests = 0
        continue
      }
      if (assigned) {
        plays++
        rests = 0
        maxConsecutivePlays = Math.max(maxConsecutivePlays, plays)
      } else {
        rests++
        plays = 0
        restRounds++
        maxConsecutiveRests = Math.max(maxConsecutiveRests, rests)
      }
    }
    const actual = current.filter((m) => members(m).includes(playerId))
    const actualMinutes = actual.reduce(
      (sum, m) => sum + Math.max(0, ((m.endedAt ?? Date.now()) - m.startedAt) / MINUTE),
      0,
    )
    return {
      playerId,
      name: data.players.find((p) => p.id === playerId)?.name ?? 'Unknown player',
      plannedMatches: own.length,
      playedMatches: actual.length,
      projectedMinutes:
        Math.round(
          (actualMinutes + own.filter((s) => !s.matchId).length * config.matchMinutes) * 10,
        ) / 10,
      restRounds,
      maxConsecutivePlays,
      maxConsecutiveRests,
    }
  })
}

export function validatePlanAssignments(
  data: AppData,
  session: Session,
  input: unknown,
): SessionPlan {
  if (!session.plan) throw new Error('Generate a session schedule before importing a pairing plan.')
  if (!input || typeof input !== 'object') throw new Error('Upload a JSON pairing-plan object.')
  const value = input as Record<string, unknown>
  if (
    value.schemaVersion !== 1 ||
    value.sessionId !== session.id ||
    value.planRevision !== session.plan.revision
  )
    throw new Error(
      'This pairing file belongs to another session or an older plan revision. Export fresh context and try again.',
    )
  if (!Array.isArray(value.assignments) || value.assignments.length > MAX_MATCHES)
    throw new Error('The assignments field must be a list of schedule slots.')
  const future = session.plan.slots.filter((s) => !s.matchId)
  if (value.assignments.length !== future.length)
    throw new Error(
      'Include every unplayed slot exactly once. Played matches must not be included.',
    )
  const assignments = new Map<string, Assignment>()
  for (const raw of value.assignments) {
    if (
      !raw ||
      typeof raw !== 'object' ||
      typeof raw.slotId !== 'string' ||
      !Array.isArray(raw.teamA) ||
      !Array.isArray(raw.teamB) ||
      [...raw.teamA, ...raw.teamB].some((id) => typeof id !== 'string')
    )
      throw new Error('Each assignment needs slotId, teamA, and teamB player-ID arrays.')
    if (assignments.has(raw.slotId) || !future.some((s) => s.id === raw.slotId))
      throw new Error('The file contains a duplicate, unknown, or already-played slot.')
    assignments.set(raw.slotId, raw as Assignment)
  }
  const slots = session.plan.slots.map((slot) => {
    if (slot.matchId) return slot
    const assignment = assignments.get(slot.id)!
    if (
      slot.locked &&
      matchupKey(slot.teamA, slot.teamB) !== matchupKey(assignment.teamA, assignment.teamB)
    )
      throw new Error(
        'The imported plan changes a locked match. Keep locked assignments unchanged.',
      )
    return {
      ...slot,
      teamA: [...assignment.teamA],
      teamB: [...assignment.teamB],
      reason:
        'Imported pairing. Hard constraints checked; review the participation summary before applying.',
    }
  })
  assertAssignments(data, session, slots, Date.now())
  return {
    ...session.plan,
    revision: session.plan.revision + 1,
    generatedAt: Date.now(),
    slots,
    warnings: [
      ...session.plan.warnings,
      'Imported pairings are not guaranteed fair. Review playing and resting distribution before applying.',
    ],
  }
}

export function buildPlanContext(data: AppData, session: Session) {
  if (!session.plan) throw new Error('Generate a session schedule first.')
  const history = createHistory(data, strengthRatings(data))
  const contributions = contributionAdjustments(data)
  return {
    schemaVersion: 1,
    sessionId: session.id,
    planRevision: session.plan.revision,
    instructions:
      'Return JSON only. Fill every unplayed slot once, preserve locked matchups, use the supplied IDs, obey availability and simultaneous-court exclusions. Do not invent results or change time/court slots.',
    format: session.format,
    mode: session.mode,
    settings: settings(session),
    players: session.playerIds.map((id) => ({
      id,
      name: data.players.find((p) => p.id === id)?.name,
      available: session.availablePlayerIds.includes(id),
      availability: session.availability?.[id] ?? null,
      stats: playerStats(data, id),
      contribution: contributions.get(id) ?? null,
    })),
    partnershipHistory: [...history.partners].map(([ids, together]) => ({
      playerIds: ids.split('|'),
      together,
      residual: history.residuals.get(ids) ?? { count: 0, total: 0 },
    })),
    opponentHistory: [...history.opponents].map(([ids, against]) => ({
      playerIds: ids.split('|'),
      against,
    })),
    participation: planSummary(data, session),
    fixedMatches: session.plan.slots.filter((s) => s.matchId),
    slots: session.plan.slots
      .filter((s) => !s.matchId)
      .map((s) => ({
        slotId: s.id,
        court: s.court,
        round: s.round,
        startsAt: s.startsAt,
        locked: s.locked,
        teamA: s.teamA,
        teamB: s.teamB,
      })),
    expectedOutput: {
      schemaVersion: 1,
      sessionId: session.id,
      planRevision: session.plan.revision,
      assignments: session.plan.slots
        .filter((s) => !s.matchId)
        .map((s) => ({ slotId: s.id, teamA: s.teamA, teamB: s.teamB })),
    },
  }
}

export function buildPlanPrompt(data: AppData, session: Session): string {
  return `Plan the remaining badminton matches using the attached RallySync context JSON. Prioritize attendance-adjusted playing time and evenly spaced rests, then use the selected mode's weights for strength, partner/opponent variety, and conservative partnership evidence. Do not treat credited points as objective individual ability. Use stable player IDs exactly. Preserve all locked matchups and exclude unavailable players. Keep each court/time slot unchanged and never double-book a player. Return only the expectedOutput JSON structure, with every unplayed slot exactly once; no markdown or commentary. The app validates the result before applying it.\n\n${JSON.stringify(buildPlanContext(data, session), null, 2)}`
}
