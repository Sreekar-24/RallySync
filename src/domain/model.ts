export type Side = 'A' | 'B'

export interface Player {
  id: string
  name: string
  /** Organizer-declared starting level, from 1 (beginner) to 5 (advanced). */
  level: number
  createdAt: number
}

export interface Session {
  id: string
  name: string
  startedAt: number
  endedAt?: number
  format: 'singles' | 'doubles'
  courtCount: number
  target: number
  winBy: number
  cap: number
  bestOf: 1 | 3
  mode: 'balanced' | 'fair' | 'variety'
  playerIds: string[]
  availablePlayerIds: string[]
  /** Availability events include initial attendance, late arrivals, and breaks. */
  attendance?: { playerId: string; at: number; available: boolean }[]
  status: 'active' | 'completed'
}

export interface ScoreAction {
  id: string
  kind: 'point' | 'undo'
  side?: Side
  at: number
}

export interface Match {
  id: string
  sessionId: string
  court: number
  teamA: string[]
  teamB: string[]
  startedAt: number
  endedAt?: number
  status: 'playing' | 'completed' | 'abandoned'
  actions: ScoreAction[]
  revision: number
}

export interface AppData {
  version: 1
  players: Player[]
  sessions: Session[]
  matches: Match[]
}

export interface MatchScore {
  /** Current game score, or final game score when the match is complete. */
  a: number
  b: number
  gamesA: number
  gamesB: number
  games: { a: number; b: number; winner: Side }[]
  complete: boolean
  winner?: Side
}

export interface PlayerStats {
  played: number
  wins: number
  losses: number
  pointsFor: number
  pointsAgainst: number
  minutes: number
  rating: number
}

export interface MatchSuggestion {
  teamA: string[]
  teamB: string[]
  reason: string
}

export function initialData(): AppData {
  return { version: 1, players: [], sessions: [], matches: [] }
}
