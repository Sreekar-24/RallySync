import { useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  Clipboard,
  Clock3,
  Code2,
  FileUp,
  Flag,
  ListOrdered,
  LockKeyhole,
  Pencil,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UnlockKeyhole,
  Users,
} from 'lucide-react'
import { Avatar, Modal } from '../../components'
import { useRally } from '../../store'
import type {
  AppData,
  PlannedMatch,
  PlanningSettings,
  Session,
  SessionPlan,
} from '../../domain/model'
import {
  buildPlanContext,
  buildPlanPrompt,
  editPlanSlot,
  generatePlan,
  planSummary,
  replanSession,
  validatePlanAssignments,
} from '../../domain/planner'
import { downloadFile } from '../../lib/storage'
import PlanningFields, { defaultPlanningSettings } from './PlanningFields'
import './schedule.css'

type PlanPreview = { session: Session; base: string; title: string }

function revisionKey(data: AppData, session: Session) {
  return JSON.stringify({
    revision: session.plan?.revision ?? 0,
    status: session.status,
    available: session.availablePlayerIds,
    members: session.playerIds,
    attendance: session.attendance,
    availability: session.availability,
    matches: data.matches
      .filter((match) => match.sessionId === session.id)
      .map((match) => [match.id, match.revision, match.status]),
    levels: data.players
      .filter((player) => session.playerIds.includes(player.id))
      .map((player) => [player.id, player.level]),
  })
}

function matchupKey(slot: PlannedMatch) {
  return [slot.teamA.slice().sort().join('|'), slot.teamB.slice().sort().join('|')]
    .sort()
    .join(' / ')
}

function availableAt(session: Session, playerId: string, at: number) {
  const window = session.availability?.[playerId]
  if (window?.from !== undefined && at < window.from) return false
  const duration = (session.planning?.matchMinutes ?? (session.bestOf === 3 ? 30 : 12)) * 60_000
  if (window?.until !== undefined && at + duration > window.until) return false
  if (window?.from !== undefined && window.from > Date.now() && at >= window.from) return true
  const personal = (session.attendance ?? [])
    .filter((event) => event.playerId === playerId && event.at <= at)
    .sort((a, b) => a.at - b.at)
  return personal.length
    ? personal[personal.length - 1].available
    : session.availablePlayerIds.includes(playerId)
}

