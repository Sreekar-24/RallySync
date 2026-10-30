import Dexie, { type EntityTable } from 'dexie'
import { z } from 'zod'
import type { AppData } from '../domain/model'
import { getScoreEntries, scoreMatch } from '../domain/engine'

const id = z.string().min(1).max(128)
const time = z.number().finite().nonnegative().max(8.64e15)
const scoreEntrySchema = z
  .object({
    a: z.number().int().min(0).max(199),
    b: z.number().int().min(0).max(199),
    credits: z.record(id, z.number().int().min(0).max(199)).optional(),
  })
  .strict()
const playerSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(48),
    level: z.number().int().min(1).max(5),
    createdAt: time,
  })
  .strict()
const planningSchema = z
  .object({
    basis: z.enum(['matches', 'duration']),
    matchCount: z.number().int().min(1).max(200),
    durationMinutes: z.number().finite().min(1).max(1440),
    matchMinutes: z.number().finite().min(1).max(180),
    changeoverMinutes: z.number().finite().min(0).max(60),
    weights: z
      .object({
        fairness: z.number().finite().min(0).max(100),
        rest: z.number().finite().min(0).max(100),
        balance: z.number().finite().min(0).max(100),
        variety: z.number().finite().min(0).max(100),
        partnership: z.number().finite().min(0).max(100),
        contribution: z.number().finite().min(0).max(100),
      })
      .strict()
      .optional(),
  })
  .strict()
const slotSchema = z
  .object({
    id,
    court: z.number().int().min(1).max(12),
    round: z.number().int().min(1).max(200),
    startsAt: time,
    teamA: z.array(id).min(1).max(2),
    teamB: z.array(id).min(1).max(2),
    locked: z.boolean(),
    matchId: id.optional(),
    reason: z.string().max(1000),
  })
  .strict()
const sessionSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(80),
    startedAt: time,
    endedAt: time.optional(),
    format: z.enum(['singles', 'doubles']),
    courtCount: z.number().int().min(1).max(12),
    target: z.number().int().min(1).max(99),
    winBy: z.number().int().min(1).max(2),
    cap: z.number().int().min(1).max(199),
    bestOf: z.union([z.literal(1), z.literal(3)]),
    mode: z.enum(['balanced', 'fair', 'variety']),
    scoringMode: z.enum(['team', 'individual', 'combined']).optional(),
    planning: planningSchema.optional(),
    plan: z
      .object({
        revision: z.number().int().nonnegative(),
        generatedAt: time,
        slots: z.array(slotSchema).max(200),
        warnings: z.array(z.string().max(1000)).max(200),
      })
      .strict()
      .optional(),
    availability: z
      .record(id, z.object({ from: time.optional(), until: time.optional() }).strict())
      .optional(),
    playerIds: z.array(id).max(200),
    availablePlayerIds: z.array(id).max(200),
    status: z.enum(['active', 'completed']),
    attendance: z
      .array(z.object({ playerId: id, at: time, available: z.boolean() }).strict())
      .max(100000)
      .optional(),
  })
  .strict()
const actionSchema = z
  .object({
    id,
    kind: z.enum(['point', 'undo', 'adjust', 'remove']),
    side: z.enum(['A', 'B']).optional(),
    playerId: id.optional(),
    scores: z.array(scoreEntrySchema).min(1).max(3).optional(),
    synthetic: z.boolean().optional(),
    targetId: id.optional(),
    at: time,
  })
  .strict()
const matchSchema = z
  .object({
    id,
    sessionId: id,
    court: z.number().int().min(1).max(12),
    teamA: z.array(id).min(1).max(2),
    teamB: z.array(id).min(1).max(2),
    startedAt: time,
    endedAt: time.optional(),
    status: z.enum(['playing', 'completed', 'abandoned']),
    actions: z.array(actionSchema).max(20000),
    revision: z.number().int().nonnegative(),
    planSlotId: id.optional(),
    serviceSetup: z
      .object({
        game: z.number().int().min(1).max(3),
        a: z.number().int().min(0).max(199),
        b: z.number().int().min(0).max(199),
        afterActionId: id.optional(),
        positions: z
          .object({ A: z.array(id).min(1).max(2), B: z.array(id).min(1).max(2) })
          .strict(),
        servingSide: z.enum(['A', 'B']),
        nearSide: z.enum(['A', 'B']),
        at: time,
      })
      .strict()
      .optional(),
  })
  .strict()
const dataSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    players: z.array(playerSchema).max(2000),
    sessions: z.array(sessionSchema).max(10000),
    matches: z.array(matchSchema).max(50000),
  })
  .strict()

/** Validate without synthesizing attribution; legacy results migrate losslessly to v2. */
export function validateData(input: unknown): AppData {
  // v0.1 accidentally spread its recommendation explanation onto a Match.
  // Remove only that known, non-result legacy field; unknown v2 fields still fail.
  let source = input
  if (
    typeof input === 'object' &&
    input !== null &&
    'version' in input &&
    input.version === 1 &&
    'matches' in input &&
    Array.isArray(input.matches)
  ) {
    source = {
      ...input,
      matches: input.matches.map((match) => {
        if (
          typeof match !== 'object' ||
          match === null ||
          !('reason' in match) ||
          typeof match.reason !== 'string'
        )
          return match
        const { reason: _legacyReason, ...record } = match
        return record
      }),
    }
  }
  const parsed = dataSchema.parse(source)
  const unique = (values: string[]) => new Set(values).size === values.length
  if (
    !unique(parsed.players.map((p) => p.id)) ||
    !unique(parsed.sessions.map((s) => s.id)) ||
    !unique(parsed.matches.map((m) => m.id))
  )
    throw new Error('The backup contains duplicate record IDs.')
  const players = new Set(parsed.players.map((p) => p.id))
  const sessions = new Map(parsed.sessions.map((s) => [s.id, s]))
  const matches = new Map(parsed.matches.map((m) => [m.id, m]))
  if (parsed.sessions.filter((s) => s.status === 'active').length > 1)
    throw new Error('Only one active session is supported.')
  for (const s of parsed.sessions) {
    if (
      s.cap < s.target ||
      !unique(s.playerIds) ||
      !unique(s.availablePlayerIds) ||
      s.playerIds.some((p) => !players.has(p)) ||
      s.availablePlayerIds.some((p) => !s.playerIds.includes(p)) ||
      s.attendance?.some((a) => !s.playerIds.includes(a.playerId))
    )
      throw new Error('Invalid session settings or player references.')
    if (s.endedAt !== undefined && s.endedAt < s.startedAt)
      throw new Error('A session cannot end before it starts.')
    for (const [playerId, window] of Object.entries(s.availability ?? {})) {
      if (
        !s.playerIds.includes(playerId) ||
        (window.from !== undefined && window.until !== undefined && window.from >= window.until)
      )
        throw new Error('Invalid player availability window.')
    }
    if (s.plan) {
      if (!unique(s.plan.slots.map((slot) => slot.id)))
        throw new Error('Duplicate schedule slot IDs.')
      const reservations = new Set<string>()
      const linkedMatches = new Set<string>()
      for (const slot of s.plan.slots) {
        const ids = [...slot.teamA, ...slot.teamB]
        const size = s.format === 'singles' ? 1 : 2
        if (
          slot.court > s.courtCount ||
          slot.teamA.length !== size ||
          slot.teamB.length !== size ||
          !unique(ids) ||
          ids.some((p) => !s.playerIds.includes(p))
        )
          throw new Error('Invalid planned teams or court.')
        if (slot.matchId) {
          const linked = matches.get(slot.matchId)
          if (
            !linked ||
            linked.sessionId !== s.id ||
            linked.court !== slot.court ||
            linkedMatches.has(slot.matchId) ||
            linked.teamA.join('|') !== slot.teamA.join('|') ||
            linked.teamB.join('|') !== slot.teamB.join('|')
          )
            throw new Error('Invalid schedule match reference.')
          linkedMatches.add(slot.matchId)
        }
        // Finished slots retain their original estimates; only future reservations conflict.
        if (!slot.matchId)
          for (const key of [
            `court:${slot.startsAt}:${slot.court}`,
            ...ids.map((p) => `player:${slot.startsAt}:${p}`),
          ]) {
            if (reservations.has(key))
              throw new Error('A planned court or player is assigned twice.')
            reservations.add(key)
          }
      }
    }
  }
  const occupied = new Set<string>()
  for (const m of parsed.matches) {
    const s = sessions.get(m.sessionId)
    const participants = [...m.teamA, ...m.teamB]
    const size = s?.format === 'singles' ? 1 : 2
    if (
      !s ||
      m.court > s.courtCount ||
      m.teamA.length !== size ||
      m.teamB.length !== size ||
      !unique(participants) ||
      participants.some((p) => !s.playerIds.includes(p))
    )
      throw new Error('Invalid match participants or court.')
    if (m.endedAt !== undefined && m.endedAt < m.startedAt)
      throw new Error('A match cannot end before it starts.')
    if (!unique(m.actions.map((a) => a.id))) throw new Error('Invalid scoring events.')
    const earlierActions = new Map<string, (typeof m.actions)[number]>()
    for (const action of m.actions) {
      if (action.kind === 'remove') {
        const target = action.targetId ? earlierActions.get(action.targetId) : undefined
        if (!target || target.kind !== 'point' || action.side !== target.side)
          throw new Error('A removed point must reference an earlier rally on the same side.')
      } else if (action.targetId !== undefined)
        throw new Error('Only a removed point can reference a rally.')
      earlierActions.set(action.id, action)
      if (action.playerId !== undefined && action.kind !== 'point')
        throw new Error('Player credit is only valid on a point event.')
      if (
        action.kind === 'point' &&
        (!action.side ||
          (action.playerId !== undefined &&
            !(action.side === 'A' ? m.teamA : m.teamB).includes(action.playerId)))
      )
        throw new Error('Invalid scoring events.')
      if (action.kind === 'adjust') {
        if (!action.scores || action.scores.length > s.bestOf)
          throw new Error('Invalid score adjustment.')
        let winsA = 0
        let winsB = 0
        const needed = s.bestOf === 3 ? 2 : 1
        for (let i = 0; i < action.scores.length; i++) {
          const game = action.scores[i]
          if (winsA >= needed || winsB >= needed)
            throw new Error('Adjustment contains games after the match was won.')
          const high = Math.max(game.a, game.b),
            low = Math.min(game.a, game.b)
          const complete = high === s.cap || (high >= s.target && high - low >= s.winBy)
          if (
            high > s.cap ||
            (complete &&
              (game.a === game.b ||
                (high > s.target && high < s.cap && high - low !== s.winBy) ||
                (high === s.cap && s.cap > s.target && low < s.cap - s.winBy))) ||
            (!complete && i < action.scores.length - 1)
          )
            throw new Error('Invalid adjusted game score.')
          if (complete) {
            if (game.a > game.b) winsA++
            else winsB++
          }
          let creditA = 0,
            creditB = 0
          for (const [playerId, count] of Object.entries(game.credits ?? {})) {
            if (!participants.includes(playerId))
              throw new Error('Credit belongs to a player outside this match.')
            if (m.teamA.includes(playerId)) creditA += count
            else creditB += count
          }
          if (creditA > game.a || creditB > game.b)
            throw new Error('Player credits exceed the side score.')
        }
      }
    }
    if (m.serviceSetup) {
      const setup = m.serviceSetup
      for (const side of ['A', 'B'] as const) {
        const team = side === 'A' ? m.teamA : m.teamB
        const positions = setup.positions[side]
        if (
          positions.length !== team.length ||
          !unique(positions) ||
          positions.some((id) => !team.includes(id))
        )
          throw new Error('Invalid serving positions.')
      }
      const anchor =
        setup.afterActionId === undefined
          ? -1
          : m.actions.findIndex((action) => action.id === setup.afterActionId)
      if ((setup.afterActionId !== undefined && anchor < 0) || setup.game > s.bestOf)
        throw new Error('Invalid serving checkpoint reference.')
      const baseline = getScoreEntries({ ...m, actions: m.actions.slice(0, anchor + 1) }, s)
      if (
        baseline.length !== setup.game ||
        baseline.at(-1)!.a !== setup.a ||
        baseline.at(-1)!.b !== setup.b
      )
        throw new Error('Serving checkpoint does not match its recorded score.')
      const previousWinner = scoreMatch({ ...m, actions: m.actions.slice(0, anchor + 1) }, s).games[
        setup.game - 2
      ]?.winner
      if (setup.a === 0 && setup.b === 0 && previousWinner && setup.servingSide !== previousWinner)
        throw new Error('The previous game winner serves first in the next game.')
    }
    if (m.planSlotId) {
      const slot = s.plan?.slots.find((slot) => slot.id === m.planSlotId)
      if (!slot || slot.matchId !== m.id) throw new Error('Invalid match schedule link.')
    }
    if (m.status === 'playing') {
      if (s.status !== 'active') throw new Error('A completed session contains an active match.')
      for (const key of [`court:${s.id}:${m.court}`, ...participants.map((p) => `player:${p}`)]) {
        if (occupied.has(key)) throw new Error('An active court or player is assigned twice.')
        occupied.add(key)
      }
    }
  }
  return { ...parsed, version: 2 }
}

