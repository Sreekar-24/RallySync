import { type AppData, type Player, type Session, type Match } from '../domain/model'

export function createDemo(): AppData {
  const now = Date.now()
  const players: Player[] = [
    'Alex Morgan',
    'Priya Shah',
    'Jamie Chen',
    'Sam Rivera',
    'Riley Park',
    'Jordan Lee',
    'Taylor Kim',
    'Casey Patel',
  ].map((name, i) => ({
    id: `demo-player-${i}`,
    name,
    level: [3, 4, 2, 3, 4, 2, 3, 3][i],
    createdAt: now - 86400000,
  }))
  const session: Session = {
    id: 'demo-session',
    name: 'The weekend rally',
    startedAt: now - 28 * 60000,
    format: 'doubles',
    courtCount: 2,
    target: 21,
    winBy: 2,
    cap: 30,
    bestOf: 1,
    mode: 'balanced',
    playerIds: players.map((p) => p.id),
    availablePlayerIds: players.map((p) => p.id),
    status: 'active',
  }
  const match: Match = {
    id: 'demo-finished',
    sessionId: session.id,
    court: 1,
    teamA: [players[0].id, players[2].id],
    teamB: [players[1].id, players[3].id],
    startedAt: now - 25 * 60000,
    endedAt: now - 10 * 60000,
    status: 'completed',
    revision: 38,
    actions: [],
  }
  for (let i = 0; i < 17; i++)
    match.actions.push({
      id: `demo-b-${i}`,
      kind: 'point',
      side: 'B',
      at: now - 20 * 60000 + i * 1000,
    })
  for (let i = 0; i < 21; i++)
    match.actions.push({
      id: `demo-a-${i}`,
      kind: 'point',
      side: 'A',
      at: now - 18 * 60000 + i * 1000,
    })
  return { version: 1, players, sessions: [session], matches: [match] }
}
