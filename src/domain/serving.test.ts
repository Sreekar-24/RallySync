import { describe, expect, it } from 'vitest'
import { adjustMatchScores, getScoreEntries, removePoint, scoreMatch } from './engine'
import { configureService, getServiceState } from './serving'
import type { Match, Session, Side } from './model'

const session: Session = {
  id: 's',
  name: 'Court',
  startedAt: 1,
  format: 'doubles',
  courtCount: 1,
  target: 21,
  winBy: 2,
  cap: 30,
  bestOf: 1,
  mode: 'fair',
  playerIds: ['a1', 'a2', 'b1', 'b2'],
  availablePlayerIds: ['a1', 'a2', 'b1', 'b2'],
  status: 'active',
}
const fresh = (): Match => ({
  id: 'm',
  sessionId: 's',
  court: 1,
  teamA: ['a1', 'a2'],
  teamB: ['b1', 'b2'],
  startedAt: 1,
  status: 'playing',
  actions: [],
  revision: 0,
})
const setup = (match = fresh(), s = session, servingSide: Side = 'A') =>
  configureService(
    match,
    s,
    { positions: { A: match.teamA, B: match.teamB }, servingSide, nearSide: 'A' },
    2,
  )
const point = (match: Match, side: Side, playerId?: string): Match => ({
  ...match,
  revision: match.revision + 1,
  actions: [...match.actions, { id: crypto.randomUUID(), kind: 'point', side, playerId, at: 10 }],
})
const points = (match: Match, winners: Side[]) => winners.reduce((m, side) => point(m, side), match)
const undo = (match: Match): Match => ({
  ...match,
  actions: [...match.actions, { id: crypto.randomUUID(), kind: 'undo', at: 20 }],
  revision: match.revision + 1,
})

