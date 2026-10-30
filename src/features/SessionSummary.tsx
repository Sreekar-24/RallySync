import { useMemo, useState } from 'react'
import { ArrowDownToLine, Check, RotateCcw, Trophy, Users } from 'lucide-react'
import type { Session } from '../domain/model'
import { getAnalytics } from '../domain/analytics'
import { downloadBackup } from '../lib/storage'
import { useRally } from '../store'
import ReportActions from './ReportActions'
import './session-summary.css'

/** A session recap uses the same accepted results and attendance scope as reports. */
export default function SessionSummary({
  session,
  onPlayAgain,
  showExports = true,
}: {
  session: Session
  onPlayAgain?: (session: Session) => void
  showExports?: boolean
}) {
  const { data, isDemo, readOnly } = useRally()
  const [backupMessage, setBackupMessage] = useState('')
  const analytics = useMemo(
    () => getAnalytics(data, { sessionId: session.id }, session.endedAt ?? Date.now()),
    [data, session.id, session.endedAt],
  )
  const players = [...analytics.players].sort(
    (a, b) => b.wins - a.wins || b.played - a.played || a.name.localeCompare(b.name),
  )
  const participation = [...analytics.participation].sort((a, b) => a.name.localeCompare(b.name))
  const pairs = [...analytics.partnerships]
    .sort(
      (a, b) =>
        b.played - a.played || b.wins - a.wins || a.names.join().localeCompare(b.names.join()),
    )
    .slice(0, 3)
  const activeParticipants = participation.filter((p) => p.availableMinutes > 0 || p.played > 0)
  const matchCounts = activeParticipants.map((p) => p.played)
  const minMatches = matchCounts.length ? Math.min(...matchCounts) : 0
  const maxMatches = matchCounts.length ? Math.max(...matchCounts) : 0
  const topWins = players[0]?.wins ?? 0
  const leaders = players.filter((p) => p.wins === topWins)

  return (
    <section className="session-summary" aria-label={`Summary of ${session.name}`}>
      <header className="session-summary-heading">
        <div>
          <p>{session.status === 'completed' ? 'SESSION RECAP' : 'SESSION SO FAR'}</p>
          <h3>
            {session.status === 'completed' ? 'A good game, remembered.' : 'The story so far.'}
          </h3>
        </div>
        <Trophy size={23} aria-hidden="true" />
      </header>
      <div className="session-summary-facts">
        <div>
          <strong>{analytics.summary.completedMatches}</strong>
          <span>Confirmed matches</span>
        </div>
        <div>
          <strong>{activeParticipants.length}</strong>
          <span>Players present</span>
        </div>
        <div>
          <strong>{minMatches === maxMatches ? minMatches : `${minMatches}–${maxMatches}`}</strong>
          <span>Matches per player</span>
        </div>
      </div>
      {topWins > 0 ? (
        <p className="session-summary-leaders">
          <Trophy size={16} aria-hidden="true" />
          <span>
            <strong>{leaders.map((p) => p.name).join(', ')}</strong> finished with the most wins:{' '}
            {topWins}. Only confirmed results count.
          </span>
        </p>
      ) : (
        <p className="session-summary-note">
          No confirmed results yet. Recorded participation still appears below.
        </p>
      )}
      <details className="session-summary-details">
        <summary>
          <Users size={16} aria-hidden="true" /> Results and playing time
        </summary>
        <div
          className="session-summary-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Session participation and results"
        >
          <table>
            <caption className="sr-only">
              Player results and elapsed court time for {session.name}
            </caption>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">W–L</th>
                <th scope="col">Played</th>
                <th scope="col">Play min</th>
                <th scope="col">Available min</th>
              </tr>
            </thead>
            <tbody>
              {participation.map((p) => {
                const stats = players.find((row) => row.playerId === p.playerId)
                return (
                  <tr key={p.playerId}>
                    <th scope="row">{p.name}</th>
                    <td>
                      {stats?.wins ?? 0}–{stats?.losses ?? 0}
                    </td>
                    <td>{p.played}</td>
                    <td>{Math.round(p.minutes)}</td>
                    <td>{Math.round(p.availableMinutes)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="session-summary-note">
          Played and play time include stopped matches. Recorded pauses and result review are
          excluded when tracked; older matches use elapsed duration. Availability excludes recorded
          breaks. Unequal attendance can explain different totals.
        </p>
        {pairs.length > 0 && (
          <div className="session-summary-pairs">
            <h4>Frequent partnerships</h4>
            <ul>
              {pairs.map((pair) => (
                <li key={pair.playerIds.join(':')}>
                  <span>{pair.names.join(' & ')}</span>
                  <strong>
                    {pair.wins}W · {pair.losses}L{' '}
                    <small>
                      in {pair.played} match{pair.played === 1 ? '' : 'es'}
                    </small>
                  </strong>
                </li>
              ))}
            </ul>
            <p className="session-summary-note">
              Session records only. A small sample does not establish the strongest partnership.
            </p>
          </div>
        )}
      </details>
      {showExports && (
        <div className="session-summary-exports">
          <p>Keep a session report, or save a complete recovery backup.</p>
          <ReportActions data={data} sessionId={session.id} scopeLabel={session.name} />
          {!isDemo && (
            <button
              className="button ghost small"
              onClick={() => {
                try {
                  downloadBackup(data)
                  setBackupMessage(
                    'Recovery backup download started. Keep the JSON file somewhere safe.',
                  )
                } catch {
                  setBackupMessage(
                    'The backup could not be prepared. Try Export backup in Settings.',
                  )
                }
              }}
            >
              <ArrowDownToLine size={16} /> Back up all history
            </button>
          )}
          {backupMessage && (
            <p className="session-summary-note" role="status">
              <Check size={14} aria-hidden="true" /> {backupMessage}
            </p>
          )}
        </div>
      )}
      {onPlayAgain && !readOnly && (
        <div className="session-summary-repeat">
          <div>
            <strong>Same group, another day?</strong>
            <span>Reuse the setup, then check who is here.</span>
          </div>
          <button className="button primary small" onClick={() => onPlayAgain(session)}>
            <RotateCcw size={16} /> Play again
          </button>
        </div>
      )}
    </section>
  )
}
