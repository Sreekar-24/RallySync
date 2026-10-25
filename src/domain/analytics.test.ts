import { describe, expect, it } from 'vitest'
import { filterAnalyticsMatches, getAnalytics } from './analytics'
import type { AppData, Match, Session, Side } from './model'

const start = 1_700_000_000_000
const session = (id = 'doubles', overrides: Partial<Session> = {}): Session => ({
  id,
  name: id,
  startedAt: start,
  endedAt: start + 30 * 60000,
  status: 'completed',
  format: 'doubles',
  courtCount: 1,
  target: 3,
  winBy: 2,
  cap: 5,
  bestOf: 1,
  mode: 'balanced',
  playerIds: ['a', 'b', 'c', 'd'],
  availablePlayerIds: ['a', 'b', 'c', 'd'],
  ...overrides,
})
function match(id: string, a = 3, b = 1, overrides: Partial<Match> = {}): Match {
  const winner: Side = a > b ? 'A' : 'B'
  const loser: Side = winner === 'A' ? 'B' : 'A'
  const low = Math.min(a, b)
  const high = Math.max(a, b)
  const actions: Match['actions'] = []
  for (let i = 0; i < low; i++)
    actions.push({ id: `${id}-l-${i}`, kind: 'point', side: loser, at: start + i * 1000 })
  for (let i = 0; i < high; i++)
    actions.push({ id: `${id}-w-${i}`, kind: 'point', side: winner, at: start + 5000 + i * 1000 })
  return {
    id,
    sessionId: 'doubles',
    court: 1,
    teamA: ['a', 'b'],
    teamB: ['c', 'd'],
    startedAt: start,
    endedAt: start + 5 * 60000,
    status: 'completed',
    revision: 1,
    actions,
    ...overrides,
  }
}
function fixture(matches: Match[] = [match('m1')], sessions: Session[] = [session()]): AppData {
  return {
    version: 2,
    players: ['a', 'b', 'c', 'd', 'e'].map((id) => ({
      id,
      name: id.toUpperCase(),
      level: 3,
      createdAt: start,
    })),
    sessions,
    matches,
  }
}

