/**
 * RallySync optional Google Sheets bridge, protocol v1.
 * This is a single-writer shared snapshot store, not a public multi-tenant API.
 * See README.md before deploying, especially the deployment-access warning.
 */
var RALLY = {
  property: 'RALLYSYNC_SPREADSHEET_ID',
  stateSheet: '_RallyState',
  chunksSheet: '_RallyChunks',
  chunkSize: 30000,
  maxJsonLength: 2000000,
}

/** Run once from a script bound to a dedicated spreadsheet. Never erases data. */
function setup() {
  var book = SpreadsheetApp.getActiveSpreadsheet()
  if (!book) throw new Error('Open Extensions > Apps Script from your RallySync spreadsheet.')
  var lock = LockService.getScriptLock()
  lock.waitLock(10000)
  try {
    var existing = PropertiesService.getScriptProperties().getProperty(RALLY.property)
    if (existing && existing !== book.getId()) {
      throw new Error(
        'This script already points at another spreadsheet. Use a separate script project.',
      )
    }
    var state = ensureSheet_(book, RALLY.stateSheet, [
      'revision',
      'snapshotId',
      'chunkCount',
      'updatedAt',
      'mutationId',
      'sha256',
    ])
    ensureSheet_(book, RALLY.chunksSheet, ['snapshotId', 'chunkIndex', 'base64Payload'])
    if (state.getLastRow() < 2) state.getRange(2, 1, 1, 6).setValues([[0, '', 0, 0, '', '']])
    SpreadsheetApp.flush()
    PropertiesService.getScriptProperties().setProperty(RALLY.property, book.getId())
    console.log('RallySync setup complete. Deploy as a web app and use the production /exec URL.')
  } finally {
    lock.releaseLock()
  }
}

function doGet(e) {
  return dispatch_((e && e.parameter && e.parameter.action) || 'pull', null)
}

function doPost(e) {
  var request
  try {
    var raw = e && e.postData && e.postData.contents
    if (!raw || raw.length > RALLY.maxJsonLength + 10000) {
      return json_({ ok: false, code: 'INVALID_REQUEST', error: 'Missing or oversized request.' })
    }
    request = JSON.parse(raw)
    if (!request || typeof request !== 'object' || Array.isArray(request))
      throw new Error('Invalid request.')
  } catch (error) {
    return json_({ ok: false, code: 'INVALID_REQUEST', error: 'Request must be a JSON object.' })
  }
  return dispatch_(request.action, request)
}

