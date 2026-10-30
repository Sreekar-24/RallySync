import { useImperativeHandle, useState, type Ref } from 'react'
import type { DraftControls } from './draft'
import { isMatchPaused, syncMatchTiming } from '../../domain/timing'
import { Check, PencilLine, RotateCcw } from 'lucide-react'
import { useRally } from '../../store'
import type { Match, Session } from '../../domain/model'
import { adjustMatchScores, buildFinalResult, getScoreEntries } from '../../domain/engine'
import './scoring.css'

type DraftGame = { a: string; b: string; credits: Record<string, string> }

/** Explicit score editing. Inputs remain drafts until the organizer applies them. */
export default function FinalScoreEntry({
  session,
  match,
  onSaved,
  draftRef,
}: {
  session: Session
  match: Match
  onSaved: () => void
  draftRef?: Ref<DraftControls>
}) {
  const { data, commit, readOnly, notify } = useRally()
  const original = getScoreEntries(match, session)
  const [games, setGames] = useState<DraftGame[]>(() =>
    Array.from({ length: session.bestOf }, (_, i) => ({
      a: original[i] ? String(original[i].a) : '',
      b: original[i] ? String(original[i].b) : '',
      credits: Object.fromEntries(
        Object.entries(original[i]?.credits ?? {}).map(([id, n]) => [id, String(n)]),
      ),
    })),
  )
  const [initialGames] = useState(() => JSON.stringify(games))
  const [error, setError] = useState('')
  const [editingRevision] = useState(match.revision)
  const completed = match.status === 'completed'
  const showCredits =
    session.format === 'doubles' &&
    ((session.scoringMode ?? 'team') !== 'team' ||
      original.some((g) => Object.keys(g.credits).length))
  const [allocation, setAllocation] = useState(Boolean(showCredits))
  const names = (id: string) => data.players.find((p) => p.id === id)?.name ?? 'Player'
  const updateCredit = (gameIndex: number, id: string, value: string) => {
    setGames((current) =>
      current.map((game, index) => {
        if (index !== gameIndex) return game
        const side = match.teamA.includes(id) ? 'a' : 'b'
        const players = side === 'a' ? match.teamA : match.teamB
        const before = players.reduce((sum, p) => sum + Number(game.credits[p] || 0), 0)
        const credits = { ...game.credits, [id]: value }
        const after = players.reduce((sum, p) => sum + Number(credits[p] || 0), 0)
        const unassigned = Math.max(0, Number(game[side] || 0) - before)
        return { ...game, [side]: String(unassigned + after), credits }
      }),
    )
  }
  const apply = () => {
    if (readOnly || isMatchPaused(match)) {
      setError('Resume the match before editing scores.')
      return false
    }
    setError('')
    const last = games.findLastIndex((g) => g.a !== '' || g.b !== '')
    const entered = games.slice(0, last + 1)
    if (!entered.length || entered.some((g) => g.a === '' || g.b === '')) {
      setError('Enter complete scores in game order, starting with game 1.')
      return false
    }
    try {
      const entries = entered.map((g) => ({
        a: Number(g.a),
        b: Number(g.b),
        credits: Object.fromEntries(
          Object.entries(g.credits)
            .filter(([, n]) => n !== '')
            .map(([id, n]) => [id, Number(n)]),
        ),
      }))
      // A historical correction must still be a decided result. A live edit stays provisional.
      const changed = syncMatchTiming(
        completed
          ? buildFinalResult(match, session, entries)
          : adjustMatchScores(match, session, entries),
        session,
      )
      commit((current) => {
        if (current.matches.find((m) => m.id === match.id)?.revision !== editingRevision)
          throw new Error(
            'This match changed while you were editing. Close the editor and review the latest score.',
          )
        return {
          ...current,
          matches: current.matches.map((m) => (m.id === match.id ? changed : m)),
        }
      })
      notify(
        completed
          ? 'Corrected result saved. Standings have been recalculated.'
          : 'Scores updated. Confirm the result when the match is decided.',
      )
      onSaved()
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Check the scores and try again.')
      return false
    }
  }
  useImperativeHandle(draftRef, () => ({ dirty: JSON.stringify(games) !== initialGames, apply }))
  return (
    <form
      className="score-editor"
      onSubmit={(event) => {
        event.preventDefault()
        apply()
      }}
    >
      <div className="score-editor-heading">
        <PencilLine size={18} />
        <div>
          <h3>{completed ? 'Correct the result' : 'Edit the scoreboard'}</h3>
          <p>
            {completed
              ? 'Review every game before saving the corrected winner.'
              : 'Change a total directly. Nothing changes until you apply.'}
          </p>
        </div>
      </div>
      {games.map((game, index) => (
        <fieldset className="score-editor-game" key={index}>
          <legend>
            Game {index + 1}
            {index > original.length - 1 ? ' · optional' : ''}
          </legend>
          <div className="score-editor-totals">
            {(['a', 'b'] as const).map((side) => (
              <label key={side}>
                Side {side.toUpperCase()}
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max={session.cap}
                  step="1"
                  aria-label={`Game ${index + 1} side ${side.toUpperCase()}`}
                  value={game[side]}
                  onChange={(e) => {
                    setError('')
                    setGames((current) =>
                      current.map((g, i) => (i === index ? { ...g, [side]: e.target.value } : g)),
                    )
                  }}
                />
              </label>
            ))}
          </div>
          {allocation && (
            <div className="score-editor-credits">
              {[match.teamA, match.teamB].map((ids, team) => (
                <div key={team}>
                  {ids.map((id) => (
                    <label key={id}>
                      {names(id)}
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        max={session.cap}
                        step="1"
                        aria-label={`Game ${index + 1} credited points for ${names(id)}`}
                        value={game.credits[id] ?? '0'}
                        onChange={(e) => {
                          setError('')
                          updateCredit(index, id, e.target.value)
                        }}
                      />
                    </label>
                  ))}
                  <small>
                    Unassigned:{' '}
                    {Math.max(
                      0,
                      Number(game[team === 0 ? 'a' : 'b'] || 0) -
                        ids.reduce((sum, id) => sum + Number(game.credits[id] || 0), 0),
                    )}
                  </small>
                </div>
              ))}
            </div>
          )}
        </fieldset>
      ))}
      {session.bestOf === 3 && (
        <p className="score-editor-note">
          Leave unused future games empty. An unfinished current game is allowed while playing.
        </p>
      )}
      {session.format === 'doubles' && (
        <button
          type="button"
          className="text-button"
          onClick={() => setAllocation(!allocation)}
          aria-expanded={allocation}
        >
          {allocation ? 'Hide' : 'Edit'} individual point allocation
        </button>
      )}
      {games.some((g) => Object.values(g.credits).some((n) => Number(n) > 0)) && (
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setGames((current) => current.map((g) => ({ ...g, credits: {} })))
            setError('')
          }}
        >
          <RotateCcw size={14} /> Mark all entered points unassigned
        </button>
      )}
      {error && (
        <p className="score-editor-error" role="alert">
          {error}
        </p>
      )}
      <p className="score-editor-note">
        Player credits plus unassigned points equal the side total. Changing a player’s credit
        updates that total. Corrections remain in the audit log.
      </p>
      <button className="button primary" type="submit" disabled={readOnly || isMatchPaused(match)}>
        {completed ? 'Save corrected result' : 'Apply scores'} <Check size={17} />
      </button>
    </form>
  )
}

export { FinalScoreEntry }
