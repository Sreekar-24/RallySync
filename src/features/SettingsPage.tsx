import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  CheckCircle2,
  Cloud,
  CloudOff,
  Database,
  ExternalLink,
  FileSpreadsheet,
  HardDrive,
  Link2,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  TriangleAlert,
  Unplug,
} from 'lucide-react'
import { Modal } from '../components'
import { initialData, type AppData } from '../domain/model'
import { scoreMatch } from '../domain/engine'
import { downloadBackup, downloadFile, readBackup } from '../lib/storage'
import { validateSheetEndpoint } from '../lib/sheets'
import { useRally } from '../store'
import './settings.css'

const guideUrl = 'https://github.com/Sreekar-24/RallySync/blob/main/google-apps-script/README.md'

function lastBackupTime() {
  try {
    return Number(localStorage.getItem('rallysync-last-backup')) || null
  } catch {
    return null
  }
}

function readableTime(value: number | null) {
  return value
    ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'Not yet'
}

function csvCell(value: string | number) {
  const text = String(value)
  // CSV quoting does not stop spreadsheet formula execution. Escape potentially
  // executable cells as literal text before quoting them.
  const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

function exportMatches(data: AppData) {
  const names = new Map(data.players.map((player) => [player.id, player.name]))
  const sessions = new Map(data.sessions.map((session) => [session.id, session]))
  const rows: (string | number)[][] = [
    [
      'Session',
      'Session started (UTC)',
      'Court',
      'Format',
      'Side A',
      'Side B',
      'Game scores (A–B)',
      'Current game (A–B)',
      'Status',
      'Winning side',
      'Match started (UTC)',
      'Match ended (UTC)',
    ],
  ]
  for (const match of data.matches) {
    const session = sessions.get(match.sessionId)
    if (!session) continue
    const score = scoreMatch(match, session)
    rows.push([
      session.name,
      new Date(session.startedAt).toISOString(),
      match.court,
      session.format,
      match.teamA.map((id) => names.get(id) || 'Unknown player').join(' & '),
      match.teamB.map((id) => names.get(id) || 'Unknown player').join(' & '),
      score.games.map((game) => `${game.a}–${game.b}`).join('; '),
      `${score.a}–${score.b}`,
      match.status,
      match.status === 'completed' && score.winner ? score.winner : '',
      new Date(match.startedAt).toISOString(),
      match.endedAt ? new Date(match.endedAt).toISOString() : '',
    ])
  }
  downloadFile(
    `rallysync-matches-${new Date().toISOString().slice(0, 10)}.csv`,
    '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n'),
    'text/csv;charset=utf-8',
  )
}

