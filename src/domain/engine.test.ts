import { describe, expect, it } from 'vitest'
import {
  attendanceSummary,
  buildFinalResult,
  getStandings,
  playerStats,
  scoreMatch,
  suggestMatch,
} from './engine'
import { initialData, type AppData, type Match, type Session, type Side } from './model'

const start = 1_700_000_000_000

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session',
    name: 'Friday games',
    startedAt: start,
    format: 'doubles',
    courtCount: 2,
    target: 21,
    winBy: 2,
    cap: 30,
    bestOf: 1,
    mode: 'balanced',
    playerIds: ['a', 'b', 'c', 'd', 'e', 'f'],
    availablePlayerIds: ['a', 'b', 'c', 'd', 'e', 'f'],
    status: 'active',
    ...overrides,
  }
}

function match(points: Side[] = [], overrides: Partial<Match> = {}): Match {
  return {
    id: 'match',
    sessionId: 'session',
    court: 1,
    teamA: ['a', 'b'],
    teamB: ['c', 'd'],
    startedAt: start,
    status: 'playing',
    revision: 0,
    actions: points.map((side, index) => ({
      id: `point-${index}`,
      kind: 'point',
      side,
      at: start + index * 1000,
    })),
    ...overrides,
  }
}

function data(s = session(), matches: Match[] = []): AppData {
  return {
    version: 1,
    sessions: [s],
    matches,
    players: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({
      id,
      name: id,
      level: 3,
      createdAt: start,
    })),
  }
}

const points = (side: Side, count: number): Side[] => Array.from({ length: count }, () => side)
const tied = (count: number): Side[] =>
  Array.from({ length: count }, () => ['A', 'B'] as Side[]).flat()

describe('badminton scoring', () => {
  it('starts at love-all without mutating the match', () => {
    const m = match()
    expect(scoreMatch(m, session())).toEqual({
      a: 0,
      b: 0,
      gamesA: 0,
      gamesB: 0,
      games: [],
      complete: false,
    })
    expect(m.actions).toEqual([])
  })

  it('requires a two-point lead at deuce', () => {
    expect(scoreMatch(match([...tied(20), 'A']), session()).complete).toBe(false)
    expect(scoreMatch(match([...tied(20), 'A', 'A']), session())).toMatchObject({
      a: 22,
      b: 20,
      gamesA: 1,
      winner: 'A',
      complete: true,
    })
  })

  it('ends at the cap even without a two-point lead', () => {
    expect(scoreMatch(match([...tied(29), 'B']), session())).toMatchObject({
      a: 29,
      b: 30,
      winner: 'B',
      complete: true,
    })
  })

  it('supports short games and best-of-three with a fresh score between games', () => {
    const s = session({ target: 3, cap: 5, bestOf: 3 })
    expect(scoreMatch(match(points('A', 3)), s)).toMatchObject({
      a: 0,
      b: 0,
      gamesA: 1,
      complete: false,
    })
    const result = scoreMatch(match([...points('A', 3), ...points('B', 3), ...points('B', 3)]), s)
    expect(result).toMatchObject({ gamesA: 1, gamesB: 2, winner: 'B', complete: true })
    expect(result.games).toHaveLength(3)
  })

  it('undo reopens a finished game and can cross a game boundary', () => {
    const s = session({ target: 3, cap: 5, bestOf: 3 })
    const m = match(points('A', 3))
    m.actions.push({ id: 'undo-1', kind: 'undo', at: start + 5000 })
    expect(scoreMatch(m, s)).toMatchObject({ a: 2, b: 0, gamesA: 0, complete: false })
    m.actions.push({ id: 'new-point', kind: 'point', side: 'B', at: start + 6000 })
    expect(scoreMatch(m, s)).toMatchObject({ a: 2, b: 1, gamesA: 0 })
  })

  it('deduplicates command retries and ignores points submitted after completion', () => {
    const m = match(points('A', 3))
    m.actions.push(m.actions[0], { id: 'too-late', kind: 'point', side: 'B', at: start + 6000 })
    expect(scoreMatch(m, session({ target: 3, cap: 5 }))).toMatchObject({ a: 3, b: 0, winner: 'A' })
    m.actions.push({ id: 'undo', kind: 'undo', at: start + 7000 })
    m.actions.push(m.actions.at(-1)!)
    expect(scoreMatch(m, session({ target: 3, cap: 5 }))).toMatchObject({
      a: 2,
      b: 0,
      complete: false,
    })
  })

  it('ignores undo on an empty score and records no negative scores', () => {
    const m = match()
    m.actions.push({ id: 'undo', kind: 'undo', at: start })
    expect(scoreMatch(m, session())).toMatchObject({ a: 0, b: 0, complete: false })
  })
})