describe('next-serve positions', () => {
  it('does not guess a server until players confirm initial positions', () => {
    expect(getServiceState(fresh(), session)).toMatchObject({
      status: 'setup',
      serverId: undefined,
      nearSide: 'A',
    })
    expect(getServiceState(setup(), session)).toMatchObject({
      status: 'ready',
      serverId: 'a1',
      receiverId: 'b1',
      serviceCourt: 'right',
    })
  })

  it('rotates only the serving team and chooses the correct side-out server', () => {
    let m = setup()
    m = point(m, 'A')
    expect(getServiceState(m, session)).toMatchObject({
      serverId: 'a1',
      receiverId: 'b2',
      serviceCourt: 'left',
      positions: { A: ['a2', 'a1'], B: ['b1', 'b2'] },
    })
    m = point(m, 'B')
    expect(getServiceState(m, session)).toMatchObject({
      serverId: 'b2',
      receiverId: 'a1',
      serviceCourt: 'left',
      positions: { A: ['a2', 'a1'], B: ['b1', 'b2'] },
    })
    m = point(m, 'B')
    expect(getServiceState(m, session)).toMatchObject({
      serverId: 'b2',
      receiverId: 'a2',
      serviceCourt: 'right',
      positions: { A: ['a2', 'a1'], B: ['b2', 'b1'] },
    })
    m = point(m, 'A')
    expect(getServiceState(m, session)).toMatchObject({
      serverId: 'a2',
      receiverId: 'b2',
      serviceCourt: 'right',
      positions: { A: ['a2', 'a1'], B: ['b2', 'b1'] },
    })
  })

  it('uses the rally winner, not the player given statistical credit', () => {
    const m = point(setup(), 'A', 'a2')
    expect(getServiceState(m, session).serverId).toBe('a1')
    expect(scoreMatch(m, session).credits).toEqual({ a2: 1 })
  })

  it('replays minus and undo exactly after the initial checkpoint', () => {
    const original = points(setup(), ['A', 'B', 'B', 'A'])
    const changed = removePoint(original, session, 'B')
    expect(scoreMatch(changed, session)).toMatchObject({ a: 2, b: 1 })
    expect(getServiceState(changed, session)).toMatchObject({
      status: 'ready',
      serverId: 'a2',
      serviceCourt: 'right',
      positions: { A: ['a2', 'a1'], B: ['b1', 'b2'] },
    })
    expect(getServiceState(undo(changed), session)).toEqual(getServiceState(original, session))
  })

  it('flags typed score corrections and restores certainty if correction is undone', () => {
    const m = points(setup(), ['A', 'B'])
    const edited = adjustMatchScores(m, session, [{ a: 6, b: 5 }], 30)
    expect(getServiceState(edited, session)).toMatchObject({ status: 'check', serverId: undefined })
    expect(getServiceState(undo(edited), session)).toEqual(getServiceState(m, session))
    const confirmed = configureService(
      edited,
      session,
      { positions: { A: ['a2', 'a1'], B: ['b1', 'b2'] }, servingSide: 'B', nearSide: 'B' },
      31,
    )
    expect(getServiceState(confirmed, session)).toMatchObject({
      status: 'ready',
      serverId: 'b2',
      serviceCourt: 'left',
      nearSide: 'B',
    })
    expect(getServiceState(point(confirmed, 'B'), session)).toMatchObject({
      serverId: 'b2',
      serviceCourt: 'right',
    })
    expect(scoreMatch(confirmed, session)).toEqual(scoreMatch(edited, session))
  })

  it('invalidates a checkpoint when a point before it is retracted or undone', () => {
    const m = setup(points(fresh(), ['A', 'B']))
    expect(getServiceState(removePoint(m, session, 'A'), session).status).toBe('check')
    expect(getServiceState(undo(m), session).status).toBe('check')
    const later = point(m, 'A')
    expect(getServiceState(removePoint(later, session, 'A'), session)).toEqual(
      getServiceState(m, session),
    )
  })

  it('can use either partner as first server by arranging own right and left', () => {
    const m = configureService(fresh(), session, {
      positions: { A: ['a2', 'a1'], B: ['b2', 'b1'] },
      servingSide: 'A',
    })
    expect(getServiceState(m, session)).toMatchObject({ serverId: 'a2', receiverId: 'b2' })
    expect(() =>
      configureService(m, session, {
        positions: { A: ['a1', 'a1'], B: ['b1', 'b2'] },
        servingSide: 'A',
      }),
    ).toThrow('Each player')
  })

  it('tracks singles parity while keeping each player on the correct side', () => {
    const s: Session = { ...session, format: 'singles' }
    const m = setup({ ...fresh(), teamA: ['a1'], teamB: ['b1'] }, s)
    expect(getServiceState(point(m, 'B'), s)).toMatchObject({
      status: 'ready',
      serverId: 'b1',
      receiverId: 'a1',
      serviceCourt: 'left',
    })
  })

  it('requires a new server setup for each new game and changes ends', () => {
    const s: Session = { ...session, target: 3, cap: 5, bestOf: 3 }
    const m = points(setup(fresh(), s), ['B', 'B', 'B'])
    expect(getServiceState(m, s)).toMatchObject({
      status: 'setup',
      game: 2,
      servingSide: 'B',
      nearSide: 'B',
      serverId: undefined,
    })
    expect(() =>
      configureService(m, s, { positions: { A: m.teamA, B: m.teamB }, servingSide: 'A' }),
    ).toThrow('previous game')
    const next = configureService(m, s, {
      positions: { A: m.teamA, B: ['b2', 'b1'] },
      servingSide: 'B',
    })
    expect(getServiceState(next, s)).toMatchObject({
      status: 'ready',
      serverId: 'b2',
      nearSide: 'B',
    })
  })

  it('changes physical ends at eleven in the standard deciding game without changing logical positions', () => {
    const s: Session = { ...session, bestOf: 3 }
    let m = adjustMatchScores(fresh(), s, [
      { a: 21, b: 10 },
      { a: 10, b: 21 },
      { a: 10, b: 7 },
    ])
    m = configureService(m, s, {
      positions: { A: ['a1', 'a2'], B: ['b1', 'b2'] },
      servingSide: 'A',
      nearSide: 'A',
    })
    const next = getServiceState(point(m, 'A'), s)
    expect(next).toMatchObject({
      status: 'ready',
      game: 3,
      nearSide: 'B',
      serverId: 'a1',
      serviceCourt: 'left',
      positions: { A: ['a2', 'a1'], B: ['b1', 'b2'] },
    })
    const reset = configureService(point(m, 'A'), s, {
      positions: next.positions,
      servingSide: 'A',
      nearSide: 'B',
    })
    expect(getServiceState(reset, s).nearSide).toBe('B')
    expect(getServiceState(undo(point(m, 'A')), s).nearSide).toBe('A')
  })

  it('does not silently apply the eleven-point interval to custom short formats', () => {
    const s: Session = { ...session, target: 15, cap: 21, bestOf: 3 }
    const m = configureService(
      adjustMatchScores(fresh(), s, [
        { a: 15, b: 8 },
        { a: 8, b: 15 },
        { a: 10, b: 7 },
      ]),
      s,
      { positions: { A: ['a1', 'a2'], B: ['b1', 'b2'] }, servingSide: 'A', nearSide: 'A' },
    )
    expect(getServiceState(point(m, 'A'), s).nearSide).toBe('A')
  })

  it('hides the next-server claim at a winning score', () => {
    const s: Session = { ...session, target: 3, cap: 5 }
    const m = points(setup(fresh(), s), ['A', 'A', 'A'])
    expect(getServiceState(m, s)).toMatchObject({ status: 'complete', serverId: undefined })
  })
})

