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
  scoringMode?: 'team' | 'individual' | 'combined'
  planning?: PlanningSettings
  plan?: SessionPlan
  availability?: Record<string, { from?: number; until?: number }>
  playerIds: string[]
  availablePlayerIds: string[]
  /** Availability events include initial attendance, late arrivals, and breaks. */
  attendance?: { playerId: string; at: number; available: boolean }[]
  status: 'active' | 'completed'
}

export interface ScoreAction {
  id: string
  kind: 'point' | 'undo' | 'adjust'
  side?: Side
  playerId?: string
  /** Explicit snapshot correction: one entry per completed game plus current game. */
  scores?: { a: number; b: number; credits?: Record<string, number> }[]
  synthetic?: boolean
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
  planSlotId?: string
}

export interface AppData {
  version: 1 | 2
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
  /** Current game credit, with side totals including unassigned points. */
  credits: Record<string, number>
  allCredits: Record<string, number>
  attributedPoints: number
  totalPoints: number
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
  return { version: 2, players: [], sessions: [], matches: [] }
}

export interface PlanningSettings {
  basis: 'matches' | 'duration'
  matchCount: number
  durationMinutes: number
  matchMinutes: number
  changeoverMinutes: number
  weights?: {
    fairness: number
    rest: number
    balance: number
    variety: number
    partnership: number
    contribution: number
  }
}
export interface PlannedMatch {
  id: string
  court: number
  round: number
  startsAt: number
  teamA: string[]
  teamB: string[]
  locked: boolean
  matchId?: string
  reason: string
}
export interface SessionPlan {
  revision: number
  generatedAt: number
  slots: PlannedMatch[]
  warnings: string[]
}