describe('match scheduling', () => {
  it('tracks late arrivals without counting pre-arrival time', () => {
    const s = session({ attendance: [{ playerId: 'f', at: start + 15 * 60000, available: true }] })
    expect(attendanceSummary(s, 'f', start + 20 * 60000)).toEqual({
      availableMs: 5 * 60000,
      waitingSince: start + 15 * 60000,
    })
    expect(attendanceSummary(s, 'f', start + 10 * 60000)).toEqual({
      availableMs: 0,
      waitingSince: start + 10 * 60000,
    })
  })

  it('stops eligibility during breaks and resets waiting on return', () => {
    const s = session({
      attendance: [
        { playerId: 'a', at: start, available: true },
        { playerId: 'a', at: start + 10 * 60000, available: false },
        { playerId: 'a', at: start + 25 * 60000, available: true },
      ],
    })
    expect(attendanceSummary(s, 'a', start + 30 * 60000)).toEqual({
      availableMs: 15 * 60000,
      waitingSince: start + 25 * 60000,
    })
    expect(attendanceSummary(s, 'a', start + 20 * 60000)).toEqual({
      availableMs: 10 * 60000,
      waitingSince: start + 20 * 60000,
    })
  })

  it('does not accumulate attendance after a session ends', () => {
    const s = session({ endedAt: start + 10 * 60000, status: 'completed' })
    expect(attendanceSummary(s, 'a', start + 50 * 60000).availableMs).toBe(10 * 60000)
    expect(attendanceSummary(s, 'unknown', start + 50 * 60000).availableMs).toBe(0)
  })

  it('does not give a new arrival priority over people already waiting', () => {
    const s = session({
      format: 'singles',
      courtCount: 1,
      availablePlayerIds: ['a', 'b', 'f'],
      attendance: [{ playerId: 'f', at: start + 29 * 60000, available: true }],
    })
    const suggestion = suggestMatch(data(s), s, 1, start + 30 * 60000)!
    expect([...suggestion.teamA, ...suggestion.teamB].sort()).toEqual(['a', 'b'])
  })

  it('does not count a voluntary break as waiting debt', () => {
    const s = session({
      format: 'singles',
      courtCount: 1,
      availablePlayerIds: ['a', 'b', 'f'],
      attendance: [
        { playerId: 'f', at: start, available: true },
        { playerId: 'f', at: start + 1000, available: false },
        { playerId: 'f', at: start + 29 * 60000, available: true },
      ],
    })
    const suggestion = suggestMatch(data(s), s, 1, start + 30 * 60000)!
    expect([...suggestion.teamA, ...suggestion.teamB].sort()).toEqual(['a', 'b'])
  })

  it('never selects unavailable, unknown, duplicate, or currently playing people', () => {
    const s = session({
      format: 'singles',
      availablePlayerIds: ['a', 'a', 'b', 'c', 'd', 'unknown'],
    })
    const d = data(s, [match([], { court: 1, teamA: ['a'], teamB: ['b'] })])
    const suggestion = suggestMatch(d, s, 2, start + 10000)
    expect(suggestion).not.toBeNull()
    expect([...suggestion!.teamA, ...suggestion!.teamB].sort()).toEqual(['c', 'd'])
  })

  it('does not assign an occupied court or schedule insufficient players', () => {
    const s = session()
    const d = data(s, [match()])
    expect(suggestMatch(d, s, 1)).toBeNull()
    expect(suggestMatch(d, s, 2)).toBeNull()
    expect(suggestMatch(d, s, 0)).toBeNull()
    expect(suggestMatch(d, s, 3)).toBeNull()
    expect(suggestMatch(data(), session({ status: 'completed' }), 1)).toBeNull()
  })

  it('puts waiting players ahead of players who just had court time', () => {
    const s = session()
    const d = data(s, [
      match(points('A', 21), { status: 'completed', endedAt: start + 15 * 60000 }),
    ])
    const before = JSON.stringify(d)
    const suggestion = suggestMatch(d, s, 1, start + 16 * 60000)!
    const selected = [...suggestion.teamA, ...suggestion.teamB]
    expect(selected).toContain('e')
    expect(selected).toContain('f')
    expect(new Set(selected).size).toBe(4)
    expect(JSON.stringify(d)).toBe(before)
  })

  it('balances declared starting strength across the chosen teams', () => {
    const s = session({ playerIds: ['a', 'b', 'c', 'd'], availablePlayerIds: ['a', 'b', 'c', 'd'] })
    const d = data(s)
    d.players.slice(0, 4).forEach((player, index) => {
      player.level = [1, 2, 4, 5][index]
    })
    const suggestion = suggestMatch(d, s, 1, start)!
    expect(suggestion.teamA.slice().sort()).toEqual(['a', 'd'])
    expect(suggestion.teamB.slice().sort()).toEqual(['b', 'c'])
  })

  it('avoids a repeated partnership in variety mode when alternatives exist', () => {
    const s = session({
      mode: 'variety',
      playerIds: ['a', 'b', 'c', 'd'],
      availablePlayerIds: ['a', 'b', 'c', 'd'],
    })
    const d = data(s, [
      match(points('A', 21), { status: 'completed', endedAt: start + 10 * 60000 }),
    ])
    const suggestion = suggestMatch(d, s, 1, start + 11 * 60000)!
    expect(suggestion.teamA.slice().sort()).not.toEqual(['a', 'b'])
    expect(suggestion.reason).toContain('partnerships')
  })
})