describe('side and player minus controls', () => {
  it('removes the last point on the requested side and its actual player credit, not the other side’s last rally', () => {
    let m = point(point(point(fresh(), 'A', 'a1'), 'A', 'a2'), 'B', 'b1')
    m = removePoint(m, session, 'A')
    expect(scoreMatch(m, session)).toMatchObject({ a: 1, b: 1, credits: { a1: 1, b1: 1 } })
    expect(m.actions.at(-1)?.kind).toBe('remove')
    expect(scoreMatch(undo(m), session)).toMatchObject({
      a: 2,
      b: 1,
      credits: { a1: 1, a2: 1, b1: 1 },
    })
  })

  it('allows minus on a selected player while preserving teammate credit', () => {
    const m = point(point(point(fresh(), 'A', 'a1'), 'A', 'a2'), 'B')
    const result = scoreMatch(removePoint(m, session, 'A', 'a1'), session)
    expect(result).toMatchObject({ a: 1, b: 1, credits: { a2: 1 } })
    expect(removePoint(m, session, 'B', 'b1')).toBe(m)
  })

  it('never makes a score negative or reaches into an earlier completed game', () => {
    expect(removePoint(fresh(), session, 'A')).toEqual(fresh())
    const s: Session = { ...session, target: 3, cap: 5, bestOf: 3 }
    const m = points(fresh(), ['A', 'A', 'A'])
    expect(removePoint(m, s, 'A')).toBe(m)
    expect(getScoreEntries(m, s)).toHaveLength(2)
  })

  it('reopens a provisional winning score with a minus tap', () => {
    const s: Session = { ...session, target: 3, cap: 5 }
    const m = points(fresh(), ['A', 'A', 'A'])
    expect(scoreMatch(removePoint(m, s, 'A'), s)).toMatchObject({ a: 2, b: 0, complete: false })
  })

  it('uses a snapshot correction when no known rally exists and reduces unassigned points first', () => {
    const m = setup(
      adjustMatchScores(fresh(), session, [{ a: 5, b: 2, credits: { a1: 2, a2: 2 } }]),
    )
    const changed = removePoint(m, session, 'A')
    expect(scoreMatch(changed, session)).toMatchObject({ a: 4, b: 2, credits: { a1: 2, a2: 2 } })
    expect(changed.actions.at(-1)?.kind).toBe('adjust')
    expect(getServiceState(changed, session).status).toBe('check')
    expect(() => removePoint(changed, session, 'A')).toThrow('Choose which player')
    const changedAgain = removePoint(changed, session, 'A', 'a2')
    expect(scoreMatch(changedAgain, session)).toMatchObject({
      a: 3,
      b: 2,
      credits: { a1: 2, a2: 1 },
    })
    expect(scoreMatch(removePoint(m, session, 'A', 'a1'), session)).toMatchObject({
      a: 4,
      credits: { a1: 1, a2: 2 },
    })
  })

  it('does not retract an old rally hidden by a typed score baseline', () => {
    const m = adjustMatchScores(point(fresh(), 'A', 'a1'), session, [{ a: 5, b: 3, credits: {} }])
    expect(scoreMatch(removePoint(m, session, 'A'), session)).toMatchObject({ a: 4, b: 3 })
    expect(removePoint(m, session, 'A').actions.at(-1)?.kind).toBe('adjust')
  })

  it('deduplicates removal retries and ignores invalid imported targets', () => {
    const m = removePoint(point(fresh(), 'A'), session, 'A')
    expect(scoreMatch({ ...m, actions: [...m.actions, m.actions.at(-1)!] }, session).a).toBe(0)
    expect(
      scoreMatch(
        {
          ...fresh(),
          actions: [{ id: 'bad', kind: 'remove', side: 'A', targetId: 'missing', at: 1 }],
        },
        session,
      ).a,
    ).toBe(0)
  })
})