export default function SettingsPage() {
  const {
    data,
    commit,
    notify,
    readOnly,
    persistStatus,
    storageError,
    sync,
    syncBusy,
    syncError,
    configureSync,
    syncNow,
    resolveSync,
  } = useRally()
  const [endpoint, setEndpoint] = useState(sync.endpoint)
  const [role, setRole] = useState<'organizer' | 'viewer'>(sync.role)
  const [error, setError] = useState<string | null>(null)
  const [backupAt, setBackupAt] = useState<number | null>(lastBackupTime)
  const [persistent, setPersistent] = useState<boolean | null>(null)
  const [persistenceBusy, setPersistenceBusy] = useState(false)
  const [persistenceMessage, setPersistenceMessage] = useState<string | null>(null)
  const [online, setOnline] = useState(navigator.onLine)
  const [importing, setImporting] = useState(false)
  const [preview, setPreview] = useState<AppData | null>(null)
  const [resolution, setResolution] = useState<'pull' | 'push' | null>(null)
  const [resetting, setResetting] = useState(false)
  const [resetText, setResetText] = useState('')
  const [backupStarted, setBackupStarted] = useState(false)
  const [pendingConnection, setPendingConnection] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setEndpoint(sync.endpoint)
    setRole(sync.role)
  }, [sync.endpoint, sync.role])
  useEffect(() => {
    let active = true
    if (navigator.storage?.persisted)
      void navigator.storage
        .persisted()
        .then((value) => {
          if (active) setPersistent(value)
        })
        .catch(() => {})
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      active = false
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  function backup() {
    try {
      downloadBackup(data)
      setBackupAt(Date.now())
      setBackupStarted(true)
      setError(null)
      notify('Backup download started. Keep it somewhere safe.')
    } catch {
      setError(
        'The backup could not be downloaded. Check browser download permissions and try again.',
      )
    }
  }

  async function selectBackup(file?: File) {
    if (!file || readOnly) return
    setImporting(true)
    setError(null)
    try {
      setPreview(await readBackup(file))
      setBackupStarted(false)
    } catch {
      setError(
        'This is not a valid RallySync backup, or its records are inconsistent. Your current history has not changed.',
      )
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function restore() {
    if (!preview || !backupStarted || readOnly) return
    configureSync('', 'organizer')
    commit(() => preview)
    setPreview(null)
    notify(
      'Backup restored on this device. Sheets is disconnected; shared history was not changed.',
    )
  }

  async function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    try {
      const clean = validateSheetEndpoint(endpoint)
      if (
        role === 'viewer' &&
        (data.players.length || data.sessions.length || data.matches.length) &&
        (sync.role !== 'viewer' || sync.endpoint !== clean)
      ) {
        setPendingConnection(clean)
        setBackupStarted(false)
        return
      }
      configureSync(clean, role)
      await syncNow()
      notify('Connection saved. Check the sync status below.')
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not save the spreadsheet connection.',
      )
    }
  }

  async function requestPersistence() {
    setPersistenceBusy(true)
    setPersistenceMessage(null)
    try {
      const accepted = await navigator.storage.persist()
      setPersistent(accepted)
      setPersistenceMessage(
        accepted
          ? 'Persistent storage is enabled. Regular backups are still recommended.'
          : 'Your browser did not grant persistent storage. You can keep using RallySync; export regular backups.',
      )
    } catch {
      setPersistenceMessage(
        'Persistent storage is unavailable here. Keep a downloaded backup of important sessions.',
      )
    } finally {
      setPersistenceBusy(false)
    }
  }

  function reset() {
    if (resetText !== 'RESET' || !backupStarted || readOnly) return
    configureSync('', 'organizer')
    commit(() => initialData())
    setResetting(false)
    setResetText('')
    notify('Local history reset. Your shared spreadsheet was not changed.')
  }

  async function resolve() {
    if (!resolution || !backupStarted) return
    const choice = resolution
    setResolution(null)
    await resolveSync(choice)
  }

  return (
    <div className="settings-page">
      <header className="settings-heading">
        <div>
          <p className="settings-eyebrow">MAKE YOURSELF AT HOME</p>
          <h1>Your game. Your setup.</h1>
          <p>Keep your history safe. Connect your crew when you’re ready.</p>
        </div>
        <span className="settings-heading-icon">
          <ShieldCheck size={27} />
        </span>
      </header>
      {readOnly && (
        <p className="settings-notice">
          <LockKeyhole size={17} />
          <span>
            History changes are disabled in this view. You can still download backups and manage
            this device’s connection.
          </span>
        </p>
      )}
      {(error || storageError) && (
        <p className="settings-alert" role="alert">
          <TriangleAlert size={18} />
          <span>{error || storageError}</span>
        </p>
      )}

      <div className="settings-grid">
        <section className="settings-card settings-backup" aria-labelledby="backup-title">
          <div className="settings-card-heading">
            <span className="settings-card-icon lime">
              <ArrowDownToLine size={22} />
            </span>
            <div>
              <h2 id="backup-title">A little peace of mind.</h2>
              <p>Your matches deserve a safe place.</p>
            </div>
          </div>
          <p className="settings-description">
            Download a complete backup of your players, sessions, rules, and scores. Save it in
            Drive or another safe location, or transfer it to your next organizer.
          </p>
          <dl className="settings-records">
            <div>
              <dt>Players</dt>
              <dd>{data.players.length}</dd>
            </div>
            <div>
              <dt>Sessions</dt>
              <dd>{data.sessions.length}</dd>
            </div>
            <div>
              <dt>Matches</dt>
              <dd>{data.matches.length}</dd>
            </div>
          </dl>
          <div className="settings-actions">
            <button className="settings-button primary" onClick={backup}>
              <ArrowDownToLine size={17} /> Download full backup
            </button>
            <button
              className="settings-button"
              disabled={readOnly || importing}
              onClick={() => fileRef.current?.click()}
            >
              {importing ? (
                <LoaderCircle size={17} className="settings-spin" />
              ) : (
                <ArrowUpFromLine size={17} />
              )}{' '}
              Restore backup
            </button>
          </div>
          <input
            ref={fileRef}
            className="settings-file-input"
            type="file"
            accept=".json,application/json"
            aria-label="Choose RallySync backup"
            onChange={(event) => {
              void selectBackup(event.target.files?.[0])
            }}
          />
          <p className="settings-meta">
            <CheckCircle2 size={14} />
            Last backup download: {readableTime(backupAt)}
          </p>
        </section>

        <section className="settings-card settings-export" aria-labelledby="export-title">
          <div className="settings-card-heading">
            <span className="settings-card-icon peach">
              <FileSpreadsheet size={22} />
            </span>
            <div>
              <h2 id="export-title">Take the numbers with you.</h2>
              <p>For your spreadsheet enthusiasts.</p>
            </div>
          </div>
          <p className="settings-description">
            Export match results to a CSV file for Google Sheets, Excel, or LibreOffice. Includes
            sides, game scores, outcomes, and match times.
          </p>
          <div className="settings-export-art" aria-hidden="true">
            <FileSpreadsheet size={42} />
            <span>
              GOOD GAMES.
              <br />
              GREAT DATA.
            </span>
            <span className="settings-csv-tag">.CSV</span>
          </div>
          <button
            className="settings-button"
            disabled={!data.matches.length}
            onClick={() => {
              exportMatches(data)
              notify('Match export download started.')
            }}
          >
            <ArrowDownToLine size={17} /> Export match results
          </button>
          <p className="settings-meta">
            Points belong to each side. CSV is for analysis; use JSON for full recovery.
          </p>
        </section>

        <section className="settings-card settings-cloud" aria-labelledby="sync-title">
          <div className="settings-card-heading">
            <span className="settings-card-icon blue">
              <Cloud size={22} />
            </span>
            <div>
              <h2 id="sync-title">One group. A shared history.</h2>
              <p>Optional Google Sheets connection.</p>
            </div>
            <span className={`settings-status ${sync.endpoint ? 'connected' : ''}`}>
              {sync.endpoint ? 'Configured' : 'Local only'}
            </span>
          </div>
          <p className="settings-description">
            Use the supplied Apps Script to connect a dedicated spreadsheet. Choose one organizer
            device to upload changes; other devices can follow the shared session.
          </p>
          <div className="settings-sync-help">
            <span>1</span>
            <p>
              Create your Sheet and deploy the script.{' '}
              <a href={guideUrl} target="_blank" rel="noreferrer">
                Open setup guide <ExternalLink size={12} />
              </a>
            </p>
          </div>
          <form
            className="settings-connection"
            onSubmit={(event) => {
              void connect(event)
            }}
          >
            <label className="settings-field">
              <span>Apps Script web-app URL</span>
              <input
                type="url"
                placeholder="https://script.google.com/macros/s/…/exec"
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                required
                aria-describedby="endpoint-help"
              />
            </label>
            <p className="settings-field-help" id="endpoint-help">
              Use the deployed production URL ending in /exec. No passwords or API keys.
            </p>
            <fieldset className="settings-role">
              <legend>This device’s role</legend>
              <label className={role === 'organizer' ? 'selected' : ''}>
                <input
                  type="radio"
                  name="sync-role"
                  value="organizer"
                  checked={role === 'organizer'}
                  onChange={() => setRole('organizer')}
                />
                <span>
                  <strong>Organizer</strong>
                  <small>Score matches and upload changes</small>
                </span>
              </label>
              <label className={role === 'viewer' ? 'selected' : ''}>
                <input
                  type="radio"
                  name="sync-role"
                  value="viewer"
                  checked={role === 'viewer'}
                  onChange={() => setRole('viewer')}
                />
                <span>
                  <strong>Viewer</strong>
                  <small>Follow the shared history</small>
                </span>
              </label>
            </fieldset>
            <div className="settings-actions">
              <button
                type="submit"
                className="settings-button primary"
                disabled={syncBusy || !online}
              >
                {syncBusy ? (
                  <LoaderCircle size={17} className="settings-spin" />
                ) : (
                  <Link2 size={17} />
                )}{' '}
                {sync.endpoint ? 'Save connection' : 'Connect & check'}
              </button>
              {sync.endpoint && (
                <button
                  type="button"
                  className="settings-button"
                  disabled={syncBusy}
                  onClick={() => {
                    configureSync('', 'organizer')
                    setError(null)
                    notify('Sheets disconnected. Your local history is still here.')
                  }}
                >
                  <Unplug size={17} /> Disconnect
                </button>
              )}
            </div>
          </form>
          <div className={`settings-sync-state ${syncError ? 'has-error' : ''}`} aria-live="polite">
            <span>
              {!online ? (
                <CloudOff size={19} />
              ) : syncBusy ? (
                <LoaderCircle className="settings-spin" size={19} />
              ) : syncError ? (
                <TriangleAlert size={19} />
              ) : sync.endpoint ? (
                <CheckCircle2 size={19} />
              ) : (
                <HardDrive size={19} />
              )}
            </span>
            <div>
              <strong>
                {!online
                  ? 'Offline. Changes stay on this device.'
                  : syncBusy
                    ? 'Checking shared history…'
                    : syncError
                      ? 'Sync needs your attention'
                      : sync.endpoint
                        ? !sync.lastSyncAt
                          ? 'Connection has not been verified'
                          : sync.dirty
                            ? 'Local changes waiting to sync'
                            : 'Shared history is up to date'
                        : 'Your history stays on this device'}
              </strong>
              <p>
                {syncError ||
                  (sync.endpoint
                    ? `Revision ${sync.revision} · Last checked: ${readableTime(sync.lastSyncAt)}`
                    : 'Connect when you’re ready. No account needed for local play.')}
              </p>
            </div>
            {sync.endpoint && (
              <button
                className="settings-icon-button"
                aria-label="Sync now"
                disabled={syncBusy || !online}
                onClick={() => {
                  void syncNow()
                }}
              >
                <RefreshCw size={18} />
              </button>
            )}
          </div>
          {sync.endpoint && (
            <details className="settings-resolution">
              <summary>Resolve different local and shared copies</summary>
              <p>
                Automatic sync stops when both copies have changed. Back up your local history, then
                deliberately choose the copy to keep. This replaces a complete history, rather than
                merging individual matches.
              </p>
              <div className="settings-actions">
                <button
                  className="settings-button"
                  disabled={syncBusy || !online}
                  onClick={() => {
                    setResolution('pull')
                    setBackupStarted(false)
                  }}
                >
                  <ArrowDownToLine size={16} /> Use shared copy
                </button>
                <button
                  className="settings-button"
                  disabled={readOnly || syncBusy || !online}
                  onClick={() => {
                    setResolution('push')
                    setBackupStarted(false)
                  }}
                >
                  <ArrowUpFromLine size={16} /> Use this device’s copy
                </button>
              </div>
            </details>
          )}
          <p className="settings-security">
            <ShieldCheck size={16} />
            <span>
              Prototype access: an anonymous Apps Script endpoint lets anyone with its URL read or
              replace the shared history. Viewer mode is a convenience, not a security boundary.
              Keep sensitive information out of this setup.{' '}
              <a href={guideUrl} target="_blank" rel="noreferrer">
                Read access guidance
              </a>
              .
            </span>
          </p>
        </section>

        <section className="settings-card settings-storage" aria-labelledby="storage-title">
          <div className="settings-card-heading">
            <span className="settings-card-icon">
              <Database size={22} />
            </span>
            <div>
              <h2 id="storage-title">Made to stay courtside.</h2>
              <p>Local storage and offline play.</p>
            </div>
          </div>
          <div className="settings-storage-state">
            <span className={`settings-state-dot ${persistStatus === 'error' ? 'error' : ''}`} />
            <strong>
              {persistStatus === 'error'
                ? 'Local save needs attention'
                : persistStatus === 'saving'
                  ? 'Saving on this device…'
                  : 'Saved on this device'}
            </strong>
          </div>
          <p className="settings-description">
            History is stored in this browser, not in the public GitHub repository. Clearing website
            data, private browsing, or losing this device can remove it. A downloaded backup is your
            recovery copy.
          </p>
          <div className="settings-persistence">
            <HardDrive size={17} />
            <span>
              {persistent === true
                ? 'Persistent storage enabled'
                : persistent === false
                  ? 'Storage is managed by your browser'
                  : 'Storage persistence has not been checked'}
            </span>
            {persistent && <Check size={16} />}
          </div>
          {persistent !== true && typeof navigator.storage?.persist === 'function' && (
            <button
              className="settings-button"
              disabled={persistenceBusy}
              onClick={() => {
                void requestPersistence()
              }}
            >
              {persistenceBusy ? (
                <LoaderCircle size={16} className="settings-spin" />
              ) : (
                <ShieldCheck size={16} />
              )}{' '}
              Request persistent storage
            </button>
          )}
          {persistenceMessage && (
            <p className="settings-meta" role="status">
              {persistenceMessage}
            </p>
          )}
          <div className="settings-install-note">
            <Smartphone size={22} />
            <div>
              <strong>Make room on your home screen.</strong>
              <p>
                Install RallySync from your browser’s menu when available. On iPhone, use Share →
                Add to Home Screen. Open online once to cache the app before heading courtside.
              </p>
            </div>
          </div>
        </section>

        <section className="settings-reset" aria-labelledby="reset-title">
          <div>
            <h2 id="reset-title">A fresh start on this device.</h2>
            <p>
              Clear local players and history, including demo data. Your shared spreadsheet stays
              unchanged.
            </p>
          </div>
          <button
            className="settings-button danger"
            disabled={
              readOnly || (!data.players.length && !data.sessions.length && !data.matches.length)
            }
            onClick={() => {
              setResetting(true)
              setResetText('')
              setBackupStarted(false)
            }}
          >
            <Trash2 size={16} /> Reset local data
          </button>
        </section>
      </div>

      {pendingConnection && (
        <Modal
          title="Switch to the shared view?"
          subtitle="Viewer mode replaces this device’s history with the organizer’s shared copy."
          onClose={() => setPendingConnection(null)}
        >
          <div className="settings-dialog-body">
            <p>
              Keep a backup of your current local history before connecting. Independent histories
              are not merged.
            </p>
            <BackupStep started={backupStarted} onBackup={backup} />
            <div className="settings-dialog-actions">
              <button className="settings-button" onClick={() => setPendingConnection(null)}>
                Keep local history
              </button>
              <button
                className="settings-button primary"
                disabled={!backupStarted || syncBusy}
                onClick={() => {
                  configureSync(pendingConnection, 'viewer')
                  setPendingConnection(null)
                  void syncNow()
                }}
              >
                Connect as viewer
              </button>
            </div>
          </div>
        </Modal>
      )}
      {preview && (
        <Modal
          title="Restore this backup?"
          subtitle="Review before replacing your local history."
          onClose={() => setPreview(null)}
        >
          <div className="settings-dialog-body">
            <div className="settings-preview">
              <div>
                <span>Players</span>
                <strong>{preview.players.length}</strong>
              </div>
              <div>
                <span>Sessions</span>
                <strong>{preview.sessions.length}</strong>
              </div>
              <div>
                <span>Matches</span>
                <strong>{preview.matches.length}</strong>
              </div>
            </div>
            <p>
              This replaces the {data.players.length} players, {data.sessions.length} sessions, and{' '}
              {data.matches.length} matches currently on this device. It does not merge histories.
            </p>
            <p>Sheets will disconnect on this device. The shared spreadsheet will not change.</p>
            <BackupStep started={backupStarted} onBackup={backup} />
            <div className="settings-dialog-actions">
              <button className="settings-button" onClick={() => setPreview(null)}>
                Keep current history
              </button>
              <button
                className="settings-button primary"
                disabled={!backupStarted || readOnly}
                onClick={restore}
              >
                Restore backup
              </button>
            </div>
          </div>
        </Modal>
      )}
      {resolution && (
        <Modal
          title={resolution === 'pull' ? 'Replace local history?' : 'Replace shared history?'}
          subtitle="Choose one complete copy. Changes cannot be merged automatically."
          onClose={() => setResolution(null)}
        >
          <div className="settings-dialog-body">
            <p>
              {resolution === 'pull'
                ? 'This downloads the latest shared snapshot and replaces everything on this device, including unsynced changes.'
                : 'This uploads this device’s complete history and replaces the shared snapshot. Other viewers will receive this copy on their next sync.'}
            </p>
            <BackupStep started={backupStarted} onBackup={backup} />
            <div className="settings-dialog-actions">
              <button className="settings-button" onClick={() => setResolution(null)}>
                Cancel
              </button>
              <button
                className="settings-button primary"
                disabled={!backupStarted || syncBusy}
                onClick={() => {
                  void resolve()
                }}
              >
                {resolution === 'pull' ? 'Use shared copy' : 'Replace shared copy'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {resetting && (
        <Modal
          title="Reset local data?"
          subtitle="This removes this device’s players, sessions, and scores."
          onClose={() => setResetting(false)}
        >
          <div className="settings-dialog-body">
            <p>
              Sheets will disconnect first. Your shared spreadsheet and previously downloaded
              backups will not change.
            </p>
            <BackupStep started={backupStarted} onBackup={backup} />
            <label className="settings-field">
              <span>Type RESET to confirm</span>
              <input
                value={resetText}
                onChange={(event) => setResetText(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="RESET"
              />
            </label>
            <div className="settings-dialog-actions">
              <button className="settings-button" onClick={() => setResetting(false)}>
                Keep my history
              </button>
              <button
                className="settings-button danger"
                disabled={!backupStarted || resetText !== 'RESET' || readOnly}
                onClick={reset}
              >
                Reset local data
              </button>
            </div>
          </div>
        </Modal>
      )}
      <p className="settings-footer">
        Less admin. More badminton. <span>RallySync · v0.1</span>
      </p>
    </div>
  )
}

function BackupStep({ started, onBackup }: { started: boolean; onBackup: () => void }) {
  return (
    <div className={`settings-backup-step ${started ? 'complete' : ''}`}>
      <span>{started ? <CheckCircle2 size={20} /> : <ArrowDownToLine size={20} />}</span>
      <div>
        <strong>{started ? 'Backup download started' : 'First, keep a recovery copy.'}</strong>
        <p>
          {started
            ? 'Make sure the file is saved before continuing.'
            : 'Download the current local history before replacing it.'}
        </p>
      </div>
      <button className="settings-button" onClick={onBackup}>
        {started ? 'Download again' : 'Download backup'}
      </button>
    </div>
  )
}
