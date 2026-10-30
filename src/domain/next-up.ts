import type { AppData, Match, PlannedMatch, Session } from './model'

const MINUTE = 60_000
const members = (match: Pick<Match, 'teamA' | 'teamB'>) => [...match.teamA, ...match.teamB]

export type NextUp = {
  attendance: 'available' | 'break' | 'not-arrived' | 'left'
  current?: Match
  next?: {
    slot: PlannedMatch
    /** Projection includes current court/player occupancy and earlier unplayed fixtures. */
    estimatedAt: number
    /** A live match makes its finish uncertain, even if its estimated end has passed. */
    waitingForLive: boolean
    teammates: string[]
    opponents: string[]
  }
}

function attendance(session: Session, id: string, now: number): NextUp['attendance'] {
  const window = session.availability?.[id]
  if (window?.until !== undefined && window.until <= now) return 'left'
  if (window?.from !== undefined && window.from > now) return 'not-arrived'
  return session.availablePlayerIds.includes(id) ? 'available' : 'break'
}

function fits(session: Session, id: string, start: number, duration: number, now: number) {
  if (!session.playerIds.includes(id)) return false
  const window = session.availability?.[id]
  if (window?.from !== undefined && start < window.from) return false
  if (window?.until !== undefined && start + duration > window.until) return false
  // A declared future arrival is not the same as a player currently taking a break.
  return (
    session.availablePlayerIds.includes(id) ||
    (window?.from !== undefined && window.from > now && start >= window.from)
  )
}

/** Read-only, attendance-aware next fixture projection; never starts or replans a match. */
export function playerNextUp(
  data: AppData,
  session: Session,
  playerId: string,
  now = Date.now(),
): NextUp {
  const result: NextUp = { attendance: attendance(session, playerId, now) }
  if (session.status !== 'active' || !session.playerIds.includes(playerId)) return result
  const actual = data.matches.filter((match) => match.sessionId === session.id)
  const live = actual.filter((match) => match.status === 'playing')
  result.current = live.find((match) => members(match).includes(playerId))
  if (result.attendance === 'left' || result.attendance === 'break') return result

  const duration = (session.planning?.matchMinutes ?? (session.bestOf === 3 ? 30 : 12)) * MINUTE
  const changeover = (session.planning?.changeoverMinutes ?? 2) * MINUTE
  const courtReady = new Map<number, number>()
  const playerReady = new Map<string, number>()
  const uncertainCourts = new Set<number>()
  const uncertainPlayers = new Set<string>()
  for (const match of live) {
    // An overdue live game remains occupied; avoid claiming its court is free.
    const ready = Math.max(now, match.startedAt + duration) + changeover
    courtReady.set(match.court, Math.max(courtReady.get(match.court) ?? now, ready))
    uncertainCourts.add(match.court)
    for (const id of members(match)) {
      playerReady.set(id, Math.max(playerReady.get(id) ?? now, ready))
      uncertainPlayers.add(id)
    }
  }
  const slots = [...(session.plan?.slots ?? [])].sort(
    (a, b) => a.startsAt - b.startsAt || a.round - b.round || a.court - b.court,
  )
  for (const slot of slots) {
    // A stopped match consumes its slot too. Do not offer it again as a future assignment.
    if (actual.some((match) => match.id === slot.matchId || match.planSlotId === slot.id)) continue
    const ids = members(slot)
    const estimatedAt = Math.max(
      now,
      slot.startsAt,
      courtReady.get(slot.court) ?? now,
      ...ids.map((id) => playerReady.get(id) ?? now),
    )
    if (!ids.every((id) => fits(session, id, estimatedAt, duration, now))) continue
    const waitingForLive =
      uncertainCourts.has(slot.court) || ids.some((id) => uncertainPlayers.has(id))
    if (ids.includes(playerId)) {
      const own = slot.teamA.includes(playerId) ? slot.teamA : slot.teamB
      result.next = {
        slot,
        estimatedAt,
        waitingForLive,
        teammates: own.filter((id) => id !== playerId),
        opponents: slot.teamA.includes(playerId) ? slot.teamB : slot.teamA,
      }
      break
    }
    courtReady.set(slot.court, estimatedAt + duration + changeover)
    if (waitingForLive) uncertainCourts.add(slot.court)
    for (const id of ids) {
      playerReady.set(id, estimatedAt + duration + changeover)
      if (waitingForLive) uncertainPlayers.add(id)
    }
  }
  return result
}
