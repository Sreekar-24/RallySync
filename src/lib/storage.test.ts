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
  type SyncConfig,
} from './storage'

const at = 1_700_000_000_000

function fixture(): AppData {
  const playerIds = Array.from({ length: 8 }, (_, index) => `p${index}`)
  return {
    version: 1,
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
    expect(() => validateData({ ...fixture(), version: 2 })).toThrow()
    expect(() => validateData({ ...fixture(), players: 'not-an-array' })).toThrow()
    const input = fixture()
    input.players[0].level = 6
    expect(() => validateData(input)).toThrow()
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
    const replacement: AppData = { version: 1, players: [], sessions: [], matches: [] }
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
