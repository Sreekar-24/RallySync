import { useState } from 'react'
import { Check, CircleHelp, PencilLine, Plus, RotateCcw, Trophy, X } from 'lucide-react'
import { Avatar, Modal } from '../../components'
import { useRally } from '../../store'
import { adjustMatchScores, canUndoScore, getScoreEntries, scoreMatch } from '../../domain/engine'
import type { Match, Session, Side } from '../../domain/model'
import FinalScoreEntry from './FinalScoreEntry'
import './scoring.css'

export default function ScoreDialog({
  match,
  session,
  onClose,
  onRules,
}: {
  match: Match
  session: Session
  onClose: () => void
  onRules: () => void
}) {
  const { data, commit, notify, readOnly } = useRally()
  const score = scoreMatch(match, session)
  const [stopping, setStopping] = useState(false)
  const [editor, setEditor] = useState(false)
  const [draft, setDraft] = useState<{ a: string; b: string; revision: number } | null>(null)
  const [error, setError] = useState('')
  const mode = session.scoringMode ?? 'team'
  const name = (id: string) => data.players.find((p) => p.id === id)?.name ?? 'Player'
  const addPoint = (side?: Side, playerId?: string) => {
    if (draft) return
    commit((current) => ({
      ...current,
      matches: current.matches.map((m) => {
        if (m.id !== match.id || m.status !== 'playing') return m
        if (side && scoreMatch(m, session).complete) return m
        return {
          ...m,
          revision: m.revision + 1,
          actions: [
            ...m.actions,
            {
              id: crypto.randomUUID(),
              kind: side ? ('point' as const) : ('undo' as const),
              side,
              playerId,
              synthetic: side ? false : undefined,
              at: Date.now(),
            },
          ],
        }
      }),
    }))
  }
  const applyDirect = () => {
    if (!draft) return
    if (draft.a === '' || draft.b === '') {
      setError('Enter a score for both sides.')
      return
    }
    try {
      const entries = getScoreEntries(match, session)
      entries[entries.length - 1] = { ...entries.at(-1)!, a: Number(draft.a), b: Number(draft.b) }
      const changed = adjustMatchScores(match, session, entries)
      commit((current) => {
        if (current.matches.find((m) => m.id === match.id)?.revision !== draft.revision)
          throw new Error(
            'The match changed while you were editing. Cancel and review the latest score.',
          )
        return {
          ...current,
          matches: current.matches.map((m) => (m.id === match.id ? changed : m)),
        }
      })
      setDraft(null)
      setError('')
      notify('Score corrected. Undo is available if needed.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Check the scores.')
    }
  }
  const finish = () => {
    if (draft || editor) return
    commit((current) => ({
      ...current,
      matches: current.matches.map((m) =>
        m.id === match.id && m.status === 'playing' && scoreMatch(m, session).complete
          ? { ...m, status: 'completed', endedAt: Date.now(), revision: m.revision + 1 }
          : m,
      ),
    }))
    notify('Result confirmed. Wins and rankings are updated.')
    onClose()
  }
  const abandon = () => {
    commit((current) => ({
      ...current,
      matches: current.matches.map((m) =>
        m.id === match.id && m.status === 'playing'
          ? { ...m, status: 'abandoned', endedAt: Date.now(), revision: m.revision + 1 }
          : m,
      ),
    }))
    notify('Match stopped. Partial points stay outside the rankings.')
    onClose()
  }
  const editable = !readOnly && match.status === 'playing'
  return (
    <Modal
      title={`Court ${match.court} · Scoreboard`}
      subtitle={`${session.bestOf === 1 ? 'One game' : 'Best of 3'} · First to ${session.target}, win by ${session.winBy}, cap ${session.cap}`}
      onClose={onClose}
      wide
    >
      <div className="scoreboard-meta">
        <span className={`tag ${score.complete ? '' : 'tag-live'}`}>
          {score.complete ? 'Review result' : `Game ${score.games.length + 1}`}
        </span>
        <button className="text-button" onClick={onRules}>
          <CircleHelp size={15} /> Quick rules
        </button>
      </div>
      {session.format === 'doubles' && (
        <label className="scoring-mode-select">
          <span>Point entry</span>
          <select
            aria-label="Doubles point entry mode"
            value={mode}
            disabled={!editable || Boolean(draft) || editor}
            onChange={(event) => {
              const scoringMode = event.target.value as 'team' | 'individual' | 'combined'
              commit((current) => ({
                ...current,
                sessions: current.sessions.map((s) =>
                  s.id === session.id ? { ...s, scoringMode } : s,
                ),
              }))
            }}
          >
            <option value="team">Team totals</option>
            <option value="individual">Player credits</option>
            <option value="combined">Team + player credits</option>
          </select>
          <small>Previously unassigned points stay unassigned.</small>
        </label>
      )}
      <div className="scoreboard scoring-enhanced">
        {(['A', 'B'] as const).map((side) => {
          const ids = side === 'A' ? match.teamA : match.teamB
          const value = side === 'A' ? score.a : score.b
          const credited = ids.reduce((sum, id) => sum + (score.credits[id] ?? 0), 0)
          return (
            <section
              className={`score-side score-side-${side.toLowerCase()} ${score.complete && score.winner === side ? 'score-winner' : ''}`}
              key={side}
              aria-label={`Side ${side}`}
            >
              <div className="score-side-avatars">
                {ids.map((id, i) => (
                  <Avatar key={id} name={name(id)} index={side === 'A' ? i : i + 2} />
                ))}
              </div>
              <span className="score-side-label">
                SIDE {side}
                {score.complete && score.winner === side ? ' · LEADING RESULT' : ''}
              </span>
              <strong className="score-names">{ids.map(name).join(' & ')}</strong>
              <label className="direct-score-label">
                <span className="sr-only">
                  Side {side} score {value}
                </span>
                <input
                  className="direct-score-input"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max={session.cap}
                  step="1"
                  aria-label={`Side ${side} score ${value}`}
                  value={draft ? draft[side === 'A' ? 'a' : 'b'] : value}
                  disabled={!editable || editor}
                  onChange={(e) => {
                    setError('')
                    const key = side === 'A' ? 'a' : 'b'
                    setDraft((current) => ({
                      ...(current ?? {
                        a: String(score.a),
                        b: String(score.b),
                        revision: match.revision,
                      }),
                      [key]: e.target.value,
                    }))
                  }}
                />
              </label>
              <span className="score-tap-hint">
                <PencilLine size={11} /> Tap score to edit
              </span>
              {(mode !== 'individual' || session.format !== 'doubles') && (
                <button
                  className="button score-add"
                  aria-label={`Point to side ${side}`}
                  disabled={!editable || score.complete || Boolean(draft) || editor}
                  onClick={() => addPoint(side)}
                >
                  <Plus size={20} /> Point
                </button>
              )}
              {session.format === 'doubles' && mode !== 'team' && (
                <div className="individual-score-controls">
                  {ids.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className="individual-point"
                      disabled={!editable || score.complete || Boolean(draft) || editor}
                      onClick={() => addPoint(side, id)}
                      aria-label={`Point to ${name(id)}`}
                    >
                      <span>{name(id)}</span>
                      <strong>{score.credits[id] ?? 0}</strong>
                      <Plus size={15} />
                    </button>
                  ))}
                  <span className="unassigned-score">
                    {Math.max(0, value - credited)} unassigned points
                  </span>
                  {mode === 'individual' && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={!editable || score.complete || Boolean(draft) || editor}
                      onClick={() => addPoint(side)}
                    >
                      + Team / unassigned
                    </button>
                  )}
                </div>
              )}
            </section>
          )
        })}
      </div>
      {draft && (
        <div className="direct-score-actions">
          <div>
            <strong>Apply your correction?</strong>
            <span>No points change until you apply.</span>
          </div>
          <button
            className="button ghost"
            onClick={() => {
              setDraft(null)
              setError('')
            }}
          >
            Cancel edit
          </button>
          <button className="button primary" onClick={applyDirect} disabled={!editable}>
            Apply score <Check size={15} />
          </button>
        </div>
      )}
      {error && (
        <div className="score-editor-error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() => {
              setDraft(null)
              setEditor(true)
              setError('')
            }}
          >
            Edit all scores and player allocation
          </button>
        </div>
      )}
      {session.bestOf === 3 && (
        <div className="game-summary">
          <span>Games</span>
          <strong>
            {score.gamesA} – {score.gamesB}
          </strong>
          {score.games.map((g, i) => (
            <span className="tag" key={i}>
              G{i + 1}: {g.a}–{g.b}
            </span>
          ))}
        </div>
      )}
      {score.complete ? (
        <div className="match-complete scoring-review">
          <Trophy size={23} />
          <div>
            <strong role="status">
              {match.status === 'completed' ? 'Result confirmed' : 'Winning score reached'}
            </strong>
            <span>
              {(score.winner === 'A' ? match.teamA : match.teamB).map(name).join(' & ')} ·{' '}
              {score.games.map((g) => `${g.a}–${g.b}`).join(' / ')}
            </span>
            <small>
              {match.status === 'completed'
                ? 'This result counts in standings. Corrections recalculate the winner.'
                : 'You can still edit. Wins count only after confirmation.'}
            </small>
          </div>
          <button
            className="button primary"
            disabled={readOnly || Boolean(draft) || editor || match.status === 'abandoned'}
            onClick={() => (match.status === 'completed' ? setEditor(true) : finish())}
          >
            {match.status === 'completed' ? 'Correct result' : 'Confirm result'} <Check size={17} />
          </button>
        </div>
      ) : (
        <p className="score-help" aria-live="polite">
          {session.format === 'doubles' && mode !== 'team'
            ? 'Player credits add to the side total. Unassigned points remain separate.'
            : 'Tap + for a rally, or tap a score to correct it directly.'}
        </p>
      )}
      {match.status === 'playing' && (
        <div className="score-tools">
          <button
            className="button ghost"
            disabled={!editable || !canUndoScore(match, session) || Boolean(draft) || editor}
            onClick={() => addPoint()}
          >
            <RotateCcw size={16} /> Undo last action
          </button>
          <button
            className="button ghost"
            aria-expanded={editor}
            disabled={!editable || Boolean(draft)}
            onClick={() => setEditor(!editor)}
          >
            <PencilLine size={15} />
            {editor ? 'Close score editor' : 'Edit all scores'}
          </button>
          <button
            className="button danger-ghost"
            disabled={!editable}
            onClick={() => setStopping(!stopping)}
          >
            Stop match
          </button>
        </div>
      )}
      {editor && (
        <FinalScoreEntry
          key={match.id}
          match={match}
          session={session}
          onSaved={() => setEditor(false)}
        />
      )}
      {stopping && (
        <div className="notice warning">
          <div>
            <strong>Stop without a result?</strong>
            <p>Partial scores stay in history, outside the rankings.</p>
          </div>
          <button className="button danger" onClick={abandon}>
            Stop match
          </button>
          <button
            className="icon-button"
            aria-label="Keep match playing"
            onClick={() => setStopping(false)}
          >
            <X size={17} />
          </button>
        </div>
      )}
    </Modal>
  )
}
