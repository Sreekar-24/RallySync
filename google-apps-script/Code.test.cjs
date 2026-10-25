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
    version: 1,
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
    version: 1,
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
    { ...fixture(), version: 2 },
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
