import type { AppData } from './model'

/** A deliberate session deletion never removes player identities or other results. */
export function deleteSession(data: AppData, sessionId: string): AppData {
  return {
    ...data,
    version: 2,
    sessions: data.sessions.filter((s) => s.id !== sessionId),
    matches: data.matches.filter((m) => m.sessionId !== sessionId),
  }
}

const originalDemoNames = [
  'Alex Morgan',
  'Priya Shah',
  'Jamie Chen',
  'Sam Rivera',
  'Riley Park',
  'Jordan Lee',
  'Taylor Kim',
  'Casey Patel',
]
export function legacyDemoCleanup(data: AppData): {
  data: AppData
  sessions: number
  matches: number
  players: number
} {
  const sessions = data.sessions.filter((s) => s.id === 'demo-session')
  const ids = new Set(sessions.map((s) => s.id))
  const matches = data.matches.filter((m) => ids.has(m.sessionId))
  const retained = {
    ...data,
    version: 2 as const,
    sessions: data.sessions.filter((s) => !ids.has(s.id)),
    matches: data.matches.filter((m) => !ids.has(m.sessionId)),
  }
  const referenced = new Set([
    ...retained.sessions.flatMap((s) => s.playerIds),
    ...retained.matches.flatMap((m) => [...m.teamA, ...m.teamB]),
  ])
  const players = data.players.filter((p) => {
    const i = originalDemoNames.findIndex(
      (name, index) => p.id === `demo-player-${index}` && p.name === name,
    )
    return i >= 0 && !referenced.has(p.id)
  })
  const removed = new Set(players.map((p) => p.id))
  return {
    data: { ...retained, players: data.players.filter((p) => !removed.has(p.id)) },
    sessions: sessions.length,
    matches: matches.length,
    players: players.length,
  }
}
