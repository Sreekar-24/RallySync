import { useEffect, useRef, useState } from 'react'
import {
  Check,
  CircleHelp,
  Focus,
  Minus,
  PencilLine,
  Plus,
  RotateCcw,
  Sun,
  Trophy,
  X,
} from 'lucide-react'
import { Modal } from '../../components'
import { useRally } from '../../store'
import {
  adjustMatchScores,
  canUndoScore,
  getScoreEntries,
  removePoint,
  scoreMatch,
} from '../../domain/engine'
import type { Match, Session, Side } from '../../domain/model'
import FinalScoreEntry from './FinalScoreEntry'
import ServiceCourt from './ServiceCourt'
import './scoring.css'
import { useWakeLock } from './useWakeLock'
import type { DraftControls } from './draft'
import { isMatchPaused, syncMatchTiming } from '../../domain/timing'
import MatchClock from './MatchClock'

type EntryMode = NonNullable<Session['scoringMode']>
function localMode(matchId: string, fallback: EntryMode, isDemo: boolean): EntryMode {
  if (isDemo) return fallback
  try {
    const value = localStorage.getItem(`rallysync-point-entry-${matchId}`)
    return value === 'team' || value === 'individual' || value === 'combined' ? value : fallback
  } catch {
    return fallback
  }
}

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
  const { data, commit, notify, readOnly, isDemo } = useRally()
  const score = scoreMatch(match, session)
  const [stopping, setStopping] = useState(false)
  const [editor, setEditor] = useState(false)
  const [courtEditing, setCourtEditing] = useState(false)
  const [draft, setDraft] = useState<{ a: string; b: string; revision: number } | null>(null)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<EntryMode>(() =>
    localMode(match.id, session.scoringMode ?? 'team', isDemo),
  )
  const [focused, setFocused] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [navigation, setNavigation] = useState<'close' | 'rules' | 'editor' | null>(null)
  const editorRef = useRef<DraftControls>(null)
  const courtRef = useRef<DraftControls>(null)
  const guardRef = useRef<HTMLDivElement>(null)
  const paused = isMatchPaused(match)
  const wake = useWakeLock(match.status === 'playing' && !score.complete && !paused)
  useEffect(() => {
    if (!navigation) return
    guardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
    guardRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  }, [navigation])
  const navigate = (destination: 'close' | 'rules' | 'editor') => {
    if (draft || editorRef.current?.dirty || courtRef.current?.dirty) setNavigation(destination)
    else completeNavigation(destination)
  }
  const completeNavigation = (destination: 'close' | 'rules' | 'editor') => {
    setNavigation(null)
    if (destination === 'editor') {
      setEditor(false)
      return
    }
    if (destination === 'rules') onRules()
    else onClose()
  }
  const applyAndNavigate = () => {
    if (!navigation) return
    const applied = draft
      ? applyDirect()
      : editorRef.current?.dirty
        ? editorRef.current.apply()
        : courtRef.current?.dirty
          ? courtRef.current.apply()
          : true
    if (applied) completeNavigation(navigation)
  }
  const recent = [...new Map(match.actions.map((action) => [action.id, action])).values()].slice(-5)

  const name = (id: string) => data.players.find((p) => p.id === id)?.name ?? 'Player'
  const addPoint = (side?: Side, playerId?: string) => {
    if (draft || courtEditing || editor) return
    commit((current) => ({
      ...current,
      matches: current.matches.map((m) => {
        if (m.id !== match.id || m.status !== 'playing' || isMatchPaused(m)) return m
        if (side && scoreMatch(m, session).complete) return m
        return syncMatchTiming(
          {
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
          },
          session,
        )
      }),
    }))
  }
  const subtractPoint = (side: Side, playerId?: string) => {
    if (draft || courtEditing || editor) return
    try {
      commit((current) => ({
        ...current,
        matches: current.matches.map((m) =>
          m.id === match.id && m.status === 'playing' && !isMatchPaused(m)
            ? syncMatchTiming(removePoint(m, session, side, playerId), session)
            : m,
        ),
      }))
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'This point could not be removed.')
    }
  }
  const applyDirect = (clearCurrentCredits = false) => {
    if (!draft || readOnly || paused) return false
    if (draft.a === '' || draft.b === '') {
      setError('Enter a score for both sides.')
      return false
    }
    try {
      const entries = getScoreEntries(match, session)
      entries[entries.length - 1] = {
        ...entries.at(-1)!,
        a: Number(draft.a),
        b: Number(draft.b),
        ...(clearCurrentCredits ? { credits: {} } : {}),
      }
      const changed = syncMatchTiming(adjustMatchScores(match, session, entries), session)
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
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Check the scores.')
      return false
    }
  }
  const finish = () => {
    if (draft || editor || courtEditing) return
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
    if (readOnly || draft || editor || courtEditing) return
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
  const editable = !readOnly && match.status === 'playing' && !paused
  return (
    <Modal
      title={`Court ${match.court} · Scoreboard`}
      subtitle={`${session.bestOf === 1 ? 'One game' : 'Best of 3'} · First to ${session.target}, win by ${session.winBy}, cap ${session.cap}`}
      onClose={() => navigate('close')}
      wide
    >
      <div className="scoreboard-meta">
        <span className={`tag ${score.complete ? '' : 'tag-live'}`}>
          {score.complete ? 'Review result' : `Game ${score.games.length + 1}`}
        </span>
        <button className="text-button" onClick={() => navigate('rules')}>
          <CircleHelp size={15} /> Quick rules
        </button>
      </div>
      <div className="scoring-view-options">
        <button className="text-button" aria-pressed={focused} onClick={() => setFocused(!focused)}>
          <Focus size={16} /> {focused ? 'Full scoreboard' : 'Focus scoring'}
        </button>
        {wake.supported && editable && !score.complete && (
          <button className="text-button" aria-pressed={wake.enabled} onClick={wake.toggle}>
            <Sun size={15} />{' '}
            {wake.status === 'on'
              ? 'Screen stays awake'
              : wake.status === 'requesting'
                ? 'Keeping screen awake…'
                : wake.status === 'unavailable'
                  ? 'Retry screen awake'
                  : 'Keep screen awake'}
          </button>
        )}
      </div>
      {wake.enabled && wake.status === 'unavailable' && (
        <p className="score-editor-note" role="status">
          Screen lock was not granted or was released. Your device may sleep.{' '}
          <button className="text-button" onClick={wake.disable}>
            Turn off
          </button>
        </p>
      )}
      {session.format === 'doubles' && (!focused || toolsOpen) && (
        <label className="scoring-mode-select">
          <span>Point entry</span>
          <select
            aria-label="Doubles point entry mode"
            value={mode}
            disabled={!editable || Boolean(draft) || editor || courtEditing}
            onChange={(event) => {
              const selected = event.target.value as EntryMode
              setMode(selected)
              if (!isDemo) {
                try {
                  localStorage.setItem(`rallysync-point-entry-${match.id}`, selected)
                } catch {
                  /* Scoring works without preference storage. */
                }
              }
            }}
          >
            <option value="team">Team totals</option>
            <option value="individual">Player credits</option>
            <option value="combined">Team + player credits</option>
          </select>
          <small>For this match on this device. Other courts keep their own setting.</small>
        </label>
      )}
      {session.format === 'doubles' &&
        (!focused || toolsOpen) &&
        mode !== (session.scoringMode ?? 'team') && (
          <button
            className="text-button scoring-session-default"
            disabled={!editable}
            onClick={() => {
              commit((current) => ({
                ...current,
                sessions: current.sessions.map((item) =>
                  item.id === session.id ? { ...item, scoringMode: mode } : item,
                ),
              }))
              notify(
                'Session default updated. Match preferences already chosen on this device stay in place.',
              )
            }}
          >
            Use as session default
          </button>
        )}
      <MatchClock
        match={match}
        session={session}
        disabled={readOnly || Boolean(draft) || editor || courtEditing}
      />
      <div className={focused ? 'focused-scoring' : undefined}>
        <ServiceCourt
          match={match}
          session={session}
          disabled={!editable || Boolean(draft) || editor}
          onEditingChange={setCourtEditing}
          draftRef={courtRef}
        />
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
                    disabled={!editable || editor || courtEditing}
                    onFocus={(event) => event.currentTarget.select()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && draft) applyDirect()
                      if (event.key === 'Escape' && draft) {
                        event.preventDefault()
                        event.stopPropagation()
                        setDraft(null)
                        setError('')
                      }
                    }}
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
                <div className="score-counter-controls">
                  <button
                    className="button score-subtract"
                    aria-label={`Remove point from side ${side}`}
                    disabled={!editable || value <= 0 || Boolean(draft) || editor || courtEditing}
                    onClick={() => subtractPoint(side)}
                  >
                    <Minus size={20} />
                  </button>
                  <button
                    className="button score-add"
                    aria-label={`Point to side ${side}`}
                    title={
                      mode === 'individual' && session.format === 'doubles'
                        ? 'Add an unassigned team point'
                        : 'Add one point'
                    }
                    disabled={
                      !editable || score.complete || Boolean(draft) || editor || courtEditing
                    }
                    onClick={() => addPoint(side)}
                  >
                    <Plus size={20} />{' '}
                    {mode === 'individual' && session.format === 'doubles' ? 'Team' : 'Point'}
                  </button>
                </div>
                {session.format === 'doubles' && mode !== 'team' && (!focused || toolsOpen) && (
                  <div className="individual-score-controls">
                    {ids.map((id) => (
                      <div className="individual-point-row" key={id}>
                        <button
                          type="button"
                          className="individual-remove"
                          disabled={
                            !editable ||
                            !(score.credits[id] > 0) ||
                            Boolean(draft) ||
                            editor ||
                            courtEditing
                          }
                          onClick={() => subtractPoint(side, id)}
                          aria-label={`Remove point from ${name(id)}`}
                        >
                          <Minus size={15} />
                        </button>
                        <button
                          type="button"
                          className="individual-point"
                          disabled={
                            !editable || score.complete || Boolean(draft) || editor || courtEditing
                          }
                          onClick={() => addPoint(side, id)}
                          aria-label={`Point to ${name(id)}`}
                        >
                          <span>{name(id)}</span>
                          <strong>{score.credits[id] ?? 0}</strong>
                          <Plus size={15} />
                        </button>
                      </div>
                    ))}
                    <span className="unassigned-score">
                      {Math.max(0, value - credited)} unassigned points
                    </span>
                  </div>
                )}
              </section>
            )
          })}
        </div>
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
          <button className="button primary" onClick={() => applyDirect()} disabled={!editable}>
            Apply score <Check size={15} />
          </button>
        </div>
      )}
      {error && (
        <div className="score-editor-error" role="alert">
          {error}
          {draft && error.includes('credits exceed') && (
            <button className="text-button" onClick={() => applyDirect(true)}>
              Apply totals with this game’s player credits unassigned
            </button>
          )}
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
            disabled={
              readOnly || Boolean(draft) || editor || courtEditing || match.status === 'abandoned'
            }
            onClick={() => (match.status === 'completed' ? setEditor(true) : finish())}
          >
            {match.status === 'completed' ? 'Correct result' : 'Confirm result'} <Check size={17} />
          </button>
        </div>
      ) : (
        <p className="score-help" aria-live="polite">
          {session.format === 'doubles' && mode !== 'team' && (!focused || toolsOpen)
            ? 'Player credits add to the side total. Unassigned points remain separate.'
            : 'Tap + or − for a rally, or type a score to correct it directly.'}
        </p>
      )}
      {match.status === 'playing' && (
        <div className="score-tools">
          <button
            className="button ghost"
            disabled={
              !editable || !canUndoScore(match, session) || Boolean(draft) || editor || courtEditing
            }
            onClick={() => addPoint()}
          >
            <RotateCcw size={16} /> Undo last action
          </button>
          {focused && (
            <button
              className="text-button scoring-more-tools"
              aria-expanded={toolsOpen}
              onClick={() => setToolsOpen(!toolsOpen)}
            >
              {toolsOpen ? 'Hide extra tools' : 'More scoring tools'}
            </button>
          )}

          <span className="score-secondary-tools" hidden={focused && !toolsOpen}>
            <button
              className="button ghost"
              aria-expanded={editor}
              disabled={!editable || Boolean(draft) || courtEditing}
              onClick={() => (editor ? navigate('editor') : setEditor(true))}
            >
              <PencilLine size={15} />
              {editor ? 'Close score editor' : 'Edit all scores'}
            </button>
            <button
              className="button danger-ghost"
              disabled={readOnly || Boolean(draft) || editor || courtEditing}
              onClick={() => setStopping(!stopping)}
            >
              Stop match
            </button>
          </span>
        </div>
      )}
      {editor && (
        <FinalScoreEntry
          key={match.id}
          match={match}
          session={{ ...session, scoringMode: mode }}
          onSaved={() => setEditor(false)}
          draftRef={editorRef}
        />
      )}
      {recent.length > 0 && (
        <details className="recent-rallies" open={focused ? undefined : true}>
          <summary>Recent scoring actions</summary>
          <ol aria-label="Recent scoring actions">
            {recent.map((action) => {
              const target = action.targetId
                ? match.actions.find((item) => item.id === action.targetId)
                : undefined
              const side = action.side ?? target?.side
              return (
                <li key={action.id}>
                  {action.kind === 'point'
                    ? `Side ${side} +1${action.playerId ? ` · ${name(action.playerId)}` : ''}${action.synthetic ? ' · imported' : ''}`
                    : action.kind === 'remove'
                      ? `Side ${side ?? '?'} −1${target?.playerId ? ` · ${name(target.playerId)}` : ''}`
                      : action.kind === 'undo'
                        ? 'Undo previous action'
                        : `Scores corrected · ${action.scores?.map((game) => `${game.a}–${game.b}`).join(' / ') ?? 'review totals'}`}
                </li>
              )
            })}
          </ol>
          <p>Latest actions in entry order. Undo and corrections can change earlier points.</p>
        </details>
      )}
      {navigation && (
        <div
          className="draft-navigation"
          role="alertdialog"
          aria-label="Unapplied changes"
          aria-describedby="draft-navigation-description"
          ref={guardRef}
        >
          <strong>Keep your changes?</strong>
          <p id="draft-navigation-description">
            {draft
              ? 'Your typed scores have not been applied.'
              : editorRef.current?.dirty
                ? 'Your score and player allocation edits have not been applied.'
                : 'Your court positions have not been saved.'}
          </p>
          <div>
            <button className="button ghost" onClick={() => setNavigation(null)}>
              Keep editing
            </button>
            <button className="button primary" onClick={applyAndNavigate}>
              Apply & continue
            </button>
            <button
              className="text-button"
              onClick={() => {
                if (navigation) completeNavigation(navigation)
              }}
            >
              Discard & continue
            </button>
          </div>
        </div>
      )}
      {stopping && (
        <div className="notice warning">
          <div>
            <strong>Stop without a result?</strong>
            <p>Partial scores stay in history, outside the rankings.</p>
          </div>
          <button
            className="button danger"
            disabled={readOnly || Boolean(draft) || editor || courtEditing}
            onClick={abandon}
          >
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
