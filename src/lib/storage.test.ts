import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppData, Match } from '../domain/model'
import {
  emptySync,
  journalState,
  loadState,
  readBackup,
  saveState,
  validateData,
  type SavedState,
  type SyncConfig,
} from './storage'

const at = 1_700_000_000_000

function fixture(): AppData {
  const playerIds = Array.from({ length: 8 }, (_, index) => `p${index}`)
  return {
    version: 2,
    players: playerIds.map((id, index) => ({
      id,
      name: `Player ${index + 1}`,
      level: 3,
      createdAt: at,
    })),
    sessions: [
      {
        id: 'session',
        name: 'Weekend badminton',
        startedAt: at,
        format: 'doubles',
        courtCount: 2,
        target: 21,
        winBy: 2,
        cap: 30,
        bestOf: 1,
        mode: 'balanced',
        playerIds,
        availablePlayerIds: playerIds,
        attendance: playerIds.map((playerId) => ({ playerId, at, available: true })),
        status: 'active',
      },
    ],
    matches: [
      {
        id: 'match',
        sessionId: 'session',
        court: 1,
        teamA: ['p0', 'p1'],
        teamB: ['p2', 'p3'],
        startedAt: at,
        status: 'playing',
        revision: 1,
        actions: [{ id: 'point', kind: 'point', side: 'A', at: at + 1000 }],
      },
    ],
  }
}

function secondMatch(overrides: Partial<Match> = {}): Match {
  return {
    ...fixture().matches[0],
    id: 'match-2',
    court: 2,
    teamA: ['p4', 'p5'],
    teamB: ['p6', 'p7'],
    ...overrides,
  }
}

