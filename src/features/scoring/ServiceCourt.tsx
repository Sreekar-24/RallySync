import { useEffect, useImperativeHandle, useState, type Ref } from 'react'
import type { DraftControls } from './draft'
import { ArrowLeftRight, Check, CircleHelp, RotateCw, X } from 'lucide-react'
import { Shuttle } from '../../components'
import type { Match, Session, Side } from '../../domain/model'
import { scoreMatch } from '../../domain/engine'
import { configureService, getServiceState } from '../../domain/serving'
import { useRally } from '../../store'
import './service-court.css'

type CourtDraft = {
  positions: { A: string[]; B: string[] }
  servingSide: Side
  nearSide: Side
  revision: number
}

/** Positions are service courts, relative to each player's view facing the net. */
export default function ServiceCourt({
  match,
  session,
  disabled,
  onEditingChange,
  draftRef,
}: {
  match: Match
  session: Session
  disabled: boolean
  onEditingChange: (value: boolean) => void
  draftRef?: Ref<DraftControls>
}) {
  const { data, commit, readOnly, notify } = useRally()
  const state = getServiceState(match, session)
  const score = scoreMatch(match, session)
  const [draft, setDraft] = useState<CourtDraft | null>(null)
  const [error, setError] = useState('')
  const [help, setHelp] = useState(false)
  const editing = Boolean(draft)
  useEffect(() => onEditingChange(editing), [editing, onEditingChange])
  const name = (id: string) => data.players.find((p) => p.id === id)?.name ?? 'Player'
  const current = draft ?? state
  const ready = state.status === 'ready' && !draft
  const servingScore = current.servingSide === 'A' ? score.a : score.b
  const serviceIndex = servingScore % 2
  const currentServer =
    current.positions[current.servingSide][session.format === 'singles' ? 0 : serviceIndex]
  const receivingSide = current.servingSide === 'A' ? 'B' : 'A'
  const receiver = current.positions[receivingSide][session.format === 'singles' ? 0 : serviceIndex]
  const canEdit = !disabled && !readOnly && match.status === 'playing' && !score.complete
  const needsCheck = state.status === 'check'
  const firstServeSide =
    state.game > 1 && score.a === 0 && score.b === 0 ? score.games.at(-1)?.winner : undefined
  const courtName = serviceIndex === 0 ? 'right' : 'left'
  const atChangeEnds =
    session.bestOf === 3 &&
    session.target === 21 &&
    session.cap === 30 &&
    session.winBy === 2 &&
    state.game === 3 &&
    Math.max(score.a, score.b) === 11
  const initialDraft = (): CourtDraft => ({
    positions: { A: [...state.positions.A], B: [...state.positions.B] },
    servingSide: state.servingSide,
    nearSide: state.nearSide,
    revision: match.revision,
  })
  const begin = () => {
    setDraft(initialDraft())
    setError('')
  }
  const selectServer = (side: Side, id: string) => {
    if (!canEdit) return
    if (firstServeSide && side !== firstServeSide) {
      setError(
        `Side ${firstServeSide} won the last game and serves first. You can swap the receiving partners below.`,
      )
      return
    }
    setError('')
    setDraft((previous) => {
      const next = previous ?? initialDraft()
      const index = (side === 'A' ? score.a : score.b) % 2
      const positions = { A: [...next.positions.A], B: [...next.positions.B] }
      if (positions[side].length === 2 && positions[side][index] !== id) positions[side].reverse()
      return { ...next, positions, servingSide: side }
    })
  }
  const save = () => {
    if (!draft || !canEdit) return false
    try {
      commit((currentData) => {
        const latest = currentData.matches.find((m) => m.id === match.id)
        if (!latest || latest.revision !== draft.revision)
          throw new Error('The score changed. Cancel and check the latest positions.')
        const changed = configureService(latest, session, draft)
        return {
          ...currentData,
          matches: currentData.matches.map((m) => (m.id === match.id ? changed : m)),
        }
      })
      setDraft(null)
      notify('Service positions saved. The court follows your next rallies.')
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Check the service positions.')
      return false
    }
  }
  useImperativeHandle(draftRef, () => ({ dirty: Boolean(draft), apply: save }))
  if (score.complete) return null
  const position = (side: Side, id: string) => {
    const near = current.nearSide === side
    let right = current.positions[side].indexOf(id) === 0
    if (session.format === 'singles') right = serviceIndex === 0
    return { left: `${near === right ? 73 : 27}%`, top: `${near ? 75 : 25}%` }
  }
  const serverPosition = currentServer ? position(current.servingSide, currentServer) : null
  const receiverPosition = receiver ? position(receivingSide, receiver) : null
  return (
    <section
      className={`service-panel ${needsCheck ? 'service-needs-check' : ''} ${editing ? 'service-editing' : ''}`}
      aria-label="Service positions"
    >
      <div className="service-heading">
        <div>
          <span className="service-eyebrow">
            {editing ? `GAME ${state.game} · SET THE COURT` : 'NEXT SERVE'}
          </span>
          <strong className="service-status" role="status" aria-live="polite">
            {draft
              ? `${name(currentServer)} · ${courtName} court`
              : ready
                ? `${name(state.serverId!)} serves · ${courtName}`
                : needsCheck
                  ? 'Check positions'
                  : 'Who serves first?'}
          </strong>
        </div>
        <div className="service-heading-actions">
          <button
            className="icon-button"
            aria-label="About service positions"
            aria-expanded={help}
            onClick={() => setHelp(!help)}
          >
            <CircleHelp size={16} />
          </button>
          {!draft && (
            <button className="text-button" onClick={begin} disabled={!canEdit}>
              {ready ? 'Adjust positions' : needsCheck ? 'Reset positions' : 'Set first serve'}
            </button>
          )}
        </div>
      </div>
      <div className="position-court" role="group" aria-label="Court viewed from the near end">
        <div className="position-court-lines" aria-hidden="true" />
        <span className="position-net" aria-hidden="true">
          NET
        </span>
        {(ready || draft) && serverPosition && receiverPosition && (
          <svg
            className="service-flight"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              d={`M${parseInt(serverPosition.left)} ${parseInt(serverPosition.top)} L${parseInt(receiverPosition.left)} ${parseInt(receiverPosition.top)}`}
            />
          </svg>
        )}
        {(['A', 'B'] as const).flatMap((side) =>
          (side === 'A' ? match.teamA : match.teamB).map((id) => {
            const serving = (ready || editing) && id === currentServer
            const receiving = (ready || editing) && id === receiver
            const ownRight =
              session.format === 'singles' ? serviceIndex === 0 : current.positions[side][0] === id
            return (
              <button
                key={id}
                type="button"
                className={`service-player service-player-${side.toLowerCase()} ${serving ? 'is-serving' : ''} ${receiving ? 'is-receiving' : ''}`}
                style={position(side, id)}
                onClick={() => selectServer(side, id)}
                disabled={!canEdit}
                aria-label={`Set server: ${name(id)}, side ${side}, ${ownRight ? 'right' : 'left'} court`}
                aria-pressed={Boolean(serving)}
                title={name(id)}
              >
                <span className="service-seat">
                  {side} · {ownRight ? 'Right' : 'Left'}{' '}
                  <span className="serve-choice-dot" aria-hidden="true" />
                </span>
                <strong>{name(id)}</strong>
                <span className="service-player-role">
                  {serving ? (
                    <>
                      <Shuttle size={12} /> Serve
                    </>
                  ) : receiving ? (
                    'Receive'
                  ) : ready || editing ? (
                    'Partner'
                  ) : (
                    'Tap to set'
                  )}
                </span>
              </button>
            )
          }),
        )}
      </div>
      {draft ? (
        <div className="service-setup-tools">
          <p>
            {firstServeSide
              ? `Side ${firstServeSide} serves first after winning the last game. `
              : 'Tap the server. '}
            Match partners to their courts.
          </p>
          <div className="service-position-actions">
            {session.format === 'doubles' &&
              (['A', 'B'] as const).map((side) => (
                <button
                  key={side}
                  className="button ghost"
                  disabled={!canEdit}
                  aria-label={`Swap side ${side} positions`}
                  onClick={() =>
                    setDraft((previous) =>
                      previous
                        ? {
                            ...previous,
                            positions: {
                              ...previous.positions,
                              [side]: [...previous.positions[side]].reverse(),
                            },
                          }
                        : previous,
                    )
                  }
                >
                  <ArrowLeftRight size={14} /> Swap {side}
                </button>
              ))}
            <button
              className="button ghost"
              disabled={!canEdit}
              onClick={() =>
                setDraft((previous) =>
                  previous
                    ? { ...previous, nearSide: previous.nearSide === 'A' ? 'B' : 'A' }
                    : previous,
                )
              }
            >
              <RotateCw size={14} /> Flip view
            </button>
            <button
              className="icon-button"
              aria-label="Cancel position changes"
              onClick={() => {
                setDraft(null)
                setError('')
              }}
            >
              <X size={17} />
            </button>
            <button className="button primary" disabled={!canEdit} onClick={save}>
              <Check size={15} />{' '}
              {ready || match.serviceSetup ? 'Save positions' : 'Start tracking'}
            </button>
          </div>
        </div>
      ) : (
        <p className="service-caption">
          {ready
            ? `${name(state.receiverId!)} receives diagonally. ${servingScore % 2 === 0 ? 'Even → right' : 'Odd → left'}.`
            : needsCheck
              ? 'The score was corrected. Match the court to resume tracking.'
              : state.game > 1 && score.a === 0 && score.b === 0
                ? `New game · change ends. Side ${state.servingSide} serves first; choose either partner.`
                : 'Tap a player’s dot to choose the first server and set positions.'}
        </p>
      )}
      {atChangeEnds && !draft && (
        <p className="service-interval-note">
          11-point interval · change ends. Service order stays the same.
        </p>
      )}
      {help && (
        <div className="service-explanation">
          <p>
            Right and left are each player’s own view facing the net. These are positions for the
            next serve; players can move freely during a rally.
          </p>
          <p>
            Only a serving team that wins a rally swaps courts. A receiving win changes the server
            without swapping partners. Typed score edits need a quick position check.
          </p>
        </div>
      )}
      {error && (
        <p className="service-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
