import { getEffectiveScoreActions, getScoreEntries, scoreMatch } from './engine'
import type { Match, ServiceSetup, Session, Side } from './model'

export interface ServiceConfiguration {
  /** Doubles: own right court first, then own left court. Singles: the sole player. */
  positions: { A: string[]; B: string[] }
  servingSide: Side
  nearSide?: Side
}

export interface ServiceState {
  status: 'setup' | 'ready' | 'check' | 'complete'
  game: number
  positions: { A: string[]; B: string[] }
  servingSide: Side
  serverId?: string
  receiverId?: string
  nearSide: Side
  serviceCourt: 'right' | 'left'
  message: string
}

const other = (side: Side): Side => (side === 'A' ? 'B' : 'A')
const copyPositions = (positions: ServiceConfiguration['positions']) => ({
  A: [...positions.A],
  B: [...positions.B],
})
const atDecidingInterval = (session: Session, game: number, a: number, b: number) =>
  session.bestOf === 3 &&
  session.target === 21 &&
  session.winBy === 2 &&
  session.cap === 30 &&
  game === 3 &&
  Math.max(a, b) >= 11

function expectedNearSide(
  setup: ServiceSetup | undefined,
  session: Session,
  game: number,
  a: number,
  b: number,
): Side {
  if (!setup) return game % 2 === 1 ? 'A' : 'B'
  const changes =
    game -
    setup.game +
    Number(atDecidingInterval(session, game, a, b)) -
    Number(atDecidingInterval(session, setup.game, setup.a, setup.b))
  return changes % 2 === 0 ? setup.nearSide : other(setup.nearSide)
}

/** Next-serve positions, not a claim about players' positions during a rally. */
export function getServiceState(match: Match, session: Session): ServiceState {
  const entries = getScoreEntries(match, session)
  const score = scoreMatch(match, session)
  const game = entries.length
  const setup = match.serviceSetup
  const state: ServiceState = {
    status: 'setup',
    game,
    positions: copyPositions(setup?.positions ?? { A: match.teamA, B: match.teamB }),
    servingSide: score.games[game - 2]?.winner ?? setup?.servingSide ?? 'A',
    nearSide: expectedNearSide(setup, session, game, score.a, score.b),
    serviceCourt: 'right',
    serverId: undefined,
    receiverId: undefined,
    message:
      game > 1
        ? 'New game: confirm the first server and positions.'
        : 'Set positions and choose the first serving side.',
  }
  if (score.complete || match.status !== 'playing')
    return {
      ...state,
      status: 'complete',
      message: 'Game finished. Review the score before confirming.',
    }
  if (!setup) return state

  const anchor =
    setup.afterActionId === undefined
      ? -1
      : match.actions.findIndex((action) => action.id === setup.afterActionId)
  const check = (message = 'Score corrected: check positions and the next server.') => ({
    ...state,
    status: 'check' as const,
    message,
  })
  if (setup.afterActionId !== undefined && anchor < 0) return check()
  const prefixMatch = { ...match, actions: match.actions.slice(0, anchor + 1) }
  const baseline = getScoreEntries(prefixMatch, session)
  if (
    baseline.length !== setup.game ||
    baseline.at(-1)!.a !== setup.a ||
    baseline.at(-1)!.b !== setup.b
  )
    return check()
  const effective = getEffectiveScoreActions(match, session)
  const prefix = getEffectiveScoreActions(prefixMatch, session)
  const currentPrefix = effective.filter((event) => event.sourceIndex <= anchor)
  if (
    prefix.length !== currentPrefix.length ||
    prefix.some((event, index) => event.action.id !== currentPrefix[index].action.id)
  )
    return check()
  const later = effective.filter((event) => event.sourceIndex > anchor)
  if (later.some((event) => event.action.kind !== 'point' || event.action.synthetic)) return check()
  if (game !== setup.game) return game > setup.game ? state : check()

  let servingSide = setup.servingSide
  const positions = copyPositions(setup.positions)
  for (const { action } of later) {
    if (action.side === servingSide && positions[servingSide].length === 2)
      positions[servingSide].reverse()
    if (action.side) servingSide = action.side
  }
  const right = (servingSide === 'A' ? score.a : score.b) % 2 === 0
  const receivingSide = other(servingSide)
  const occupant = (side: Side) => positions[side][positions[side].length === 1 || right ? 0 : 1]
  return {
    ...state,
    status: 'ready',
    positions,
    servingSide,
    serviceCourt: right ? 'right' : 'left',
    serverId: occupant(servingSide),
    receiverId: occupant(receivingSide),
    message: `${right ? 'Even score · right' : 'Odd score · left'} service court`,
  }
}

/** Save a current-score checkpoint without changing any score or individual credit. */
export function configureService(
  match: Match,
  session: Session,
  configuration: ServiceConfiguration,
  now = Date.now(),
): Match {
  const score = scoreMatch(match, session)
  if (match.status !== 'playing' || score.complete)
    throw new Error('Set positions during a playing game.')
  for (const side of ['A', 'B'] as const) {
    const actual = configuration.positions[side]
    const team = side === 'A' ? match.teamA : match.teamB
    if (
      actual.length !== team.length ||
      new Set(actual).size !== actual.length ||
      actual.some((id) => !team.includes(id))
    )
      throw new Error('Each player must appear once on their own side.')
  }
  if (
    !['A', 'B'].includes(configuration.servingSide) ||
    (configuration.nearSide !== undefined && !['A', 'B'].includes(configuration.nearSide))
  )
    throw new Error('Choose a valid serving side and court end.')
  const game = getScoreEntries(match, session).length
  const previousWinner = score.games[game - 2]?.winner
  if (
    score.a === 0 &&
    score.b === 0 &&
    previousWinner &&
    configuration.servingSide !== previousWinner
  )
    throw new Error('The side that won the previous game serves first.')
  return {
    ...match,
    revision: match.revision + 1,
    serviceSetup: {
      game,
      a: score.a,
      b: score.b,
      afterActionId: match.actions.at(-1)?.id,
      positions: copyPositions(configuration.positions),
      servingSide: configuration.servingSide,
      nearSide: configuration.nearSide ?? getServiceState(match, session).nearSide,
      at: now,
    },
  }
}