export interface SyncConfig {
  endpoint: string
  role: 'organizer' | 'viewer'
  revision: number
  lastSyncAt: number | null
  dirty: boolean
  mutationId: string | null
}
export interface SavedState {
  id: string
  data: AppData
  sync: SyncConfig
  saveId?: string
  generation?: number
}
export const emptySync = (): SyncConfig => ({
  endpoint: '',
  role: 'organizer',
  revision: 0,
  lastSyncAt: null,
  dirty: false,
  mutationId: null,
})

const db = new Dexie('rallysync') as Dexie & { snapshots: EntityTable<SavedState, 'id'> }
db.version(1).stores({ snapshots: 'id' })
export async function loadState(): Promise<SavedState | undefined> {
  // A tiny synchronous write-ahead journal protects the last action if a tab is
  // closed before its asynchronous IndexedDB transaction has completed.
  const journal =
    typeof localStorage === 'undefined' ? null : localStorage.getItem('rallysync-pending-save')
  if (journal) {
    const pending = JSON.parse(journal) as SavedState
    return {
      ...pending,
      id: 'main',
      data: validateData(pending.data),
      sync: { ...emptySync(), ...pending.sync },
    }
  }
  const saved = await db.snapshots.get('main')
  if (saved)
    return { ...saved, data: validateData(saved.data), sync: { ...emptySync(), ...saved.sync } }
}
export function journalState(state: SavedState): void {
  if (typeof localStorage !== 'undefined')
    localStorage.setItem('rallysync-pending-save', JSON.stringify(state))
}
export async function saveState(state: SavedState): Promise<void> {
  await db.snapshots.put(state)
  if (typeof localStorage !== 'undefined') {
    const journal = localStorage.getItem('rallysync-pending-save')
    if (journal) {
      const pending = JSON.parse(journal) as SavedState
      if (pending.saveId === state.saveId || (pending.generation ?? 0) < (state.generation ?? 0))
        localStorage.removeItem('rallysync-pending-save')
    }
  }
}

export function downloadBackup(data: AppData) {
  downloadFile(
    `rallysync-backup-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify({ app: 'RallySync', exportedAt: new Date().toISOString(), data }, null, 2),
    'application/json',
  )
  localStorage.setItem('rallysync-last-backup', String(Date.now()))
}
export function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export async function readBackup(file: File): Promise<AppData> {
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose a backup smaller than 10 MB.')
  const input: unknown = JSON.parse(await file.text())
  return validateData(
    typeof input === 'object' && input !== null && 'data' in input ? input.data : input,
  )
}