function dispatch_(action, request) {
  if (action !== 'pull' && action !== 'push' && action !== 'initialize') {
    return json_({ ok: false, code: 'INVALID_ACTION', error: 'Use pull, push, or initialize.' })
  }
  if ((action === 'push' || action === 'initialize') && !request) {
    return json_({ ok: false, code: 'METHOD', error: 'Writes require POST.' })
  }
  var lock = LockService.getScriptLock()
  if (!lock.tryLock(10000)) {
    return json_({
      ok: false,
      code: 'BUSY',
      error: 'Another update is in progress. Pull before retrying.',
    })
  }
  try {
    var spreadsheetId = PropertiesService.getScriptProperties().getProperty(RALLY.property)
    if (!spreadsheetId)
      return json_({
        ok: false,
        code: 'NOT_CONFIGURED',
        error: 'Run setup() in the bound script first.',
      })
    var book = SpreadsheetApp.openById(spreadsheetId)
    var state = book.getSheetByName(RALLY.stateSheet)
    var chunks = book.getSheetByName(RALLY.chunksSheet)
    if (!state || !chunks)
      return json_({
        ok: false,
        code: 'NOT_CONFIGURED',
        error: 'Required storage tabs are missing. Run setup().',
      })
    var manifest = readManifest_(state)
    if (action === 'pull') return json_(snapshot_(chunks, manifest))
    if (action === 'initialize' && manifest.revision !== 0) {
      return json_({
        ok: false,
        code: 'CONFLICT',
        error: 'The shared store already contains data.',
        revision: manifest.revision,
      })
    }
    if (
      !integer_(request.expectedRevision, 0, Number.MAX_SAFE_INTEGER) ||
      typeof request.mutationId !== 'string' ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(request.mutationId)
    ) {
      return json_({
        ok: false,
        code: 'INVALID_REQUEST',
        error: 'A revision and unique mutation ID are required.',
      })
    }
    var validation = validateData_(request.data)
    if (validation) return json_({ ok: false, code: 'INVALID_DATA', error: validation })
    var raw = JSON.stringify(request.data)
    if (raw.length > RALLY.maxJsonLength)
      return json_({
        ok: false,
        code: 'TOO_LARGE',
        error: 'Shared history is too large. Export an archive before continuing.',
      })
    var digest = sha256_(raw)
    // An acknowledgement may have been lost. Retrying the most recent mutation
    // returns its committed result, but never applies that mutation twice.
    if (request.mutationId === manifest.mutationId) {
      if (digest !== manifest.digest)
        return json_({
          ok: false,
          code: 'INVALID_MUTATION',
          error: 'This mutation ID was already used for different data.',
        })
      return json_(snapshot_(chunks, manifest))
    }
    if (request.expectedRevision !== manifest.revision) {
      return json_({
        ok: false,
        code: 'CONFLICT',
        error: 'Shared data changed. Pull and review before uploading; nothing was overwritten.',
        revision: manifest.revision,
      })
    }

    var snapshotId = Utilities.getUuid()
    var encoded = Utilities.base64Encode(raw, Utilities.Charset.UTF_8)
    var rows = []
    for (var offset = 0; offset < encoded.length; offset += RALLY.chunkSize) {
      // A literal prefix prevents spreadsheet formula interpretation, including
      // chunks that happen to begin with base64 padding or special characters.
      rows.push([snapshotId, rows.length, 'b64:' + encoded.slice(offset, offset + RALLY.chunkSize)])
    }
    var startRow = chunks.getLastRow() + 1
    ensureRows_(chunks, startRow + rows.length - 1)
    chunks.getRange(startRow, 1, rows.length, 3).setValues(rows)
    SpreadsheetApp.flush()
    var next = {
      revision: manifest.revision + 1,
      snapshotId: snapshotId,
      chunkCount: rows.length,
      updatedAt: Date.now(),
      mutationId: request.mutationId,
      digest: digest,
    }
    // Verify persisted payload BEFORE changing the one-row authoritative pointer.
    var verified = snapshot_(chunks, next)
    state
      .getRange(2, 1, 1, 6)
      .setValues([
        [
          next.revision,
          next.snapshotId,
          next.chunkCount,
          next.updatedAt,
          next.mutationId,
          next.digest,
        ],
      ])
    SpreadsheetApp.flush()
    // Canonical state is committed. Cleanup must never turn success into failure.
    try {
      cleanup_(chunks, snapshotId, manifest.snapshotId)
    } catch (ignored) {
      /* Old snapshots are harmless. */
    }
    return json_(verified)
  } catch (error) {
    // Avoid exposing spreadsheet IDs, account information, or raw user data.
    return json_({
      ok: false,
      code: 'STORAGE_ERROR',
      error: 'Spreadsheet storage failed. Keep your local data and pull before retrying.',
    })
  } finally {
    lock.releaseLock()
  }
}

function ensureSheet_(book, name, headers) {
  var sheet = book.getSheetByName(name)
  if (!sheet) sheet = book.insertSheet(name)
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold')
    sheet.setFrozenRows(1)
  } else {
    var actual = sheet.getRange(1, 1, 1, headers.length).getValues()[0]
    if (actual.join('|') !== headers.join('|')) throw new Error('Storage tab headers do not match.')
  }
  return sheet
}

function ensureRows_(sheet, rows) {
  if (rows > sheet.getMaxRows())
    sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows())
}

