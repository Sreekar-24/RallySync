// Run: node scripts/benchmark-journal.mjs
// Measures synchronous serialization/recovery-journal work, excluding IndexedDB
// transactions and physical device storage latency. No user data is read.
import 'fake-indexeddb/auto'
import { performance } from 'node:perf_hooks'
import { createServer } from 'vite'

const values = new Map()
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
}
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { emptySync, journalState, saveState } = await server.ssrLoadModule('/src/lib/storage.ts')
  const at = 1_700_000_000_000
  const players = Array.from({ length: 8 }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    level: 3,
    createdAt: at,
  }))
  const samples = 12
  const output = []
  for (const count of [100, 1000, 5000]) {
    values.clear()
    const session = {
      id: 'session',
      name: 'Benchmark',
      startedAt: at,
      format: 'doubles',
      courtCount: 1,
      target: 21,
      winBy: 2,
      cap: 30,
      bestOf: 1,
      mode: 'balanced',
      playerIds: players.map((p) => p.id),
      availablePlayerIds: players.map((p) => p.id),
      status: 'active',
    }
    const matches = Array.from({ length: count }, (_, i) => ({
      id: `m${i}`,
      sessionId: session.id,
      court: 1,
      teamA: ['p0', 'p1'],
      teamB: ['p2', 'p3'],
      startedAt: at + i * 1_000_000,
      ...(i < count - 1 ? { endedAt: at + i * 1_000_000 + 600_000 } : {}),
      status: i < count - 1 ? 'completed' : 'playing',
      revision: 36,
      actions:
        i === count - 1
          ? []
          : Array.from({ length: 36 }, (_, n) => ({
              id: `${i}-point-${n}`,
              kind: 'point',
              side: n % 2 === 0 || n >= 30 ? 'A' : 'B',
              at: at + i * 1_000_000 + n * 10_000,
            })),
    }))
    let state = {
      id: 'main',
      data: { version: 2, players, sessions: [session], matches },
      sync: emptySync(),
      saveId: `base-${count}`,
      generation: 1,
    }
    await saveState(state)
    // Warm up the serializer before measurement.
    JSON.stringify(state)
    let fullMs = 0
    let compactMs = 0
    let fullBytes = 0
    let compactBytes = 0
    for (let n = 0; n < samples; n++) {
      const next = {
        ...state,
        saveId: `save-${count}-${n}`,
        generation: state.generation + 1,
        data: {
          ...state.data,
          matches: state.data.matches.map((m, i) =>
            i === count - 1
              ? {
                  ...m,
                  revision: m.revision + 1,
                  actions: [
                    ...m.actions,
                    {
                      id: `new-${n}`,
                      kind: 'point',
                      side: 'A',
                      at: at + count * 1_000_000 + n * 1000,
                    },
                  ],
                }
              : m,
          ),
        },
      }
      let start = performance.now()
      const full = JSON.stringify(next)
      fullMs += performance.now() - start
      fullBytes = Buffer.byteLength(full)
      start = performance.now()
      journalState(next, state)
      compactMs += performance.now() - start
      compactBytes = Buffer.byteLength(values.get('rallysync-pending-save'))
      state = next
    }
    output.push({
      matches: count,
      fullSnapshotKB: Math.round(fullBytes / 1024),
      compactJournalKB: +(compactBytes / 1024).toFixed(1),
      fullSerializeMs: +(fullMs / samples).toFixed(2),
      compactJournalMs: +(compactMs / samples).toFixed(2),
    })
  }
  console.table(output)
} finally {
  await server.close()
}
