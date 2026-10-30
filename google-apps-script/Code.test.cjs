// Node-only contract tests. These exercise the real Apps Script source with a
// small spreadsheet/runtime double; they do not claim a deployed Google test.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const crypto = require('node:crypto')
const path = require('node:path')

class Range {
  constructor(sheet, r, c, nr = 1, nc = 1) {
    Object.assign(this, { sheet, r, c, nr, nc })
  }
  setValues(rows) {
    if (this.sheet.failWrite) {
      this.sheet.failWrite = false
      throw Error('simulated write failure')
    }
    rows.forEach((row, i) =>
      row.forEach((value, j) => {
        this.sheet.rows[this.r - 1 + i] ??= []
        this.sheet.rows[this.r - 1 + i][this.c - 1 + j] = value
      }),
    )
    return this
  }
  getValues() {
    return Array.from({ length: this.nr }, (_, i) =>
      Array.from(
        { length: this.nc },
        (_, j) => this.sheet.rows[this.r - 1 + i]?.[this.c - 1 + j] ?? '',
      ),
    )
  }
  setFontWeight() {
    return this
  }
}

class Sheet {
  constructor() {
    this.rows = []
    this.max = 1000
  }
  getLastRow() {
    return this.rows.length
  }
  getRange(...args) {
    return new Range(this, ...args)
  }
  setFrozenRows() {}
  getMaxRows() {
    return this.max
  }
  insertRowsAfter(_, count) {
    this.max += count
  }
  deleteRow(row) {
    this.rows.splice(row - 1, 1)
  }
}