function readManifest_(state) {
  var values = state.getRange(2, 1, 1, 6).getValues()[0]
  if (
    !integer_(values[0], 0, Number.MAX_SAFE_INTEGER) ||
    !integer_(values[2], 0, 1000) ||
    !finite_(values[3]) ||
    typeof values[1] !== 'string' ||
    typeof values[4] !== 'string' ||
    typeof values[5] !== 'string'
  ) {
    throw new Error('Invalid state manifest.')
  }
  return {
    revision: values[0],
    snapshotId: values[1],
    chunkCount: values[2],
    updatedAt: values[3],
    mutationId: values[4],
    digest: values[5],
  }
}

function snapshot_(chunks, manifest) {
  if (manifest.revision === 0) return { ok: true, data: null, revision: 0, updatedAt: 0 }
  if (!manifest.snapshotId || !manifest.chunkCount) throw new Error('Missing snapshot pointer.')
  var values =
    chunks.getLastRow() > 1 ? chunks.getRange(2, 1, chunks.getLastRow() - 1, 3).getValues() : []
  var payloads = []
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] !== manifest.snapshotId) continue
    var index = values[i][1]
    if (
      !integer_(index, 0, manifest.chunkCount - 1) ||
      payloads[index] !== undefined ||
      typeof values[i][2] !== 'string' ||
      values[i][2].slice(0, 4) !== 'b64:'
    )
      throw new Error('Invalid snapshot chunk.')
    payloads[index] = values[i][2].slice(4)
  }
  for (var j = 0; j < manifest.chunkCount; j++)
    if (payloads[j] === undefined) throw new Error('Incomplete snapshot.')
  if (payloads.length !== manifest.chunkCount) throw new Error('Invalid chunk count.')
  var raw = Utilities.newBlob(Utilities.base64Decode(payloads.join(''))).getDataAsString('UTF-8')
  if (sha256_(raw) !== manifest.digest) throw new Error('Snapshot checksum mismatch.')
  var data = JSON.parse(raw)
  if (validateData_(data)) throw new Error('Invalid snapshot data.')
  return {
    ok: true,
    data: data,
    revision: manifest.revision,
    updatedAt: manifest.updatedAt,
    mutationId: manifest.mutationId,
  }
}

/** Keep the current and previous snapshots; remove uncommitted orphan chunks. */
function cleanup_(chunks, currentId, previousId) {
  if (chunks.getLastRow() < 2) return
  var values = chunks.getRange(2, 1, chunks.getLastRow() - 1, 1).getValues()
  for (var i = values.length - 1; i >= 0; i--) {
    if (values[i][0] !== currentId && values[i][0] !== previousId) chunks.deleteRow(i + 2)
  }
}

function sha256_(raw) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8)
    .map(function (byte) {
      return ('0' + (byte & 255).toString(16)).slice(-2)
    })
    .join('')
}

function integer_(value, min, max) {
  return (
    typeof value === 'number' &&
    isFinite(value) &&
    Math.floor(value) === value &&
    value >= min &&
    value <= max
  )
}

function finite_(value) {
  return typeof value === 'number' && isFinite(value) && value >= 0
}
function id_(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}
function name_(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200
}
function ids_(values, known) {
  if (!Array.isArray(values)) return false
  var seen = Object.create(null)
  return values.every(function (id) {
    if (!id_(id) || seen[id] || (known && !known[id])) return false
    seen[id] = true
    return true
  })
}