export default function SessionSchedule({
  session,
  onStart,
  onScore,
}: {
  session: Session
  onStart: (slotId: string) => void
  onScore: (matchId: string) => void
}) {
  const { data, commit, notify, readOnly } = useRally()
  const [configuring, setConfiguring] = useState(false)
  const [settings, setSettings] = useState<PlanningSettings>(
    session.planning ?? defaultPlanningSettings(),
  )
  const [editing, setEditing] = useState<PlannedMatch | null>(null)
  const [preview, setPreview] = useState<PlanPreview | null>(null)
  const [error, setError] = useState('')
  const [showCompleted, setShowCompleted] = useState(true)
  const [importing, setImporting] = useState(false)
  const [promptVisible, setPromptVisible] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const plan = session.plan
  const slots = plan?.slots ?? []
  const name = (id: string) =>
    data.players.find((player) => player.id === id)?.name ?? 'Unknown player'
  const matchFor = (slot: PlannedMatch) =>
    data.matches.find((match) => match.id === slot.matchId || match.planSlotId === slot.id)
  const editable = !readOnly && session.status === 'active'
  const summary = useMemo(() => planSummary(data, session), [data, session])
  const rounds = [...new Set(slots.map((slot) => slot.round))].sort((a, b) => a - b)
  const finished = slots.filter((slot) => {
    const match = matchFor(slot)
    return match && match.status !== 'playing'
  }).length
  const locked = slots.filter((slot) => slot.locked && !matchFor(slot)).length
  const projected = summary.map((row) => row.projectedMinutes)
  const maximumRest = Math.max(0, ...summary.map((row) => row.maxConsecutiveRests))
  const base = revisionKey(data, session)

  const propose = (proposed: Session, title: string) => {
    setError('')
    setPreview({ session: proposed, base, title })
  }
  const regenerate = () => {
    try {
      propose(replanSession(data, session), 'Refresh the upcoming lineup?')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The plan could not be generated.')
    }
  }
  const applyPreview = () => {
    if (!preview || !editable) return
    let applied = false
    commit((current) => {
      const live = current.sessions.find((item) => item.id === session.id)
      if (!live || revisionKey(current, live) !== preview.base) return current
      applied = true
      return {
        ...current,
        sessions: current.sessions.map((item) =>
          item.id === session.id
            ? { ...item, plan: preview.session.plan, planning: preview.session.planning }
            : item,
        ),
      }
    })
    if (applied) {
      setPreview(null)
      notify('Upcoming lineup updated. Your recorded matches stay unchanged.')
    } else {
      setPreview(null)
      setError(
        'The session changed while you were reviewing. Generate a fresh preview before applying.',
      )
    }
  }
  const toggleLock = (slot: PlannedMatch) => {
    if (!editable || matchFor(slot)) return
    commit((current) => ({
      ...current,
      sessions: current.sessions.map((item) =>
        item.id === session.id && item.plan
          ? {
              ...item,
              plan: {
                ...item.plan,
                revision: item.plan.revision + 1,
                slots: item.plan.slots.map((entry) =>
                  entry.id === slot.id ? { ...entry, locked: !entry.locked } : entry,
                ),
              },
            }
          : item,
      ),
    }))
    notify(
      slot.locked
        ? 'Match unlocked. The planner may adjust it next time.'
        : 'Match locked. The planner will keep this assignment.',
    )
  }
  const configure = (event: FormEvent) => {
    event.preventDefault()
    try {
      const next = { ...session, planning: settings }
      const proposed = {
        ...next,
        plan: generatePlan(data, next, {
          preserve: slots.filter((slot) => slot.locked || Boolean(matchFor(slot))),
        }),
      }
      setConfiguring(false)
      propose(
        proposed,
        plan ? 'Review your updated session plan.' : 'Your whole session, ready to review.',
      )
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Check the planning settings and try again.',
      )
    }
  }
  const importPlan = async (file?: File) => {
    if (!file || !editable) return
    setImporting(true)
    setError('')
    try {
      if (file.size > 1024 * 1024) throw new Error('Choose a schedule JSON file smaller than 1 MB.')
      const proposed = validatePlanAssignments(data, session, JSON.parse(await file.text()))
      propose({ ...session, plan: proposed }, 'Review the imported lineup.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'This is not a valid schedule JSON file.')
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  const exportContext = () => {
    try {
      downloadFile(
        `rallysync-planning-${session.id}.json`,
        JSON.stringify(buildPlanContext(data, session), null, 2),
        'application/json',
      )
      notify('Planning context download started. Review it before sharing.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Generate a session plan first.')
    }
  }
  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(buildPlanPrompt(data, session))
      notify('Planning prompt copied.')
    } catch {
      setPromptVisible(true)
      notify('The prompt is shown below. Select and copy it manually.')
    }
  }

  return (
    <section className="session-schedule" aria-labelledby="schedule-heading">
      <div className="schedule-heading">
        <div>
          <span className="schedule-eyebrow">A GOOD GAME PLAN</span>
          <h2 id="schedule-heading">Everyone knows what’s next.</h2>
          <p>Your full lineup, with room for real life.</p>
        </div>
        <div className="schedule-heading-actions">
          {plan && (
            <button className="schedule-button" disabled={!editable} onClick={regenerate}>
              <RefreshCw size={16} /> Refresh lineup
            </button>
          )}
          <button
            className="schedule-button primary"
            disabled={!editable}
            onClick={() => {
              setSettings(session.planning ?? defaultPlanningSettings())
              setError('')
              setConfiguring(true)
            }}
          >
            {plan ? <Pencil size={16} /> : <ListOrdered size={17} />}{' '}
            {plan ? 'Plan settings' : 'Build session plan'}
          </button>
        </div>
      </div>
      {error && (
        <p className="schedule-alert" role="alert">
          <TriangleAlert size={18} />
          <span>{error}</span>
        </p>
      )}
      {!plan ? (
        <div className="schedule-empty">
          <span>
            <ListOrdered size={32} />
          </span>
          <h3>Plan the evening, not just the next game.</h3>
          <p>
            Choose a match count or time budget. We’ll spread playing time, rest, and partnerships
            across the session.
          </p>
          <button
            className="schedule-button primary"
            disabled={!editable}
            onClick={() => {
              setSettings(session.planning ?? defaultPlanningSettings())
              setConfiguring(true)
            }}
          >
            Build session plan <ArrowRight size={16} />
          </button>
        </div>
      ) : (
        <>
          <div className="schedule-stats">
            <div>
              <ListOrdered size={18} />
              <span>Total matches</span>
              <strong>
                {slots.length}
                <small>{finished} finished</small>
              </strong>
            </div>
            <div>
              <Flag size={18} />
              <span>Planned rounds</span>
              <strong>
                {rounds.length}
                <small>
                  {session.courtCount} court{session.courtCount === 1 ? '' : 's'}
                </small>
              </strong>
            </div>
            <div>
              <Clock3 size={18} />
              <span>Projected playtime</span>
              <strong>
                {projected.length
                  ? `${Math.round(Math.min(...projected))}–${Math.round(Math.max(...projected))}`
                  : '0'}
                <small>min per player</small>
              </strong>
            </div>
            <div>
              <Users size={18} />
              <span>Longest planned rest</span>
              <strong>
                {maximumRest}
                <small>round{maximumRest === 1 ? '' : 's'} in a row</small>
              </strong>
            </div>
          </div>
          {plan.warnings.length > 0 && (
            <div className="schedule-warnings">
              <TriangleAlert size={17} />
              <div>
                <strong>A few planning tradeoffs</strong>
                {plan.warnings.map((warning, index) => (
                  <p key={`${index}-${warning}`}>{warning}</p>
                ))}
              </div>
            </div>
          )}
          <div className="schedule-list-heading">
            <div>
              <h3>The lineup</h3>
              <p>
                Revision {plan.revision} ·{' '}
                {locked ? `${locked} future ${locked === 1 ? 'match' : 'matches'} locked · ` : ''}
                Times are estimates, not a countdown.
              </p>
            </div>
            <label className="schedule-check">
              <input
                type="checkbox"
                checked={showCompleted}
                onChange={(event) => setShowCompleted(event.target.checked)}
              />{' '}
              Show finished
            </label>
          </div>
          <div className="schedule-rounds">
            {rounds.map((round) => {
              const roundSlots = slots.filter((slot) => slot.round === round)
              const visible = roundSlots.filter((slot) => {
                const match = matchFor(slot)
                return showCompleted || !match || match.status === 'playing'
              })
              if (!visible.length) return null
              const playing = new Set(roundSlots.flatMap((slot) => [...slot.teamA, ...slot.teamB]))
              const rests = session.playerIds.filter(
                (playerId) =>
                  !playing.has(playerId) && availableAt(session, playerId, roundSlots[0].startsAt),
              )
              return (
                <div className="schedule-round" key={round}>
                  <div className="schedule-round-label">
                    <span className="schedule-round-number">{String(round).padStart(2, '0')}</span>
                    <div>
                      <h4>Round {round}</h4>
                      <span>
                        <Clock3 size={12} />
                        {new Date(roundSlots[0].startsAt).toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}{' '}
                        estimated
                      </span>
                    </div>
                  </div>
                  <div className="schedule-round-content">
                    <div className="schedule-courts">
                      {visible.map((slot) => {
                        const match = matchFor(slot)
                        const activePlayers = new Set(
                          data.matches
                            .filter((item) => item.status === 'playing')
                            .flatMap((item) => [...item.teamA, ...item.teamB]),
                        )
                        const unavailable = [...slot.teamA, ...slot.teamB].some(
                          (id) =>
                            !session.availablePlayerIds.includes(id) ||
                            !availableAt(session, id, Date.now()),
                        )
                        const busy =
                          [...slot.teamA, ...slot.teamB].some((id) => activePlayers.has(id)) ||
                          data.matches.some(
                            (item) =>
                              item.sessionId === session.id &&
                              item.court === slot.court &&
                              item.status === 'playing',
                          )
                        const earlier = slots.some(
                          (item) =>
                            item.court === slot.court && item.round < slot.round && !matchFor(item),
                        )
                        const canStart = editable && !match && !busy && !unavailable && !earlier
                        const status =
                          match?.status === 'playing'
                            ? 'On court'
                            : match?.status === 'completed'
                              ? 'Completed'
                              : match?.status === 'abandoned'
                                ? 'Stopped'
                                : slot.locked
                                  ? 'Locked lineup'
                                  : 'Upcoming'
                        return (
                          <article
                            className={`schedule-match ${match ? `is-${match.status}` : ''}`}
                            key={slot.id}
                          >
                            <div className="schedule-match-top">
                              <strong>Court {slot.court}</strong>
                              <span
                                className={`schedule-status ${match?.status === 'playing' ? 'live' : ''}`}
                              >
                                {match?.status === 'playing' && <i />}
                                {status}
                              </span>
                            </div>
                            <div className="schedule-teams">
                              {[slot.teamA, slot.teamB].map((team, index) => (
                                <div className="schedule-team" key={index}>
                                  {team.map((id) => (
                                    <div className="schedule-player" key={id}>
                                      <Avatar
                                        name={name(id)}
                                        index={data.players.findIndex((player) => player.id === id)}
                                        small
                                      />
                                      <span>{name(id)}</span>
                                    </div>
                                  ))}
                                  {index === 0 && <span className="schedule-versus">vs</span>}
                                </div>
                              ))}
                            </div>
                            <details className="schedule-match-explanation">
                              <summary>Why this matchup?</summary>
                              <p className="schedule-match-reason">{slot.reason}</p>
                              <p className="schedule-explanation-note">
                                At planning time; estimates are not predictions or a guarantee of
                                equal turns.
                              </p>
                            </details>
                            <div className="schedule-match-bottom">
                              {match ? (
                                <button
                                  className={`schedule-button ${match.status === 'playing' ? 'primary' : ''}`}
                                  onClick={() => onScore(match.id)}
                                >
                                  {match.status === 'playing' ? 'Open scoreboard' : 'View result'}
                                  <ArrowRight size={15} />
                                </button>
                              ) : (
                                <button
                                  className="schedule-button start"
                                  disabled={!canStart}
                                  title={
                                    unavailable
                                      ? 'A player is not currently available.'
                                      : busy
                                        ? 'Wait until the court and players are free.'
                                        : earlier
                                          ? 'Play the earlier match on this court first.'
                                          : undefined
                                  }
                                  onClick={() => onStart(slot.id)}
                                >
                                  <Play size={14} />
                                  {earlier
                                    ? 'Later in the plan'
                                    : busy
                                      ? 'Players on court'
                                      : unavailable
                                        ? 'Waiting for players'
                                        : 'Start match'}
                                </button>
                              )}
                              {!match && (
                                <div className="schedule-match-tools">
                                  <button
                                    aria-label={`${slot.locked ? 'Unlock' : 'Lock'} round ${slot.round} court ${slot.court}`}
                                    className={`schedule-icon-button ${slot.locked ? 'selected' : ''}`}
                                    disabled={!editable}
                                    onClick={() => toggleLock(slot)}
                                  >
                                    {slot.locked ? (
                                      <LockKeyhole size={16} />
                                    ) : (
                                      <UnlockKeyhole size={16} />
                                    )}
                                  </button>
                                  <button
                                    aria-label={`Edit round ${slot.round} court ${slot.court}`}
                                    className="schedule-icon-button"
                                    disabled={!editable}
                                    onClick={() => {
                                      setError('')
                                      setEditing(slot)
                                    }}
                                  >
                                    <Pencil size={16} />
                                  </button>
                                </div>
                              )}
                            </div>
                          </article>
                        )
                      })}
                    </div>
                    {rests.length > 0 && (
                      <div className="schedule-rests">
                        <Users size={14} />
                        <strong>Resting this round</strong>
                        <span>{rests.map(name).join(', ')}</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {!slots.length && (
            <div className="schedule-empty compact">
              <h3>No feasible matches yet.</h3>
              <p>
                Check player availability or change the session limits, then refresh the lineup.
              </p>
            </div>
          )}
          <details className="schedule-fairness">
            <summary>
              <ShieldCheck size={18} />
              <span>See the playing-time picture</span>
              <ChevronDown size={17} />
            </summary>
            <p>
              Projected minutes use the estimated match length. Late arrivals, early departures, and
              breaks can make equal totals inappropriate.
            </p>
            <div
              className="schedule-table-scroll"
              tabIndex={0}
              aria-label="Projected participation table"
            >
              <table>
                <caption className="sr-only">Participation across the current session plan</caption>
                <thead>
                  <tr>
                    <th scope="col">Player</th>
                    <th scope="col">Played</th>
                    <th scope="col">Planned</th>
                    <th scope="col">Projected minutes</th>
                    <th scope="col">Longest play streak</th>
                    <th scope="col">Longest rest streak</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((row) => (
                    <tr key={row.playerId}>
                      <th scope="row">{row.name}</th>
                      <td>{row.playedMatches}</td>
                      <td>{row.plannedMatches}</td>
                      <td>
                        <span className="schedule-minute-bar">
                          <i
                            style={{
                              width: `${Math.max(2, (row.projectedMinutes / Math.max(1, ...projected)) * 100)}%`,
                            }}
                          />
                          <strong>{Math.round(row.projectedMinutes)} min</strong>
                        </span>
                      </td>
                      <td>{row.maxConsecutivePlays}</td>
                      <td>{row.maxConsecutiveRests}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}

      <details className="schedule-llm">
        <summary>
          <span className="schedule-llm-icon">
            <Sparkles size={21} />
          </span>
          <span>
            <strong>Your planner, or your favorite LLM.</strong>
            <small>Optional JSON exchange. No AI account is connected to RallySync.</small>
          </span>
          <ChevronDown size={18} />
        </summary>
        <div className="schedule-llm-body">
          <div className="schedule-llm-steps">
            <div>
              <b>1</b>
              <strong>Take the context</strong>
              <p>
                Download player IDs, availability, history, and current slots. Review names and
                records before sharing externally.
              </p>
            </div>
            <div>
              <b>2</b>
              <strong>Ask for a lineup</strong>
              <p>
                Attach the context to your chosen LLM and paste the supplied prompt. Ask for JSON
                only, using every unplayed slot.
              </p>
            </div>
            <div>
              <b>3</b>
              <strong>Review and apply</strong>
              <p>
                Import the answer. We check IDs, overlaps, locks, and availability before showing a
                preview.
              </p>
            </div>
          </div>
          <div className="schedule-llm-actions">
            <button className="schedule-button" disabled={!plan} onClick={exportContext}>
              <ArrowDownToLine size={16} /> Download context JSON
            </button>
            <button className="schedule-button" disabled={!plan} onClick={() => void copyPrompt()}>
              <Clipboard size={16} /> Copy LLM prompt
            </button>
            <button
              className="schedule-button"
              disabled={!plan || !editable || importing}
              onClick={() => fileRef.current?.click()}
            >
              <FileUp size={16} />
              {importing ? 'Checking schedule…' : 'Import schedule JSON'}
            </button>
          </div>
          <input
            className="schedule-file-input"
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            aria-label="Upload recommended schedule JSON"
            onChange={(event) => void importPlan(event.target.files?.[0])}
          />
          <button
            className="schedule-code-toggle"
            disabled={!plan}
            onClick={() => setPromptVisible(!promptVisible)}
            aria-expanded={promptVisible}
          >
            <Code2 size={15} /> {promptVisible ? 'Hide' : 'View'} prompt and expected format
          </button>
          {promptVisible && plan && (
            <div className="schedule-code-panel">
              <label htmlFor="schedule-prompt">Prompt to paste with your context file</label>
              <textarea
                id="schedule-prompt"
                readOnly
                value={buildPlanPrompt(data, session)}
                rows={9}
              />
              <p>Expected structure, prefilled with your current assignments:</p>
              <pre tabIndex={0} aria-label="Expected schedule JSON format">
                {JSON.stringify(buildPlanContext(data, session).expectedOutput, null, 2)}
              </pre>
              <p>
                Singles uses one player per side. Include every unplayed slot. Completed results,
                active matches, and locked assignments cannot be changed.
              </p>
            </div>
          )}
          <p className="schedule-llm-note">
            The built-in engine works offline. LLM recommendations are optional suggestions, not
            automatically trusted decisions.
          </p>
        </div>
      </details>
      {configuring && (
        <Modal
          title={plan ? 'Shape the rest of the session.' : 'Plan a good evening.'}
          subtitle="Choose a match count or a rough time budget. You can adjust the lineup later."
          onClose={() => setConfiguring(false)}
          wide
        >
          <form onSubmit={configure}>
            <PlanningFields
              value={settings}
              onChange={setSettings}
              mode={session.mode}
              courtCount={session.courtCount}
            />
            {error && (
              <p className="schedule-inline-error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="schedule-button"
                onClick={() => setConfiguring(false)}
              >
                Cancel
              </button>
              <button className="schedule-button primary" type="submit">
                Preview lineup <ArrowRight size={16} />
              </button>
            </div>
          </form>
        </Modal>
      )}
      {editing && (
        <LineupEditor
          session={session}
          slot={editing}
          onClose={() => setEditing(null)}
          onPreview={(a, b) => {
            try {
              const proposed = editPlanSlot(data, session, editing.id, a, b)
              setEditing(null)
              propose(proposed, 'Review this lineup change.')
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : 'This lineup is not available.')
            }
          }}
          error={error}
        />
      )}
      {preview && (
        <PlanPreviewDialog
          original={session}
          preview={preview}
          names={Object.fromEntries(data.players.map((player) => [player.id, player.name]))}
          onClose={() => setPreview(null)}
          onApply={applyPreview}
          disabled={!editable || revisionKey(data, session) !== preview.base}
        />
      )}
    </section>
  )
}

function LineupEditor({
  session,
  slot,
  onClose,
  onPreview,
  error,
}: {
  session: Session
  slot: PlannedMatch
  onClose: () => void
  onPreview: (a: string[], b: string[]) => void
  error: string
}) {
  const { data } = useRally()
  const [a, setA] = useState(slot.teamA)
  const [b, setB] = useState(slot.teamB)
  const size = session.format === 'singles' ? 1 : 2
  const chosen = [...a, ...b]
  const choosePlayer = (side: 'A' | 'B', index: number, playerId: string) => {
    const nextA = [...a]
    const nextB = [...b]
    const next = side === 'A' ? nextA : nextB
    const previous = next[index]
    if (playerId) {
      for (const team of [nextA, nextB])
        for (let position = 0; position < team.length; position++) {
          if (team[position] === playerId && !(team === next && position === index))
            team[position] = previous ?? ''
        }
    }
    next[index] = playerId
    setA(nextA)
    setB(nextB)
  }
  const eligible = data.players.filter(
    (player) =>
      session.playerIds.includes(player.id) && availableAt(session, player.id, slot.startsAt),
  )
  const valid =
    chosen.length === size * 2 &&
    new Set(chosen).size === size * 2 &&
    chosen.every((id) => eligible.some((player) => player.id === id))
  return (
    <Modal
      title={`Round ${slot.round}. Your matchup.`}
      subtitle={`Court ${slot.court} · Changes are previewed before the remaining lineup is repaired.`}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (valid) onPreview(a, b)
        }}
      >
        <div className="schedule-edit-sides">
          {(
            [
              ['A', a],
              ['B', b],
            ] as const
          ).map(([side, team]) => (
            <div key={side}>
              <span>SIDE {side}</span>
              {Array.from({ length: size }, (_, index) => (
                <label className="planning-field" key={index}>
                  <span>Player {index + 1}</span>
                  <select
                    value={team[index] ?? ''}
                    aria-label={`Planned side ${side} player ${index + 1}`}
                    onChange={(event) => choosePlayer(side, index, event.target.value)}
                  >
                    <option value="">Choose a player</option>
                    {eligible.map((player) => (
                      <option value={player.id} key={player.id}>
                        {player.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          ))}
        </div>
        <p className="schedule-edit-help">
          Choose a name to swap players between sides. If this matchup exists later, the planner can
          move it into this slot. Other unlocked matches are repaired around your choice.
        </p>
        {error && (
          <p className="schedule-inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="schedule-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="schedule-button primary" disabled={!valid}>
            Preview change <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </Modal>
  )
}

function PlanPreviewDialog({
  original,
  preview,
  names,
  onClose,
  onApply,
  disabled,
}: {
  original: Session
  preview: PlanPreview
  names: Record<string, string>
  onClose: () => void
  onApply: () => void
  disabled: boolean
}) {
  const { data } = useRally()
  const plan = preview.session.plan as SessionPlan
  const now = Date.now()
  const before = planSummary(data, original, now)
  const after = planSummary(data, preview.session, now)
  const beforeById = new Map(before.map((row) => [row.playerId, row]))
  const impact = after.filter((row) => {
    const previous = beforeById.get(row.playerId)
    return (
      !previous ||
      previous.plannedMatches !== row.plannedMatches ||
      previous.projectedMinutes !== row.projectedMinutes ||
      previous.maxConsecutiveRests !== row.maxConsecutiveRests
    )
  })
  const matchRange = (rows: typeof before) => {
    if (!rows.length) return '0'
    const counts = rows.map((row) => row.plannedMatches)
    const min = Math.min(...counts)
    const max = Math.max(...counts)
    return min === max ? String(min) : `${min}–${max}`
  }
  const maxRest = (rows: typeof before) =>
    Math.max(0, ...rows.map((row) => row.maxConsecutiveRests))
  const changed = plan.slots.filter((slot) => {
    const old = original.plan?.slots.find((item) => item.id === slot.id)
    return (
      !old ||
      matchupKey(old) !== matchupKey(slot) ||
      old.startsAt !== slot.startsAt ||
      old.court !== slot.court
    )
  })
  return (
    <Modal
      title={preview.title}
      subtitle="A preview, not a commitment. Review the changes before applying."
      onClose={onClose}
      wide
    >
      <div className="schedule-preview">
        <div className="schedule-preview-summary">
          <span>
            <ListOrdered size={23} />
          </span>
          <div>
            <strong>{plan.slots.length} matches planned</strong>
            <p>
              {changed.length} assignment{changed.length === 1 ? '' : 's'} changed or added.
              Recorded matches stay unchanged.
            </p>
          </div>
        </div>
        <div className="schedule-participation-preview" aria-label="Participation impact">
          <strong>Playing time and rest</strong>
          <div className="schedule-impact-metrics">
            <p>
              <span>Scheduled matches per player</span>
              <b>
                {matchRange(before)} → {matchRange(after)}
              </b>
            </p>
            <p>
              <span>Longest available rest streak</span>
              <b>
                {maxRest(before)} → {maxRest(after)} rounds
              </b>
            </p>
          </div>
          {impact.length ? (
            <details>
              <summary>See player changes ({impact.length})</summary>
              <div
                className="schedule-impact-scroll"
                tabIndex={0}
                aria-label="Player participation changes"
              >
                <table>
                  <caption className="sr-only">Current plan compared with proposed plan</caption>
                  <thead>
                    <tr>
                      <th scope="col">Player</th>
                      <th scope="col">Matches</th>
                      <th scope="col">Est. court min</th>
                      <th scope="col">Longest rest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {impact.map((row) => {
                      const previous = beforeById.get(row.playerId)
                      return (
                        <tr key={row.playerId}>
                          <th scope="row">{row.name}</th>
                          <td>
                            {previous?.plannedMatches ?? 0} → {row.plannedMatches}
                          </td>
                          <td>
                            {previous?.projectedMinutes ?? 0} → {row.projectedMinutes}
                          </td>
                          <td>
                            {previous?.maxConsecutiveRests ?? 0} → {row.maxConsecutiveRests} rounds
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          ) : (
            <p className="schedule-impact-note">Projected participation is unchanged.</p>
          )}
          <p className="schedule-impact-note">
            Current → proposed. Recorded play + estimated future court time; legacy matches include
            untracked pauses. Availability can make equal turns impossible.
          </p>
        </div>
        {plan.warnings.length > 0 && (
          <div className="schedule-warnings">
            <TriangleAlert size={16} />
            <div>
              {plan.warnings.map((warning, index) => (
                <p key={index}>{warning}</p>
              ))}
            </div>
          </div>
        )}
        <div
          className="schedule-preview-list"
          tabIndex={0}
          aria-label="Changed schedule assignments"
        >
          {changed.slice(0, 12).map((slot) => (
            <div key={slot.id}>
              <span>
                R{slot.round} · C{slot.court}
              </span>
              <strong>
                {slot.teamA.map((id) => names[id] ?? id).join(' & ')}
                <i>vs</i>
                {slot.teamB.map((id) => names[id] ?? id).join(' & ')}
              </strong>
              {slot.locked && <LockKeyhole size={14} />}
            </div>
          ))}
          {changed.length > 12 && (
            <p>
              And {changed.length - 12} more assignments, visible in the full schedule after
              applying.
            </p>
          )}
          {!changed.length && (
            <p>The teams are already aligned. The updated settings or locks will still be saved.</p>
          )}
        </div>
        {disabled && (
          <p className="schedule-inline-error" role="alert">
            The session changed while this preview was open. Close it and generate a new preview.
          </p>
        )}
        <div className="modal-actions">
          <button className="schedule-button" onClick={onClose}>
            Keep current plan
          </button>
          <button className="schedule-button primary" disabled={disabled} onClick={onApply}>
            Apply lineup <Check size={16} />
          </button>
        </div>
      </div>
    </Modal>
  )
}