function harness({ configured = true } = {}) {
  const book = {
    id: 'test-book',
    sheets: {},
    getId() {
      return this.id
    },
    getSheetByName(name) {
      return this.sheets[name] || null
    },
    insertSheet(name) {
      return (this.sheets[name] = new Sheet())
    },
  }
  const properties = {}
  let busy = false
  const context = {
    console: { log() {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => book, openById: () => book, flush() {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => properties[key] || null,
        setProperty: (key, value) => (properties[key] = value),
      }),
    },
    LockService: {
      getScriptLock: () => ({ waitLock() {}, tryLock: () => !busy, releaseLock() {} }),
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      Charset: { UTF_8: 'utf8' },
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (_, raw) => [...crypto.createHash('sha256').update(raw).digest()],
      base64Encode: (raw) => Buffer.from(raw).toString('base64'),
      base64Decode: (raw) => Buffer.from(raw, 'base64'),
      newBlob: (raw) => ({ getDataAsString: () => Buffer.from(raw).toString('utf8') }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (raw) => ({
        raw,
        setMimeType() {
          return this
        },
      }),
    },
  }
  vm.createContext(context)
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8'), context)
  const decode = (value) => JSON.parse(value.raw)
  if (configured) context.setup()
  return {
    book,
    context,
    setBusy: (value) => {
      busy = value
    },
    pull: () => decode(context.doGet({ parameter: { action: 'pull' } })),
    push: (data, revision, mutationId, action = 'push') =>
      decode(
        context.doPost({
          postData: {
            contents: JSON.stringify({ action, data, expectedRevision: revision, mutationId }),
          },
        }),
      ),
    decode,
  }
}

function fixture() {
  return {
    version: 2,
    players: ['p1', 'p2', 'p3', 'p4'].map((id, index) => ({
      id,
      name: `Player ${index + 1}`,
      level: 3,
      createdAt: 1,
    })),
    sessions: [
      {
        id: 'session1',
        name: 'Sunday games',
        startedAt: 10,
        format: 'singles',
        courtCount: 2,
        target: 21,
        winBy: 2,
        cap: 30,
        bestOf: 1,
        mode: 'balanced',
        playerIds: ['p1', 'p2', 'p3', 'p4'],
        availablePlayerIds: ['p1', 'p2', 'p3', 'p4'],
        attendance: [
          { playerId: 'p1', at: 10, available: true },
          { playerId: 'p1', at: 20, available: false },
        ],
        status: 'active',
      },
    ],
    matches: [
      {
        id: 'match1',
        sessionId: 'session1',
        court: 1,
        teamA: ['p1'],
        teamB: ['p2'],
        startedAt: 11,
        status: 'playing',
        actions: [{ id: 'action1', kind: 'point', side: 'A', at: 12 }],
        revision: 1,
      },
    ],
  }
}

test('empty store, full snapshot round-trip, and repeat setup preserve data and attendance', () => {
  const api = harness()
  assert.deepEqual(api.pull(), { ok: true, data: null, revision: 0, updatedAt: 0 })
  const data = fixture()
  const written = api.push(data, 0, 'mutation-one')
  assert.equal(written.ok, true)
  assert.equal(written.revision, 1)
  assert.ok(written.updatedAt > 0)
  assert.deepEqual(written.data, data)
  api.context.setup()
  assert.deepEqual(api.pull().data, data)
})

test('recorded pauses and play end round-trip without altering result confirmation', () => {
  const api = harness(),
    data = fixture()
  data.matches[0].timing = { pauses: [{ from: 13, to: 15 }, { from: 18 }], finishedAt: 20 }
  data.matches[0].endedAt = 25
  data.matches[0].status = 'abandoned'
  const result = api.push(data, 0, 'timing-clock')
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.deepEqual(api.pull().data.matches[0].timing, data.matches[0].timing)
})

test('invalid recorded timing cannot overwrite shared history', () => {
  const api = harness(),
    data = fixture()
  api.push(data, 0, 'original-clock')
  for (const timing of [
    { pauses: [{ from: 10, to: 15 }] },
    { pauses: [{ from: 13, to: 18 }, { from: 16 }] },
    { pauses: [{ from: 13 }, { from: 16 }] },
    { pauses: [], finishedAt: 10 },
    { pauses: [{ from: 13, to: 12 }] },
  ]) {
    const bad = structuredClone(data)
    bad.matches[0].timing = timing
    assert.equal(api.push(bad, 1, 'bad-clock').code, 'INVALID_DATA')
  }
  assert.equal(api.pull().revision, 1)
  assert.deepEqual(api.pull().data, data)
})

test('lost-ack retry is idempotent; reused mutation IDs cannot change the payload', () => {
  const api = harness(),
    data = fixture()
  api.push(data, 0, 'mutation-one')
  assert.equal(api.push(data, 0, 'mutation-one').revision, 1)
  const different = fixture()
  different.players[0].name = 'Different player'
  assert.equal(api.push(different, 0, 'mutation-one').code, 'INVALID_MUTATION')
  assert.deepEqual(api.pull().data, data)
})

test('stale writers and initialization of existing history cannot overwrite it', () => {
  const api = harness(),
    data = fixture()
  api.push(data, 0, 'mutation-one', 'initialize')
  const stale = api.push(data, 0, 'mutation-two')
  assert.equal(stale.code, 'CONFLICT')
  assert.equal(stale.revision, 1)
  assert.equal(api.push(data, 1, 'mutation-two', 'initialize').code, 'CONFLICT')
})

test('failed payload or manifest writes keep the old snapshot readable; retry recovers', () => {
  for (const failureSheet of ['_RallyChunks', '_RallyState']) {
    const api = harness(),
      data = fixture()
    api.push(data, 0, 'mutation-one')
    const next = fixture()
    next.players[0].name = 'Updated name'
    api.book.sheets[failureSheet].failWrite = true
    assert.equal(api.push(next, 1, 'mutation-two').code, 'STORAGE_ERROR')
    assert.deepEqual(api.pull().data, data)
    assert.equal(api.push(next, 1, 'mutation-two').revision, 2)
    assert.deepEqual(api.pull().data, next)
  }
})

test('multi-chunk Unicode payload round-trips; only current and previous snapshots remain', () => {
  const api = harness()
  const big = {
    version: 2,
    players: Array.from({ length: 900 }, (_, i) => ({
      id: `p${i}`,
      name: `Player ${i} 🏸 =safe`,
      level: 3,
      createdAt: 1,
    })),
    sessions: [],
    matches: [],
  }
  for (let revision = 0; revision < 4; revision++) {
    big.players[0].name = `Revision ${revision} 🏸`
    assert.equal(api.push(big, revision, `mutation-${revision}`).revision, revision + 1)
  }
  assert.deepEqual(api.pull().data, big)
  assert.ok(api.book.sheets._RallyState.rows[1][2] > 1)
  const retained = new Set(api.book.sheets._RallyChunks.rows.slice(1).map((row) => row[0]))
  assert.equal(retained.size, 2)
})

test('checksum corruption is reported rather than returning damaged data', () => {
  const api = harness()
  api.push(fixture(), 0, 'mutation-one')
  api.book.sheets._RallyChunks.rows[1][2] = 'b64:bad'
  assert.equal(api.pull().code, 'STORAGE_ERROR')
})

test('malformed schemas, unknown references, and invalid attendance are rejected', () => {
  const api = harness()
  const cases = [
    { ...fixture(), version: 3 },
    { ...fixture(), players: [] },
    { ...fixture(), matches: [{ ...fixture().matches[0], teamA: ['unknown'] }] },
    {
      ...fixture(),
      sessions: [
        {
          ...fixture().sessions[0],
          attendance: [{ playerId: 'unknown', at: 20, available: true }],
        },
      ],
    },
    {
      ...fixture(),
      sessions: [
        { ...fixture().sessions[0], attendance: [{ playerId: 'p1', at: 20, available: 'yes' }] },
      ],
    },
  ]
  for (const data of cases) assert.equal(api.push(data, 0, 'mutation-one').code, 'INVALID_DATA')
  assert.equal(api.pull().revision, 0)
})

test('double-booked players, courts, and active sessions are rejected', () => {
  const api = harness()
  for (const second of [
    { ...fixture().matches[0], id: 'match2', court: 2 },
    { ...fixture().matches[0], id: 'match2', teamA: ['p3'], teamB: ['p4'] },
  ]) {
    assert.equal(
      api.push({ ...fixture(), matches: [...fixture().matches, second] }, 0, 'mutation-one').code,
      'INVALID_DATA',
    )
  }
  assert.equal(
    api.push(
      {
        ...fixture(),
        sessions: [...fixture().sessions, { ...fixture().sessions[0], id: 'session2' }],
      },
      0,
      'mutation-one',
    ).code,
    'INVALID_DATA',
  )
})

test('busy and unconfigured deployments return explicit failures', () => {
  const api = harness()
  api.setBusy(true)
  assert.equal(api.pull().code, 'BUSY')
  assert.equal(harness({ configured: false }).pull().code, 'NOT_CONFIGURED')
})

test('malformed requests, GET writes, and unsupported actions are rejected', () => {
  const api = harness()
  assert.equal(
    api.decode(api.context.doPost({ postData: { contents: 'not-json' } })).code,
    'INVALID_REQUEST',
  )
  assert.equal(api.decode(api.context.doGet({ parameter: { action: 'push' } })).code, 'METHOD')
  assert.equal(
    api.decode(api.context.doGet({ parameter: { action: 'delete' } })).code,
    'INVALID_ACTION',
  )
})

test('v1 writes migrate to v2 without inferred player attribution and retry consistently', () => {
  const api = harness(),
    data = fixture()
  data.version = 1
  const first = api.push(data, 0, 'legacy-mutation')
  assert.equal(first.ok, true)
  assert.equal(first.data.version, 2)
  assert.equal(first.data.matches[0].actions[0].playerId, undefined)
  assert.equal(data.version, 1)
  assert.equal(api.push(data, 0, 'legacy-mutation').revision, 1)
})

test('v2 plans, availability, attributed points and adjustments survive snapshot storage', () => {
  const api = harness(),
    data = fixture(),
    s = data.sessions[0],
    m = data.matches[0]
  s.scoringMode = 'combined'
  s.planning = {
    basis: 'matches',
    matchCount: 8,
    durationMinutes: 120,
    matchMinutes: 12,
    changeoverMinutes: 2,
    weights: { fairness: 5, rest: 4, balance: 3, variety: 2, partnership: 1, contribution: 0 },
  }
  s.availability = { p4: { from: 100, until: 1000 } }
  s.plan = {
    revision: 2,
    generatedAt: 10,
    warnings: ['Estimates only.'],
    slots: [
      {
        id: 'slot1',
        court: 1,
        round: 1,
        startsAt: 10,
        teamA: ['p1'],
        teamB: ['p2'],
        locked: true,
        matchId: 'match1',
        reason: 'Organizer assignment',
      },
      {
        id: 'slot2',
        court: 2,
        round: 1,
        startsAt: 10,
        teamA: ['p3'],
        teamB: ['p4'],
        locked: false,
        reason: 'Equal opportunity',
      },
    ],
  }
  m.planSlotId = 'slot1'
  m.actions = [
    { id: 'point', kind: 'point', side: 'A', playerId: 'p1', at: 12 },
    { id: 'adjust', kind: 'adjust', scores: [{ a: 5, b: 3, credits: { p1: 3, p2: 2 } }], at: 15 },
  ]
  assert.equal(api.push(data, 0, 'v2-mutation').ok, true)
  assert.deepEqual(api.pull().data, data)
  const mutations = [
    (d) => {
      d.matches[0].actions[0].playerId = 'p2'
    },
    (d) => {
      d.matches[0].actions[1].scores[0].credits = { p1: 6 }
    },
    (d) => {
      d.matches[0].actions[1].scores[0].credits = { unknown: 1 }
    },
    (d) => {
      d.matches[0].actions[1].scores = [{ a: 30, b: 0 }]
    },
    (d) => {
      d.sessions[0].plan.slots[0].matchId = 'unknown'
    },
    (d) => {
      d.sessions[0].plan.slots.push({ ...d.sessions[0].plan.slots[1], id: 'slot3' })
    },
    (d) => {
      d.sessions[0].availability.p4 = { from: 100, until: 20 }
    },
    (d) => {
      d.sessions[0].planning.weights.fairness = -1
    },
  ]
  for (const change of mutations) {
    const bad = JSON.parse(JSON.stringify(data))
    change(bad)
    assert.equal(api.push(bad, 1, 'invalid-new-v2').code, 'INVALID_DATA')
  }
  assert.deepEqual(api.pull().data, data)
})

test('known legacy recommendation fields migrate without blocking old real matches', () => {
  const api = harness(),
    data = fixture()
  data.version = 1
  data.matches[0].reason = 'Balanced recommendation'
  const result = api.push(data, 0, 'legacy-with-reason')
  assert.equal(result.ok, true)
  assert.equal(result.data.version, 2)
  assert.equal(result.data.matches[0].reason, undefined)
  assert.deepEqual(result.data.matches[0].actions, data.matches[0].actions)
  assert.equal(data.matches[0].reason, 'Balanced recommendation')
})

test('reads an already-stored v1 snapshot after verifying its original checksum', () => {
  const api = harness()
  api.push(fixture(), 0, 'before-upgrade')
  const legacy = fixture()
  legacy.version = 1
  legacy.matches[0].reason = 'Original v0.1 recommendation'
  const raw = JSON.stringify(legacy)
  api.book.sheets._RallyChunks.rows[1][2] = 'b64:' + Buffer.from(raw).toString('base64')
  api.book.sheets._RallyState.rows[1][5] = crypto.createHash('sha256').update(raw).digest('hex')
  const result = api.pull()
  assert.equal(result.ok, true)
  assert.equal(result.data.version, 2)
  assert.equal(result.data.matches[0].reason, undefined)
  assert.deepEqual(result.data.matches[0].actions, legacy.matches[0].actions)
})

test('rejects unknown v2 fields and prototype-property payloads instead of losing them', () => {
  const api = harness()
  const unknown = fixture()
  unknown.matches[0].futureScoring = true
  assert.equal(api.push(unknown, 0, 'unknown-fields').code, 'INVALID_DATA')
  const malicious = JSON.parse(
    JSON.stringify({ ...fixture(), version: 1 }).replace(
      '"players":',
      '"__proto__":{"injected":true},"players":',
    ),
  )
  assert.equal(api.push(malicious, 0, 'bad-prototype').code, 'INVALID_DATA')
  assert.equal(api.pull().revision, 0)
})

test('position checkpoints and minus events round-trip without losing original rally history', () => {
  const api = harness()
  const data = fixture()
  data.matches[0].serviceSetup = {
    game: 1,
    a: 1,
    b: 0,
    afterActionId: 'action1',
    positions: { A: ['p1'], B: ['p2'] },
    servingSide: 'A',
    nearSide: 'B',
    at: 13,
  }
  data.matches[0].actions.push({
    id: 'remove1',
    kind: 'remove',
    side: 'A',
    targetId: 'action1',
    at: 14,
  })
  assert.equal(api.push(data, 0, 'positions').ok, true)
  assert.deepEqual(api.pull().data, data)
})

test('invalid serving positions and removal references never replace a shared snapshot', () => {
  const api = harness()
  const data = fixture()
  assert.equal(api.push(data, 0, 'initial-v3').ok, true)
  const invalidPosition = structuredClone(data)
  invalidPosition.matches[0].serviceSetup = {
    game: 1,
    a: 1,
    b: 0,
    afterActionId: 'action1',
    positions: { A: ['p2'], B: ['p1'] },
    servingSide: 'A',
    nearSide: 'A',
    at: 13,
  }
  assert.equal(api.push(invalidPosition, 1, 'bad-position').ok, false)
  for (const targetId of ['missing', 'remove1']) {
    const invalidRemoval = structuredClone(data)
    invalidRemoval.matches[0].actions.push({
      id: 'remove1',
      kind: 'remove',
      side: 'A',
      targetId,
      at: 14,
    })
    assert.equal(api.push(invalidRemoval, 1, 'bad-target-' + targetId).ok, false)
  }
  const wrongSide = structuredClone(data)
  wrongSide.matches[0].actions.push({
    id: 'remove1',
    kind: 'remove',
    side: 'B',
    targetId: 'action1',
    at: 14,
  })
  assert.equal(api.push(wrongSide, 1, 'bad-side').ok, false)
  assert.deepEqual(api.pull().data, data)
})