describe('final result entry and corrections', () => {
  it('rejects impossible cap scores rather than silently saving an earlier winning score', () => {
    expect(() => buildFinalResult(match(), session(), [{ a: 30, b: 0 }])).toThrow(
      'Check game scores',
    )
    expect(() => buildFinalResult(match(), session(), [{ a: 30, b: 27 }])).toThrow(
      'Check game scores',
    )
    expect(() => buildFinalResult(match(), session(), [{ a: 22, b: 0 }])).toThrow(
      'Check game scores',
    )
  })

  it('accepts both valid cap results exactly as entered', () => {
    for (const b of [28, 29]) {
      const changed = buildFinalResult(match(), session(), [{ a: 30, b }], start + 1000)
      expect(scoreMatch(changed, session()).games).toEqual([{ a: 30, b, winner: 'A' }])
      expect(changed).toMatchObject({ status: 'completed', revision: 1, endedAt: start + 1000 })
    }
  })

  it('rejects incomplete, tied, negative, fractional, and non-finite scores', () => {
    for (const game of [
      { a: 21, b: 20 },
      { a: 20, b: 20 },
      { a: -1, b: 21 },
      { a: 21, b: 1.5 },
      { a: NaN, b: 0 },
      { a: Infinity, b: 0 },
    ]) {
      expect(() => buildFinalResult(match(), session(), [game])).toThrow('Check game scores')
    }
    expect(() => buildFinalResult(match(), session(), [])).toThrow('Enter at least one')
  })

  it('requires a decided best-of-three and rejects games after the clincher', () => {
    const s = session({ bestOf: 3 })
    expect(() => buildFinalResult(match(), s, [{ a: 21, b: 8 }])).toThrow('Enter enough games')
    expect(() =>
      buildFinalResult(match(), s, [
        { a: 21, b: 8 },
        { a: 21, b: 9 },
        { a: 0, b: 21 },
      ]),
    ).toThrow('after the match was already won')
    const changed = buildFinalResult(match(), s, [
      { a: 21, b: 8 },
      { a: 20, b: 22 },
      { a: 21, b: 19 },
    ])
    expect(scoreMatch(changed, s)).toMatchObject({
      complete: true,
      winner: 'A',
      gamesA: 2,
      gamesB: 1,
    })
  })

  it('keeps the prior action log and duration while correcting a completed result', () => {
    const s = session()
    const original = match(points('A', 21), {
      status: 'completed',
      endedAt: start + 10 * 60000,
      revision: 7,
    })
    const before = JSON.stringify(original)
    const changed = buildFinalResult(original, s, [{ a: 18, b: 21 }], start + 20 * 60000)
    expect(changed.actions.slice(0, original.actions.length)).toEqual(original.actions)
    expect(changed.actions.filter((action) => action.kind === 'undo')).toHaveLength(21)
    expect(scoreMatch(changed, s)).toMatchObject({ a: 18, b: 21, winner: 'B' })
    expect(changed.endedAt).toBe(original.endedAt)
    expect(changed.revision).toBe(8)
    expect(JSON.stringify(original)).toBe(before)
  })

  it('handles earlier undos and ignored post-match events when clearing the old effective score', () => {
    const original = match(points('A', 21))
    original.actions.push(
      { id: 'late', kind: 'point', side: 'B', at: start + 22 },
      { id: 'undo', kind: 'undo', at: start + 23 },
    )
    const changed = buildFinalResult(original, session(), [{ a: 21, b: 19 }])
    expect(scoreMatch(changed, session()).games).toEqual([{ a: 21, b: 19, winner: 'A' }])
  })
})

