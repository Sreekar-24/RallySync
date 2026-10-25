import Dexie, { type EntityTable } from 'dexie'
import { z } from 'zod'
import type { AppData } from '../domain/model'

const id = z.string().min(1).max(128)
const time = z.number().finite().nonnegative().max(8.64e15)
const playerSchema = z.object({
  id,
  name: z.string().trim().min(1).max(48),
  level: z.number().int().min(1).max(5),
  createdAt: time,
})
const sessionSchema = z.object({
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
  playerIds: z.array(id).max(200),
  availablePlayerIds: z.array(id).max(200),
  status: z.enum(['active', 'completed']),
  attendance: z
    .array(z.object({ playerId: id, at: time, available: z.boolean() }))
    .max(100000)
    .optional(),
})
const actionSchema = z.object({
  id,
  kind: z.enum(['point', 'undo']),
  side: z.enum(['A', 'B']).optional(),
  at: time,
})
const matchSchema = z.object({
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
})
const dataSchema = z.object({
  version: z.literal(1),
  players: z.array(playerSchema).max(2000),
  sessions: z.array(sessionSchema).max(10000),
  matches: z.array(matchSchema).max(50000),
})

export function validateData(input: unknown): AppData {
  const parsed = dataSchema.parse(input)
  const unique = (values: string[]) => new Set(values).size === values.length
  if (
    !unique(parsed.players.map((p) => p.id)) ||
    !unique(parsed.sessions.map((s) => s.id)) ||
    !unique(parsed.matches.map((m) => m.id))
  )
    throw new Error('The backup contains duplicate record IDs.')
  const players = new Set(parsed.players.map((p) => p.id))
  const sessions = new Map(parsed.sessions.map((s) => [s.id, s]))
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
    if (!unique(m.actions.map((a) => a.id)) || m.actions.some((a) => a.kind === 'point' && !a.side))
      throw new Error('Invalid scoring events.')
    if (m.status === 'playing') {
      if (s.status !== 'active') throw new Error('A completed session contains an active match.')
      for (const key of [`court:${s.id}:${m.court}`, ...participants.map((p) => `player:${p}`)]) {
        if (occupied.has(key)) throw new Error('An active court or player is assigned twice.')
        occupied.add(key)
      }
    }
  }
  return parsed
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