describe('backup validation', () => {
  it('preserves attendance, action history, and all linked records without mutating the input', () => {
    const input = fixture()
    input.sessions[0].attendance!.push({ playerId: 'p7', at: at + 5000, available: false })
    const before = JSON.stringify(input)
    const parsed = validateData(input)
    expect(parsed).toEqual(input)
    expect(parsed).not.toBe(input)
    expect(parsed.sessions[0].attendance).not.toBe(input.sessions[0].attendance)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('accepts legacy sessions without the optional attendance log', () => {
    const input = fixture()
    delete input.sessions[0].attendance
    expect(validateData(input)).toEqual(input)
  })

  it.each(['players', 'sessions', 'matches'] as const)('rejects duplicate %s record IDs', (key) => {
    const input = fixture()
    if (key === 'players') input.players.push({ ...input.players[0] })
    if (key === 'sessions') input.sessions.push({ ...input.sessions[0] })
    if (key === 'matches') input.matches.push({ ...input.matches[0] })
    expect(() => validateData(input)).toThrow('duplicate record IDs')
  })

  it('rejects more than one active session', () => {
    const input = fixture()
    input.sessions.push({ ...input.sessions[0], id: 'other-session' })
    expect(() => validateData(input)).toThrow('Only one active session')
  })

  it('allows multiple historical sessions alongside the active one', () => {
    const input = fixture()
    input.sessions.push({
      ...input.sessions[0],
      id: 'historical',
      status: 'completed',
      endedAt: at + 5000,
    })
    expect(validateData(input).sessions).toHaveLength(2)
  })

  it('rejects unavailable references, duplicate membership, and impossible scoring settings', () => {
    const mutations = [
      (input: AppData) => {
        input.sessions[0].playerIds.push('unknown')
      },
      (input: AppData) => {
        input.sessions[0].availablePlayerIds = ['unknown']
      },
      (input: AppData) => {
        input.sessions[0].playerIds = ['p0', 'p0']
      },
      (input: AppData) => {
        input.sessions[0].availablePlayerIds = ['p0', 'p0']
      },
      (input: AppData) => {
        input.sessions[0].cap = 20
      },
      (input: AppData) => {
        input.sessions[0].attendance!.push({ playerId: 'unknown', at, available: true })
      },
    ]
    for (const mutate of mutations) {
      const input = fixture()
      mutate(input)
      expect(() => validateData(input)).toThrow('Invalid session settings or player references')
    }
  })

  it('rejects missing sessions, wrong team sizes, overlapping sides, and out-of-range courts', () => {
    const mutations = [
      (input: AppData) => {
        input.matches[0].sessionId = 'unknown'
      },
      (input: AppData) => {
        input.matches[0].teamA = ['p0']
      },
      (input: AppData) => {
        input.matches[0].teamB = ['p1', 'p3']
      },
      (input: AppData) => {
        input.matches[0].court = 3
      },
      (input: AppData) => {
        input.matches[0].teamA = ['unknown', 'p1']
      },
    ]
    for (const mutate of mutations) {
      const input = fixture()
      mutate(input)
      expect(() => validateData(input)).toThrow('Invalid match participants or court')
    }
  })

  it('rejects assigning a court twice, even with disjoint participants', () => {
    const input = fixture()
    input.matches.push(secondMatch({ court: 1 }))
    expect(() => validateData(input)).toThrow('assigned twice')
  })

  it('rejects assigning a player to two active courts', () => {
    const input = fixture()
    input.matches.push(secondMatch({ teamA: ['p0', 'p5'] }))
    expect(() => validateData(input)).toThrow('assigned twice')
  })

  it('allows separate courts and reuse after a prior match stops', () => {
    const input = fixture()
    input.matches.push(secondMatch())
    expect(validateData(input).matches).toHaveLength(2)
    input.matches[0].status = 'abandoned'
    input.matches.push(
      secondMatch({ id: 'third', court: 1, teamA: ['p0', 'p1'], teamB: ['p2', 'p3'] }),
    )
    expect(validateData(input).matches).toHaveLength(3)
  })

  it('rejects active matches inside completed sessions', () => {
    const input = fixture()
    input.sessions[0].status = 'completed'
    expect(() => validateData(input)).toThrow('completed session contains an active match')
  })

  it('rejects duplicate action IDs and points without a side', () => {
    const input = fixture()
    input.matches[0].actions.push({ ...input.matches[0].actions[0] })
    expect(() => validateData(input)).toThrow('Invalid scoring events')
    input.matches[0].actions = [{ id: 'bad', kind: 'point', at }]
    expect(() => validateData(input)).toThrow('Invalid scoring events')
  })

  it('rejects unsupported versions and malformed field types', () => {
    expect(() => validateData({ ...fixture(), version: 3 })).toThrow()
    expect(() => validateData({ ...fixture(), players: 'not-an-array' })).toThrow()
    const input = fixture()
    input.players[0].level = 6
    expect(() => validateData(input)).toThrow()
  })
})

describe('compact recovery journals', () => {
  beforeEach(async () => {
    const database = new Dexie('rallysync')
    database.version(1).stores({ snapshots: 'id' })
    await database.table('snapshots').clear()
    database.close()
  })

  async function usingJournal(run: (values: Map<string, string>) => Promise<void>) {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
    try {
      await run(values)
    } finally {
      vi.unstubAllGlobals()
    }
  }
  const baseState = (): SavedState => ({
    id: 'main',
    data: fixture(),
    sync: emptySync(),
    saveId: 'base',
    generation: 1,
  })
  const rename = (state: SavedState, name: string, saveId: string): SavedState => ({
    ...state,
    saveId,
    generation: state.generation! + 1,
    data: {
      ...state.data,
      players: state.data.players.map((p, i) => (i === 0 ? { ...p, name } : p)),
    },
  })

  it('writes only changed records and recovers an uncommitted score', async () => {
    await usingJournal(async (values) => {
      const base = baseState()
      await saveState(base)
      const next = {
        ...base,
        saveId: 'point-2',
        generation: 2,
        data: {
          ...base.data,
          matches: base.data.matches.map((m) => ({
            ...m,
            revision: 2,
            actions: [
              ...m.actions,
              { id: 'point-2', kind: 'point' as const, side: 'B' as const, at: at + 2000 },
            ],
          })),
        },
      }
      journalState(next, base)
      const journal = JSON.parse(values.get('rallysync-pending-save')!)
      expect(journal.kind).toBe('overlay-v1')
      expect(Object.keys(journal.patches)).toEqual(['matches'])
      expect(journal.patches.matches.upserts).toHaveLength(1)
      expect(await loadState()).toEqual(next)
      await saveState(next)
      expect(values.has('rallysync-pending-save')).toBe(false)
    })
  })

  it('preserves a reversion when an older queued snapshot commits first', async () => {
    await usingJournal(async (values) => {
      const base = baseState()
      await saveState(base)
      const first = rename(base, 'Temporary name', 'first')
      journalState(first, base)
      const next = rename(first, base.data.players[0].name, 'reverted')
      journalState(next, first)
      await saveState(first)
      expect(values.has('rallysync-pending-save')).toBe(true)
      expect(await loadState()).toEqual(next)
    })
  })

  it('retains earlier touches across later changes to other collections', async () => {
    await usingJournal(async () => {
      const base = baseState()
      await saveState(base)
      const first = rename(base, 'Updated player', 'first')
      journalState(first, base)
      const next = {
        ...first,
        saveId: 'second',
        generation: 3,
        data: {
          ...first.data,
          sessions: first.data.sessions.map((s) => ({ ...s, name: 'Updated session' })),
        },
      }
      journalState(next, first)
      await saveState(first)
      expect(await loadState()).toEqual(next)
    })
  })

  it('recovers deletions and reordered records over an intermediate saved snapshot', async () => {
    await usingJournal(async () => {
      const base = baseState()
      const guest = { id: 'guest', name: 'Guest', level: 3, createdAt: at }
      base.data = { ...base.data, players: [...base.data.players, guest] }
      await saveState(base)
      const first = {
        ...base,
        saveId: 'deleted',
        generation: 2,
        data: {
          ...base.data,
          players: base.data.players.filter((p) => p.id !== 'guest').reverse(),
        },
      }
      journalState(first, base)
      const next = {
        ...first,
        saveId: 'reinserted',
        generation: 3,
        data: {
          ...first.data,
          players: [guest, ...first.data.players],
        },
      }
      journalState(next, first)
      await saveState(first)
      expect(await loadState()).toEqual(next)
    })
  })

  it('refuses an overlay whose saved base is missing or unrelated', async () => {
    await usingJournal(async () => {
      const base = baseState()
      await saveState(base)
      journalState(rename(base, 'Updated player', 'first'), base)
      const database = new Dexie('rallysync')
      database.version(1).stores({ snapshots: 'id' })
      await database.table('snapshots').put({ ...base, saveId: 'unrelated' })
      await expect(loadState()).rejects.toThrow('does not match')
      await database.table('snapshots').clear()
      await expect(loadState()).rejects.toThrow('does not match')
      database.close()
    })
  })

  it('keeps a final deletion when an earlier pending rename commits first', async () => {
    await usingJournal(async () => {
      const base = baseState()
      base.data = {
        ...base.data,
        players: [
          ...base.data.players,
          {
            id: 'guest',
            name: 'Guest',
            level: 3,
            createdAt: at,
          },
        ],
      }
      await saveState(base)
      const first = rename(base, 'Updated player', 'first')
      journalState(first, base)
      const next = {
        ...first,
        saveId: 'deleted',
        generation: 3,
        data: {
          ...first.data,
          players: first.data.players.filter((p) => p.id !== 'guest'),
        },
      }
      journalState(next, first)
      await saveState(first)
      expect(await loadState()).toEqual(next)
      expect((await loadState())?.data.players.some((p) => p.id === 'guest')).toBe(false)
    })
  })

  it('falls back to a full snapshot after a failed journal write', async () => {
    await usingJournal(async (values) => {
      const base = baseState()
      await saveState(base)
      const first = rename(base, 'First update', 'first')
      const setItem = localStorage.setItem
      localStorage.setItem = () => {
        throw new Error('quota')
      }
      expect(() => journalState(first, base)).toThrow('quota')
      localStorage.setItem = setItem
      const next = rename(first, 'Latest update', 'second')
      journalState(next, first)
      expect(JSON.parse(values.get('rallysync-pending-save')!).data).toEqual(next.data)
      expect(await loadState()).toEqual(next)
    })
  })

  it('can recover a self-contained legacy journal even when IndexedDB reads fail', async () => {
    await usingJournal(async () => {
      const state = baseState()
      journalState(state)
      const database = new Dexie('rallysync')
      database.version(1).stores({ snapshots: 'id' })
      const tablePrototype = Object.getPrototypeOf(database.table('snapshots'))
      const get = vi
        .spyOn(tablePrototype, 'get')
        .mockRejectedValueOnce(new Error('disk unavailable'))
      try {
        expect(await loadState()).toEqual(state)
      } finally {
        get.mockRestore()
        database.close()
      }
    })
  })

  it('ignores a stale journal after a newer transaction has completed', async () => {
    await usingJournal(async (values) => {
      const base = baseState()
      await saveState(base)
      const first = rename(base, 'First update', 'first')
      journalState(first, base)
      const staleJournal = values.get('rallysync-pending-save')!
      const next = rename(first, 'Latest update', 'second')
      await saveState(next)
      values.set('rallysync-pending-save', staleJournal)
      expect(await loadState()).toEqual(next)
      expect(values.has('rallysync-pending-save')).toBe(false)
    })
  })
})

describe('backup file import', () => {
  it('round-trips the exported JSON envelope, including attendance', async () => {
    const input = fixture()
    const file = new File(
      [JSON.stringify({ app: 'RallySync', exportedAt: new Date(at).toISOString(), data: input })],
      'backup.json',
      { type: 'application/json' },
    )
    expect(await readBackup(file)).toEqual(input)
  })

  it('also reads a raw valid data snapshot', async () => {
    expect(await readBackup(new File([JSON.stringify(fixture())], 'raw.json'))).toEqual(fixture())
  })

  it('rejects malformed JSON and JSON that is not application data', async () => {
    await expect(readBackup(new File(['{not json'], 'broken.json'))).rejects.toThrow()
    for (const value of [null, [], 'hello', { data: null }]) {
      await expect(readBackup(new File([JSON.stringify(value)], 'invalid.json'))).rejects.toThrow()
    }
  })

  it('rejects files exceeding the import limit before parsing', async () => {
    const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'oversized.json')
    await expect(readBackup(file)).rejects.toThrow('smaller than 10 MB')
  })
})

describe('IndexedDB persistence', () => {
  beforeEach(async () => {
    const database = new Dexie('rallysync')
    database.version(1).stores({ snapshots: 'id' })
    await database.table('snapshots').clear()
    database.close()
  })

  it('returns undefined on a fresh installation', async () => {
    expect(await loadState()).toBeUndefined()
  })

  it('stores a complete snapshot and sync state without retaining mutable references', async () => {
    const input = fixture()
    const expected = structuredClone(input)
    const sync: SyncConfig = {
      ...emptySync(),
      endpoint: 'https://script.google.com/macros/s/example/exec',
      revision: 4,
      dirty: true,
      mutationId: 'mutation-1',
      lastSyncAt: at,
    }
    const expectedSync = { ...sync }
    await saveState({ id: 'main', data: input, sync })
    input.players[0].name = 'Changed after save'
    sync.revision = 99
    const loaded = await loadState()
    expect(loaded).toEqual({ id: 'main', data: expected, sync: expectedSync })
    loaded!.data.players[0].name = 'Changed after load'
    expect((await loadState())!.data.players[0].name).toBe(expected.players[0].name)
  })

  it('replaces the previous snapshot instead of combining unrelated states', async () => {
    await saveState({ id: 'main', data: fixture(), sync: emptySync() })
    const replacement: AppData = { version: 2, players: [], sessions: [], matches: [] }
    await saveState({ id: 'main', data: replacement, sync: emptySync() })
    expect((await loadState())!.data).toEqual(replacement)
  })

  it('restores default sync fields for older saved metadata', async () => {
    await saveState({ id: 'main', data: fixture(), sync: { revision: 2 } as SyncConfig })
    expect((await loadState())!.sync).toEqual({ ...emptySync(), revision: 2 })
  })

  it('validates a persisted snapshot before returning it to the application', async () => {
    const invalid = fixture()
    invalid.matches[0].sessionId = 'missing'
    await saveState({ id: 'main', data: invalid, sync: emptySync() })
    await expect(loadState()).rejects.toThrow('Invalid match participants or court')
  })

  it('recovers the latest action even before IndexedDB finishes and clears only committed journal entries', async () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
    try {
      const old = { id: 'main', data: fixture(), sync: emptySync(), saveId: 'old', generation: 1 }
      const next = {
        ...old,
        data: {
          ...fixture(),
          players: fixture().players.map((p) => ({ ...p, name: `Latest ${p.name}` })),
        },
        saveId: 'new',
        generation: 2,
      }
      journalState(next)
      await saveState(old)
      expect((await loadState())?.data.players[0].name).toBe('Latest Player 1')
      expect(values.has('rallysync-pending-save')).toBe(true)
      await saveState(next)
      expect(values.has('rallysync-pending-save')).toBe(false)
      expect((await loadState())?.data.players[0].name).toBe('Latest Player 1')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('v2 migration and planning/credit records', () => {
  function extended(): AppData {
    const data = fixture()
    const session = data.sessions[0]
    session.scoringMode = 'combined'
    session.planning = {
      basis: 'matches',
      matchCount: 8,
      durationMinutes: 120,
      matchMinutes: 12,
      changeoverMinutes: 2,
      weights: { fairness: 5, rest: 4, balance: 3, variety: 2, partnership: 1, contribution: 0 },
    }
    session.availability = { p7: { from: at + 60000, until: at + 120000 } }
    session.plan = {
      revision: 2,
      generatedAt: at,
      warnings: ['Times are estimates.'],
      slots: [
        {
          id: 'slot-1',
          court: 1,
          round: 1,
          startsAt: at,
          teamA: ['p0', 'p1'],
          teamB: ['p2', 'p3'],
          locked: true,
          matchId: 'match',
          reason: 'Organizer lineup',
        },
        {
          id: 'slot-2',
          court: 2,
          round: 1,
          startsAt: at,
          teamA: ['p4', 'p5'],
          teamB: ['p6', 'p7'],
          locked: false,
          reason: 'Fair rest distribution',
        },
      ],
    }
    data.matches[0].planSlotId = 'slot-1'
    data.matches[0].actions = [
      { id: 'credited', kind: 'point', side: 'A', playerId: 'p0', at: at + 1000 },
      {
        id: 'corrected',
        kind: 'adjust',
        scores: [{ a: 5, b: 3, credits: { p0: 2, p1: 1, p2: 3 } }],
        at: at + 2000,
      },
    ]
    return data
  }

  it('migrates v1 without inventing individual points or changing source data', () => {
    const legacy = { ...fixture(), version: 1 as const }
    const result = validateData(legacy)
    expect(result.version).toBe(2)
    expect(legacy.version).toBe(1)
    expect(result.matches[0].actions).toEqual(legacy.matches[0].actions)
    expect(result.matches[0].actions[0].playerId).toBeUndefined()
  })

  it('accepts the known legacy recommendation reason without losing match results', () => {
    const legacy = {
      ...fixture(),
      version: 1 as const,
      matches: fixture().matches.map((match) => ({
        ...match,
        reason: 'Prioritizes less court time.',
      })),
    }
    const migrated = validateData(legacy)
    expect(migrated.matches).toEqual(fixture().matches)
    expect(legacy.matches[0].reason).toBe('Prioritizes less court time.')
    expect(() => validateData({ ...legacy, version: 2 })).toThrow()
  })

  it('round-trips the entire v2 schedule, availability, credit, and correction history', async () => {
    const data = extended()
    expect(validateData(data)).toEqual(data)
    expect(await readBackup(new File([JSON.stringify({ data })], 'v2.json'))).toEqual(data)
  })

  it('rejects unknown future fields instead of silently discarding them', () => {
    const data = { ...extended(), futureRules: { meaning: 'must not be lost' } }
    expect(() => validateData(data)).toThrow()
  })

  it('rejects attributed points belonging to the opposing side or a non-participant', () => {
    const data = extended()
    data.matches[0].actions[0].playerId = 'p2'
    expect(() => validateData(data)).toThrow('Invalid scoring events')
    data.matches[0].actions[0].playerId = 'unknown'
    expect(() => validateData(data)).toThrow('Invalid scoring events')
  })

  it('rejects excessive, negative, or foreign-player correction credits', () => {
    const invalidCredits: Record<string, number>[] = [
      { p0: 6 },
      { p2: 4 },
      { p0: -1 },
      { unknown: 1 },
    ]
    for (const credits of invalidCredits) {
      const data = extended()
      data.matches[0].actions[1].scores![0].credits = credits
      expect(() => validateData(data)).toThrow()
    }
  })

  it('rejects invalid cap scores and games after a clinched match', () => {
    const data = extended()
    data.matches[0].actions[1].scores = [{ a: 30, b: 0 }]
    expect(() => validateData(data)).toThrow('Invalid adjusted game score')
    data.sessions[0].bestOf = 3
    data.matches[0].actions[1].scores = [
      { a: 21, b: 10 },
      { a: 21, b: 12 },
      { a: 0, b: 0 },
    ]
    expect(() => validateData(data)).toThrow('after the match was won')
  })

  it('rejects invalid schedule links, duplicate reservations, and availability windows', () => {
    const changes = [
      (d: AppData) => {
        d.sessions[0].plan!.slots[0].matchId = 'unknown'
      },
      (d: AppData) => {
        d.matches[0].planSlotId = 'unknown'
      },
      (d: AppData) => {
        d.sessions[0].plan!.slots[1].teamA = ['p4', 'p4']
      },
      (d: AppData) => {
        d.sessions[0].plan!.slots.push({ ...d.sessions[0].plan!.slots[1], id: 'slot-3' })
      },
      (d: AppData) => {
        d.sessions[0].availability!.p7 = { from: at + 100, until: at }
      },
      (d: AppData) => {
        d.sessions[0].availability!.unknown = { from: at }
      },
    ]
    for (const change of changes) {
      const data = extended()
      change(data)
      expect(() => validateData(data)).toThrow()
    }
  })

  it('rejects timestamps outside the JavaScript Date range', () => {
    const data = extended()
    data.players[0].createdAt = 1e30
    expect(() => validateData(data)).toThrow()
  })
})

describe('serving and point-removal backups', () => {
  it('preserves current-score position checkpoints, plus, minus, and undo history', async () => {
    const { configureService, getServiceState } = await import('../domain/serving')
    const { removePoint } = await import('../domain/engine')
    const input = fixture()
    input.matches[0] = configureService(
      input.matches[0],
      input.sessions[0],
      {
        positions: { A: ['p1', 'p0'], B: ['p2', 'p3'] },
        servingSide: 'B',
        nearSide: 'B',
      },
      at + 2000,
    )
    input.matches[0] = removePoint(input.matches[0], input.sessions[0], 'A', undefined, at + 3000)
    const parsed = validateData(input)
    expect(parsed).toEqual(input)
    expect(getServiceState(parsed.matches[0], parsed.sessions[0]).status).toBe('check')
  })

  it('rejects invalid position ownership, action anchors, and score checkpoints', async () => {
    const { configureService } = await import('../domain/serving')
    const mutations = [
      (input: AppData) => {
        input.matches[0].serviceSetup!.positions.A = ['p0', 'p2']
      },
      (input: AppData) => {
        input.matches[0].serviceSetup!.positions.B = ['p2', 'p2']
      },
      (input: AppData) => {
        input.matches[0].serviceSetup!.afterActionId = 'missing'
      },
      (input: AppData) => {
        input.matches[0].serviceSetup!.a = 9
      },
      (input: AppData) => {
        input.matches[0].serviceSetup!.game = 2
      },
    ]
    for (const mutation of mutations) {
      const input = fixture()
      input.matches[0] = configureService(input.matches[0], input.sessions[0], {
        positions: { A: ['p0', 'p1'], B: ['p2', 'p3'] },
        servingSide: 'A',
      })
      mutation(input)
      expect(() => validateData(input)).toThrow()
    }
  })

  it('rejects removal events targeting unknown, future, non-rally, or wrong-side events', () => {
    for (const targetId of ['missing', 'future', 'remove']) {
      const input = fixture()
      input.matches[0].actions.push(
        { id: 'remove', kind: 'remove', side: 'A', targetId, at: at + 2000 },
        { id: 'future', kind: 'point', side: 'A', at: at + 3000 },
      )
      expect(() => validateData(input)).toThrow('earlier rally')
    }
    const wrongSide = fixture()
    wrongSide.matches[0].actions.push({
      id: 'remove',
      kind: 'remove',
      side: 'B',
      targetId: 'point',
      at: at + 2000,
    })
    expect(() => validateData(wrongSide)).toThrow('same side')
    const nonRally = fixture()
    nonRally.matches[0].actions.push(
      { id: 'undo', kind: 'undo', at: at + 1000 },
      { id: 'remove', kind: 'remove', side: 'A', targetId: 'undo', at: at + 2000 },
    )
    expect(() => validateData(nonRally)).toThrow('earlier rally')
  })
})
