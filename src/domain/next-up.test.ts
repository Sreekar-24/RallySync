import { describe, expect, it } from 'vitest'
import type { AppData, Match, PlannedMatch, Session } from './model'
import { playerNextUp } from './next-up'

const now = 1_800_000_000_000
const minute = 60_000
function fixture() {
  const players = Array.from({ length: 8 }, (_, index) => ({
    id: `p${index}`,
    name: `Player ${index}`,
    level: 3,
    createdAt: now,
  }))
  const session: Session = {
    id: 's',
    name: 'Evening',
    startedAt: now - 20 * minute,
    format: 'doubles',
    courtCount: 2,
    target: 21,
    winBy: 2,
    cap: 30,
    bestOf: 1,
    mode: 'balanced',
    status: 'active',
    playerIds: players.map((player) => player.id),
    availablePlayerIds: players.map((player) => player.id),
    planning: {
      basis: 'matches',
      matchCount: 4,
      durationMinutes: 60,
      matchMinutes: 12,
      changeoverMinutes: 2,
    },
    plan: { revision: 1, generatedAt: now, warnings: [], slots: [] },
  }
  const data: AppData = { version: 2, players, sessions: [session], matches: [] }
  return { data, session }
}
function slot(overrides: Partial<PlannedMatch> = {}): PlannedMatch {
  return {
    id: 'next',
    round: 1,
    court: 1,
    startsAt: now + 5 * minute,
    teamA: ['p0', 'p1'],
    teamB: ['p2', 'p3'],
    locked: false,
    reason: 'Balanced',
    ...overrides,
  }
}
function live(overrides: Partial<Match> = {}): Match {
  return {
    id: 'current',
    sessionId: 's',
    court: 1,
    startedAt: now - 20 * minute,
    status: 'playing',
    teamA: ['p4', 'p5'],
    teamB: ['p6', 'p7'],
    actions: [],
    revision: 0,
    ...overrides,
  }
}

describe('personal next match', () => {
  it('returns a personal next lineup with side-correct teammates and opponents', () => {
    const { data, session } = fixture()
    session.plan!.slots = [slot()]
    const before = structuredClone(data)
    const result = playerNextUp(data, session, 'p2', now)
    expect(result.attendance).toBe('available')
    expect(result.current).toBeUndefined()
    expect(result.next).toMatchObject({
      estimatedAt: now + 5 * minute,
      waitingForLive: false,
      teammates: ['p3'],
      opponents: ['p0', 'p1'],
    })
    expect(data).toEqual(before)
  })

  it('keeps overdue live courts occupied and labels the uncertain start', () => {
    const { data, session } = fixture()
    data.matches = [live()]
    session.plan!.slots = [slot({ startsAt: now - minute })]
    const result = playerNextUp(data, session, 'p0', now)
    expect(result.next?.waitingForLive).toBe(true)
    expect(result.next?.estimatedAt).toBe(now + 2 * minute)
  })

  it('identifies current play and carries player occupancy across courts', () => {
    const { data, session } = fixture()
    data.matches = [live({ teamA: ['p0', 'p1'], teamB: ['p4', 'p5'] })]
    session.plan!.slots = [slot({ court: 2, startsAt: now })]
    const result = playerNextUp(data, session, 'p0', now)
    expect(result.current?.id).toBe('current')
    expect(result.next?.waitingForLive).toBe(true)
    expect(result.next?.estimatedAt).toBe(now + 2 * minute)
  })

  it('does not offer completed, stopped, or current linked fixtures again', () => {
    const { data, session } = fixture()
    session.plan!.slots = [
      slot({ id: 'done', matchId: 'done-match' }),
      slot({ id: 'stopped' }),
      slot({ id: 'playing' }),
      slot({ id: 'remaining', startsAt: now + 30 * minute }),
    ]
    data.matches = [
      live({ id: 'done-match', status: 'completed' }),
      live({ id: 'stopped-match', planSlotId: 'stopped', status: 'abandoned' }),
      live({ id: 'live-match', planSlotId: 'playing' }),
    ]
    expect(playerNextUp(data, session, 'p0', now).next?.slot.id).toBe('remaining')
  })

  it('excludes a player on a break and fixtures containing unavailable partners', () => {
    const { data, session } = fixture()
    session.availablePlayerIds = session.availablePlayerIds.filter((id) => id !== 'p1')
    session.plan!.slots = [slot()]
    expect(playerNextUp(data, session, 'p1', now)).toMatchObject({ attendance: 'break' })
    expect(playerNextUp(data, session, 'p1', now).next).toBeUndefined()
    expect(playerNextUp(data, session, 'p0', now).next).toBeUndefined()
  })

  it('permits a declared future arrival but rejects a match running past departure', () => {
    const { data, session } = fixture()
    session.availablePlayerIds = session.availablePlayerIds.filter((id) => id !== 'p0')
    session.availability = { p0: { from: now + 10 * minute } }
    session.plan!.slots = [slot(), slot({ id: 'later', startsAt: now + 12 * minute })]
    expect(playerNextUp(data, session, 'p0', now).attendance).toBe('not-arrived')
    expect(playerNextUp(data, session, 'p0', now).next?.slot.id).toBe('later')
    session.availability.p0.until = now + 20 * minute
    expect(playerNextUp(data, session, 'p0', now).next).toBeUndefined()
    expect(playerNextUp(data, session, 'p0', now + 21 * minute).attendance).toBe('left')
  })

  it('projects earlier unplayed fixtures before the selected player’s turn', () => {
    const { data, session } = fixture()
    data.matches = [live()]
    session.plan!.slots = [
      slot({ id: 'other', teamA: ['p4', 'p5'], teamB: ['p6', 'p7'], startsAt: now }),
      slot({ id: 'mine', startsAt: now + minute }),
    ]
    const result = playerNextUp(data, session, 'p0', now)
    expect(result.next?.estimatedAt).toBe(now + 16 * minute)
    expect(result.next?.waitingForLive).toBe(true)
  })

  it('returns no next match for a finished session, missing plan, or unknown member', () => {
    const { data, session } = fixture()
    session.plan!.slots = [slot()]
    expect(playerNextUp(data, session, 'stranger', now).next).toBeUndefined()
    session.status = 'completed'
    expect(playerNextUp(data, session, 'p0', now).next).toBeUndefined()
    session.status = 'active'
    session.plan = undefined
    expect(playerNextUp(data, session, 'p0', now).next).toBeUndefined()
  })
})