describe('verified results and standings', () => {
  it('counts a completed doubles result for every participant without inventing individual rally contribution', () => {
    const d = data(session(), [
      match(points('A', 21), { status: 'completed', endedAt: start + 10 * 60000 }),
    ])
    expect(playerStats(d, 'a')).toEqual({
      played: 1,
      wins: 1,
      losses: 0,
      pointsFor: 21,
      pointsAgainst: 0,
      minutes: 10,
      rating: 1012,
    })
    expect(playerStats(d, 'b')).toEqual(playerStats(d, 'a'))
    expect(playerStats(d, 'c')).toMatchObject({ played: 1, wins: 0, losses: 1, rating: 988 })
    expect(getStandings(d).map((row) => row.playerId)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('does not count unfinished, abandoned, or incorrectly marked completed results', () => {
    const d = data(session(), [
      match(points('A', 21), { id: 'abandoned', status: 'abandoned' }),
      match(points('A', 21), { id: 'playing', status: 'playing' }),
      match(points('A', 4), { id: 'invalid', status: 'completed' }),
    ])
    expect(playerStats(d, 'a').played).toBe(0)
    expect(getStandings(d)).toEqual([])
  })

  it('honors an explicitly selected scope, including an empty scope', () => {
    const d = data(session(), [match(points('A', 21), { status: 'completed' })])
    d.sessions.push(session({ id: 'other' }))
    d.matches.push(
      match(points('B', 21), { id: 'other-match', sessionId: 'other', status: 'completed' }),
    )
    expect(playerStats(d, 'a').played).toBe(2)
    expect(playerStats(d, 'a', ['session']).wins).toBe(1)
    expect(playerStats(d, 'a', ['other']).losses).toBe(1)
    expect(getStandings(d, [])).toEqual([])
  })

  it('totals every game in best-of-three matches and recalculates after a correction', () => {
    const s = session({ target: 3, cap: 5, bestOf: 3 })
    const m = match([...points('A', 3), ...points('B', 3), ...points('A', 3)], {
      status: 'completed',
    })
    const d = data(s, [m])
    expect(playerStats(d, 'a')).toMatchObject({ pointsFor: 6, pointsAgainst: 3, wins: 1 })
    m.actions.push({ id: 'undo-final', kind: 'undo', at: start + 10000 })
    expect(playerStats(d, 'a').played).toBe(0)
    m.actions.push(
      ...points('B', 5).map((side, index) => ({
        id: `correction-${index}`,
        kind: 'point' as const,
        side,
        at: start + 11000 + index,
      })),
    )
    expect(playerStats(d, 'a')).toMatchObject({
      wins: 0,
      losses: 1,
      pointsFor: 5,
      pointsAgainst: 7,
    })
  })

  it('returns a fresh empty data structure', () => {
    const first = initialData()
    first.players.push({ id: 'a', name: 'A', level: 3, createdAt: start })
    expect(initialData()).toEqual({ version: 1, players: [], sessions: [], matches: [] })
  })
})