/** Reject malformed snapshots before they can replace the canonical history. */
function validateData_(data) {
  if (
    !data ||
    data.version !== 1 ||
    !Array.isArray(data.players) ||
    !Array.isArray(data.sessions) ||
    !Array.isArray(data.matches)
  )
    return 'Unsupported data format.'
  if (data.players.length > 2000 || data.sessions.length > 10000 || data.matches.length > 50000)
    return 'This group history exceeds the spreadsheet bridge limits.'
  var players = Object.create(null),
    sessions = Object.create(null),
    matches = Object.create(null)
  var occupied = Object.create(null),
    activeSessions = 0
  var i, p, s, m
  for (i = 0; i < data.players.length; i++) {
    p = data.players[i]
    if (
      !p ||
      !id_(p.id) ||
      players[p.id] ||
      !name_(p.name) ||
      p.name.length > 48 ||
      !integer_(p.level, 1, 5) ||
      !finite_(p.createdAt)
    )
      return 'Invalid or duplicate player.'
    players[p.id] = true
  }
  for (i = 0; i < data.sessions.length; i++) {
    s = data.sessions[i]
    if (
      !s ||
      !id_(s.id) ||
      sessions[s.id] ||
      !name_(s.name) ||
      s.name.length > 80 ||
      !finite_(s.startedAt) ||
      (s.endedAt !== undefined && !finite_(s.endedAt)) ||
      ['singles', 'doubles'].indexOf(s.format) < 0 ||
      !integer_(s.courtCount, 1, 12) ||
      !integer_(s.target, 1, 99) ||
      !integer_(s.winBy, 1, 2) ||
      !integer_(s.cap, s.target, 199) ||
      [1, 3].indexOf(s.bestOf) < 0 ||
      ['balanced', 'fair', 'variety'].indexOf(s.mode) < 0 ||
      ['active', 'completed'].indexOf(s.status) < 0 ||
      !ids_(s.playerIds, players) ||
      s.playerIds.length > 200
    )
      return 'Invalid or duplicate session.'
    if (s.status === 'active' && ++activeSessions > 1)
      return 'Only one active session is supported.'
    var members = Object.create(null)
    s.playerIds.forEach(function (id) {
      members[id] = true
    })
    if (!ids_(s.availablePlayerIds, members))
      return 'Session availability includes an unknown participant.'
    if (
      s.attendance !== undefined &&
      (!Array.isArray(s.attendance) ||
        s.attendance.length > 50000 ||
        s.attendance.some(function (entry) {
          return (
            !entry ||
            !members[entry.playerId] ||
            !finite_(entry.at) ||
            typeof entry.available !== 'boolean'
          )
        }))
    )
      return 'Invalid attendance events.'
    sessions[s.id] = s
  }
  for (i = 0; i < data.matches.length; i++) {
    m = data.matches[i]
    if (
      !m ||
      !id_(m.id) ||
      matches[m.id] ||
      !sessions[m.sessionId] ||
      !finite_(m.startedAt) ||
      (m.endedAt !== undefined && !finite_(m.endedAt)) ||
      !integer_(m.revision, 0, Number.MAX_SAFE_INTEGER) ||
      ['playing', 'completed', 'abandoned'].indexOf(m.status) < 0 ||
      !Array.isArray(m.actions) ||
      m.actions.length > 20000
    )
      return 'Invalid or duplicate match.'
    var session = sessions[m.sessionId]
    var size = session.format === 'singles' ? 1 : 2
    if (
      !Array.isArray(m.teamA) ||
      !Array.isArray(m.teamB) ||
      m.teamA.length !== size ||
      m.teamB.length !== size ||
      !integer_(m.court, 1, session.courtCount)
    )
      return 'Invalid match teams or court.'
    var participants = Object.create(null)
    session.playerIds.forEach(function (id) {
      participants[id] = true
    })
    if (!ids_(m.teamA.concat(m.teamB), participants))
      return 'Match includes an unknown or duplicated participant.'
    if (m.status === 'playing') {
      if (session.status !== 'active') return 'A completed session cannot contain an active match.'
      var occupiedKeys = ['court:' + session.id + ':' + m.court].concat(
        m.teamA.concat(m.teamB).map(function (id) {
          return 'player:' + id
        }),
      )
      for (var k = 0; k < occupiedKeys.length; k++) {
        if (occupied[occupiedKeys[k]]) return 'An active court or player is assigned twice.'
        occupied[occupiedKeys[k]] = true
      }
    }
    var actions = Object.create(null)
    for (var j = 0; j < m.actions.length; j++) {
      var a = m.actions[j]
      if (
        !a ||
        !id_(a.id) ||
        actions[a.id] ||
        !finite_(a.at) ||
        ['point', 'undo'].indexOf(a.kind) < 0 ||
        (a.kind === 'point' && ['A', 'B'].indexOf(a.side) < 0)
      )
        return 'Invalid scoring action.'
      actions[a.id] = true
    }
    matches[m.id] = true
  }
  return null
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(
    ContentService.MimeType.JSON,
  )
}