describe('scoped analytics', () => {
  it('counts only accepted legal results, while retaining active and stopped matches in reports', () => {
    const data = fixture([
      match('accepted'),
      match('active', 3, 1, { status: 'playing' }),
      match('stopped', 3, 1, { status: 'abandoned' }),
      match('invalid', 1, 0),
    ])
    const result = getAnalytics(data, {}, start + 30 * 60000)
    expect(result.matches).toHaveLength(4)
    expect(result.acceptedMatches.map((m) => m.id)).toEqual(['accepted'])
    expect(result.summary).toMatchObject({
      completedMatches: 1,
      stoppedMatches: 1,
      activeMatches: 1,
    })
    expect(result.players.find((p) => p.playerId === 'a')).toMatchObject({
      played: 1,
      wins: 1,
      pointsFor: 3,
      pointsAgainst: 1,
    })
  })

  it('filters format, session, and half-open completion time boundaries consistently', () => {
    const singles = session('singles', {
      format: 'singles',
      playerIds: ['a', 'c'],
      availablePlayerIds: ['a', 'c'],
    })
    const data = fixture(
      [
        match('early', 3, 1, { endedAt: start + 1000 }),
        match('late', 3, 1, { endedAt: start + 2000 }),
        match('single', 3, 1, {
          sessionId: 'singles',
          teamA: ['a'],
          teamB: ['c'],
          endedAt: start + 1500,
        }),
      ],
      [session(), singles],
    )
    expect(filterAnalyticsMatches(data, { format: 'singles' }).map((m) => m.id)).toEqual(['single'])
    expect(
      filterAnalyticsMatches(data, {
        sessionId: 'doubles',
        from: start + 1000,
        to: start + 2000,
      }).map((m) => m.id),
    ).toEqual(['early'])
    expect(getAnalytics(data, { format: 'singles' }).players).toHaveLength(2)
  })

  it('selected players scope matches by involvement and preserve contextual relationship counterparts', () => {
    const data = fixture(
      [match('m1'), match('m2', 3, 1, { teamA: ['b', 'e'], teamB: ['c', 'd'] })],
      [
        session('doubles', {
          playerIds: ['a', 'b', 'c', 'd', 'e'],
          availablePlayerIds: ['a', 'b', 'c', 'd', 'e'],
        }),
      ],
    )
    const result = getAnalytics(data, { playerIds: ['a'] })
    expect(result.matches.map((m) => m.id)).toEqual(['m1'])
    expect(result.players.map((p) => p.playerId)).toEqual(['a'])
    expect(result.partnerships.map((p) => p.playerIds)).toEqual([['a', 'b']])
    expect(result.opponents.map((p) => p.playerIds)).toEqual([
      ['a', 'c'],
      ['a', 'd'],
    ])
  })

  it('keeps team-result points separate from unknown individual attribution', () => {
    const result = getAnalytics(fixture())
    expect(result.players.find((p) => p.playerId === 'a')?.creditedPoints).toBeNull()
    expect(result.players.find((p) => p.playerId === 'a')?.pointsFor).toBe(3)
    expect(result.summary.attributionCoverage).toBe(0)
  })

  it('computes credited-point coverage without assigning a partner’s points to the player', () => {
    const credited = match('credit')
    credited.actions = credited.actions.map((action) => ({
      ...action,
      playerId: action.side === 'A' ? 'a' : 'c',
    }))
    const result = getAnalytics(fixture([credited]))
    expect(result.players.find((p) => p.playerId === 'a')).toMatchObject({
      creditedPoints: 3,
      attributionCoverage: 1,
    })
    expect(result.players.find((p) => p.playerId === 'b')).toMatchObject({
      creditedPoints: 0,
      attributionCoverage: 1,
    })
    expect(result.summary.attributionCoverage).toBe(1)
  })

  it('distinguishes partnerships from opposing-side encounters', () => {
    const result = getAnalytics(fixture())
    expect(result.partnerships).toHaveLength(2)
    expect(result.opponents).toHaveLength(4)
    expect(result.partnerships.find((p) => p.playerIds.join() === 'a,b')).toMatchObject({
      played: 1,
      wins: 1,
      losses: 0,
    })
    expect(result.opponents.find((p) => p.playerIds.join() === 'a,c')).toMatchObject({
      played: 1,
      winsA: 1,
      winsB: 0,
      pointsA: 3,
      pointsB: 1,
    })
    expect(result.opponents.some((p) => p.playerIds.join() === 'a,b')).toBe(false)
  })

  it('uses pre-match opposition expectation and shrinks small partnership samples', () => {
    const strongWins = fixture()
    strongWins.players = strongWins.players.map((p) => ({
      ...p,
      level: ['a', 'b'].includes(p.id) ? 5 : 1,
    }))
    const expectedWin = getAnalytics(strongWins).partnerships.find(
      (p) => p.playerIds.join() === 'a,b',
    )!
    const upset = getAnalytics({
      ...strongWins,
      matches: [match('upset', 1, 3)],
    }).partnerships.find((p) => p.playerIds.join() === 'c,d')!
    expect(expectedWin.winRate).toBe(1)
    expect(upset.winRate).toBe(1)
    expect(upset.adjustedPerformance).toBeGreaterThan(expectedWin.adjustedPerformance)
    expect(upset.adjustedPerformance).toBeLessThan(0.2)
    expect(upset.expectedWins).toBeLessThan(0.02)
  })

  it('calculates a bounded, disclosed performance index instead of combining participation with skill', () => {
    const result = getAnalytics(fixture())
    const winner = result.players.find((p) => p.playerId === 'a')!
    const loser = result.players.find((p) => p.playerId === 'c')!
    expect(winner.performanceIndex).toBeGreaterThan(loser.performanceIndex)
    expect(result.players.every((p) => p.performanceIndex >= 0 && p.performanceIndex <= 100)).toBe(
      true,
    )
    expect(result.definitions.performance).toContain('50%')
    expect(result.definitions.performance).toContain('never controls court priority')
  })

  it('excludes breaks from waiting and includes stopped matches in court-time participation', () => {
    const s = session('doubles', {
      attendance: [
        { playerId: 'a', at: start, available: true },
        { playerId: 'a', at: start + 10 * 60000, available: false },
        { playerId: 'a', at: start + 20 * 60000, available: true },
      ],
    })
    const result = getAnalytics(
      fixture([match('stopped', 1, 0, { status: 'abandoned' })], [s]),
      {},
      start + 30 * 60000,
    )
    const participation = result.participation.find((p) => p.playerId === 'a')!
    expect(participation).toMatchObject({
      availableMinutes: 20,
      minutes: 5,
      waitingMinutes: 15,
      longestWaitMinutes: 10,
    })
    expect(result.players).toHaveLength(0)
  })

  it('counts interval-overlapping court time even when a match finishes outside the result date filter', () => {
    const data = fixture([
      match('spanning', 3, 1, { startedAt: start, endedAt: start + 20 * 60000 }),
    ])
    const result = getAnalytics(
      data,
      { from: start + 5 * 60000, to: start + 10 * 60000 },
      start + 30 * 60000,
    )
    expect(result.acceptedMatches).toHaveLength(0)
    expect(result.participation.find((p) => p.playerId === 'a')?.minutes).toBe(5)
    expect(result.participation.find((p) => p.playerId === 'a')?.waitingMinutes).toBe(0)
  })

  it('never mutates source records and returns a useful empty scope', () => {
    const data = fixture()
    const before = JSON.stringify(data)
    const result = getAnalytics(data, { sessionId: 'missing' })
    expect(result.players).toEqual([])
    expect(result.participation).toEqual([])
    expect(JSON.stringify(data)).toBe(before)
  })

  it('clips reported availability to arrival/departure windows and excludes breaks', () => {
    const s = session('doubles', {
      availability: { a: { from: start + 10 * 60000, until: start + 20 * 60000 } },
      attendance: [
        { playerId: 'a', at: start, available: true },
        { playerId: 'a', at: start + 10 * 60000, available: false },
        { playerId: 'a', at: start + 15 * 60000, available: true },
      ],
    })
    const result = getAnalytics(fixture([], [s]), {}, start + 30 * 60000)
    expect(result.participation.find((p) => p.playerId === 'a')).toMatchObject({
      availableMinutes: 5,
      waitingMinutes: 5,
      longestWaitMinutes: 5,
    })
  })

  it('does not report a future arrival as already waiting', () => {
    const s = session('doubles', {
      attendance: [{ playerId: 'a', at: start + 60 * 60000, available: true }],
    })
    const result = getAnalytics(fixture([], [s]), {}, start + 30 * 60000)
    expect(result.participation.find((p) => p.playerId === 'a')).toMatchObject({
      availableMinutes: 0,
      waitingMinutes: 0,
      longestWaitMinutes: 0,
    })
  })
})
