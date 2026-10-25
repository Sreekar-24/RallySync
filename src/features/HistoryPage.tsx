import { useState } from 'react'
import { CalendarDays, ChevronDown, ChevronUp, Clock3, Flag, History, Users } from 'lucide-react'
import { useRally } from '../store'
import { scoreMatch } from '../domain/engine'
import type { Match, Session } from '../domain/model'
import './collection.css'
import SessionActions from './SessionActions'
import ReportActions from './ReportActions'

export default function HistoryPage({
  onCorrectMatch,
}: { onCorrectMatch?: (matchId: string) => void } = {}) {
  const { data, readOnly } = useRally()
  const [filter, setFilter] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const sessions = [...data.sessions]
    .filter((session) => filter === 'all' || session.status === filter)
    .sort((a, b) => b.startedAt - a.startedAt)
  const completed = data.matches.filter((match) => match.status === 'completed').length
  const minutes = data.matches
    .filter((match) => match.status === 'completed' && match.endedAt)
    .reduce((sum, match) => sum + Math.max(0, (match.endedAt! - match.startedAt) / 60000), 0)

  return (
    <div className="collection-page history-page">
      <header className="collection-heading">
        <div>
          <p className="collection-eyebrow">THE GAMES THAT GOT YOU HERE</p>
          <h1>A little court history.</h1>
          <p>The scores, the partnerships, and the sessions worth remembering.</p>
        </div>
        <span className="collection-heading-icon">
          <History size={26} />
        </span>
      </header>
      <div className="history-overview">
        <div>
          <span>Sessions</span>
          <strong>{data.sessions.length}</strong>
        </div>
        <div>
          <span>Completed matches</span>
          <strong>{completed}</strong>
        </div>
        <div>
          <span>Recorded court time</span>
          <strong>
            {Math.round(minutes)}
            <small> min</small>
          </strong>
        </div>
      </div>
      <div className="collection-toolbar">
        <div>
          <h2>Session journal</h2>
          <p>Open a session to revisit its matches.</p>
        </div>
        <label className="collection-select">
          <span className="collection-sr">Filter sessions</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="all">All sessions</option>
            <option value="active">In progress</option>
            <option value="completed">Completed</option>
          </select>
          <ChevronDown size={16} />
        </label>
      </div>
      {sessions.length === 0 ? (
        <div className="collection-empty">
          <span className="collection-empty-icon">
            <CalendarDays size={29} />
          </span>
          <h3>
            {data.sessions.length
              ? 'No sessions in this view.'
              : 'Your first session is a story waiting to happen.'}
          </h3>
          <p>
            {data.sessions.length
              ? 'Try another filter to see your sessions.'
              : 'Start a session in Play. Every match you record will find a home here.'}
          </p>
        </div>
      ) : (
        <div className="history-list">
          {sessions.map((session) => {
            const matches = data.matches
              .filter((match) => match.sessionId === session.id)
              .sort((a, b) => a.startedAt - b.startedAt)
            const finished = matches.filter((match) => match.status === 'completed').length
            const open = expanded === session.id
            return (
              <article key={session.id} className={`history-session ${open ? 'expanded' : ''}`}>
                <button
                  className="history-session-toggle"
                  aria-expanded={open}
                  aria-controls={`session-${session.id}`}
                  onClick={() => setExpanded(open ? null : session.id)}
                >
                  <span className="history-date">
                    <strong>{new Date(session.startedAt).getDate()}</strong>
                    <span>
                      {new Date(session.startedAt).toLocaleDateString(undefined, {
                        month: 'short',
                      })}
                    </span>
                  </span>
                  <span className="history-session-main">
                    <span className="history-session-title">{session.name}</span>
                    <span className="history-session-details">
                      <span>
                        <Users size={14} />
                        {session.playerIds.length} players
                      </span>
                      <span>
                        <Flag size={14} />
                        {finished} completed
                      </span>
                      <span className="history-format">
                        {session.format === 'doubles' ? 'Doubles' : 'Singles'} · Best of{' '}
                        {session.bestOf}
                      </span>
                    </span>
                  </span>
                  <span
                    className={`collection-status ${session.status === 'active' ? 'live' : ''}`}
                  >
                    {session.status === 'active' ? 'In progress' : 'Completed'}
                  </span>
                  {open ? <ChevronUp size={19} /> : <ChevronDown size={19} />}
                </button>
                {open && (
                  <div className="history-session-body" id={`session-${session.id}`}>
                    <div className="history-session-actions">
                      <ReportActions data={data} sessionId={session.id} scopeLabel={session.name} />
                      <SessionActions session={session} onDeleted={() => setExpanded(null)} />
                    </div>
                    <p className="history-session-rules">
                      {new Date(session.startedAt).toLocaleDateString(undefined, {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}{' '}
                      · First to {session.target}, win by {session.winBy}, cap {session.cap}
                    </p>
                    {matches.length ? (
                      matches.map((match) => (
                        <MatchRecord
                          key={match.id}
                          match={match}
                          session={session}
                          names={Object.fromEntries(
                            data.players.map((player) => [player.id, player.name]),
                          )}
                          onCorrectMatch={readOnly ? undefined : onCorrectMatch}
                        />
                      ))
                    ) : (
                      <p className="history-no-matches">
                        No matches were recorded in this session.
                      </p>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
      <p className="collection-footnote">
        Stopped and unfinished matches stay in your journal but do not count toward wins or
        rankings. Court time is elapsed match duration, not tracked active rally time.
      </p>
    </div>
  )
}

function MatchRecord({
  match,
  session,
  names,
  onCorrectMatch,
}: {
  match: Match
  session: Session
  names: Record<string, string>
  onCorrectMatch?: (matchId: string) => void
}) {
  const score = scoreMatch(match, session)
  const ended = match.status === 'completed'
  const duration = match.endedAt
    ? Math.max(0, Math.round((match.endedAt - match.startedAt) / 60000))
    : null
  return (
    <div className="history-match">
      <div className="history-match-court">
        <span>Court {match.court}</span>
        <small>
          {new Date(match.startedAt).toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </small>
      </div>
      <div className="history-match-teams">
        <span className={ended && score.winner === 'A' ? 'winner' : ''}>
          {match.teamA.map((id) => names[id] || 'Unknown player').join(' & ')}
          {ended && score.winner === 'A' && <span className="collection-sr">, winning side</span>}
        </span>
        <span className={ended && score.winner === 'B' ? 'winner' : ''}>
          {match.teamB.map((id) => names[id] || 'Unknown player').join(' & ')}
          {ended && score.winner === 'B' && <span className="collection-sr">, winning side</span>}
        </span>
      </div>
      <div className="history-match-score">
        <strong>
          {[
            ...score.games.map((game) => `${game.a}–${game.b}`),
            ...(!score.complete ? [`${score.a}–${score.b}`] : []),
          ].join(' / ')}
        </strong>
        <span>
          {ended ? 'Final' : match.status === 'abandoned' ? 'Abandoned' : 'In progress'}
          {duration !== null && (
            <>
              {' '}
              · <Clock3 size={11} /> {duration} min
            </>
          )}
        </span>
        {ended && onCorrectMatch && (
          <button className="history-match-correct" onClick={() => onCorrectMatch(match.id)}>
            Correct result
          </button>
        )}
      </div>
    </div>
  )
}
