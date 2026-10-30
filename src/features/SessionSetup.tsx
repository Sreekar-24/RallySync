import { useState, type FormEvent } from 'react'
import {
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  Plus,
  Settings2,
  Sparkles,
  Users,
} from 'lucide-react'
import { Avatar, Modal } from '../components'
import { useRally } from '../store'
import type { Session } from '../domain/model'
import { generatePlan } from '../domain/planner'
import PlanningFields, { defaultPlanningSettings } from './schedule/PlanningFields'

export default function SessionSetup({
  onClose,
  onCreated,
  previous,
}: {
  onClose: () => void
  onCreated: () => void
  previous?: Session
}) {
  const { data, commit, notify } = useRally()
  const [error, setError] = useState('')
  const [name, setName] = useState(previous?.name ?? '')
  const [selected, setSelected] = useState<string[]>(
    previous
      ? previous.playerIds.filter((id) => data.players.some((p) => p.id === id))
      : data.players.map((p) => p.id),
  )
  const [guest, setGuest] = useState('')
  const [format, setFormat] = useState<'singles' | 'doubles'>(previous?.format ?? 'doubles')
  const [courts, setCourts] = useState(previous?.courtCount ?? 1)
  const [target, setTarget] = useState(previous?.target ?? 21)
  const [bestOf, setBestOf] = useState<1 | 3>(previous?.bestOf ?? 1)
  const [mode, setMode] = useState<'balanced' | 'fair' | 'variety'>(previous?.mode ?? 'balanced')
  const [advanced, setAdvanced] = useState(false)
  const [planning, setPlanning] = useState(() => previous?.planning ?? defaultPlanningSettings())
  const [scoringMode, setScoringMode] = useState<'team' | 'individual' | 'combined'>(
    previous?.scoringMode ?? 'combined',
  )
  const addGuest = () => {
    const value = guest.trim()
    if (!value) return
    if (data.players.some((p) => p.name.toLocaleLowerCase() === value.toLocaleLowerCase())) {
      notify('That player is already in your crew. Select them below.')
      return
    }
    const id = crypto.randomUUID()
    commit((current) => ({
      ...current,
      players: [...current.players, { id, name: value, level: 3, createdAt: Date.now() }],
    }))
    setSelected((current) => [...current, id])
    setGuest('')
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (selected.length < (format === 'doubles' ? 4 : 2)) return
    const now = Date.now()
    const session: Session = {
      id: crypto.randomUUID(),
      name:
        name.trim() ||
        `${new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(now)} social`,
      startedAt: now,
      format,
      courtCount: courts,
      target,
      winBy: previous?.winBy ?? 2,
      cap: previous && target === previous.target ? previous.cap : target === 21 ? 30 : target + 9,
      bestOf,
      mode,
      planning,
      scoringMode,
      playerIds: selected,
      availablePlayerIds: selected,
      status: 'active',
      attendance: selected.map((playerId) => ({ playerId, at: now, available: true })),
    }
    try {
      let created = false
      commit((current) => {
        if (current.sessions.some((s) => s.status === 'active'))
          throw new Error('Finish the current session before creating another.')
        if (selected.some((id) => !current.players.some((player) => player.id === id)))
          throw new Error('The player list changed. Review who is playing and try again.')
        const combined = { ...current, sessions: [...current.sessions, session] }
        const planned = { ...session, plan: generatePlan(combined, session) }
        created = true
        return { ...combined, sessions: [...current.sessions, planned] }
      })
      if (created) onCreated()
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The session could not be created. Review the setup and try again.',
      )
    }
  }
  return (
    <Modal
      title="Make room for a good game."
      subtitle={
        previous
          ? 'Same group, fresh session. Confirm who is playing today.'
          : 'Pick your crew. We’ll take care of the rotation.'
      }
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} className="form-stack">
        {error && (
          <p className="notice warning" role="alert">
            {error}
          </p>
        )}
        {previous && (
          <p className="notice">
            Players and preferences are copied. Scores, teams, breaks and arrival times start fresh.
          </p>
        )}
        <label className="field">
          Session name <span className="optional">optional</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="e.g. Saturday evening rally"
          />
        </label>
        <div className="field">
          <div className="field-heading">
            <span>Who’s playing?</span>
            <span className="muted">{selected.length} selected</span>
          </div>
          <div className="quick-add">
            <input
              aria-label="New player name"
              value={guest}
              onChange={(e) => setGuest(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addGuest()
                }
              }}
              maxLength={48}
              placeholder="Add a player by name"
            />
            <button
              type="button"
              className="button soft"
              onClick={addGuest}
              disabled={!guest.trim()}
            >
              <Plus size={17} /> Add
            </button>
          </div>
          <div className="player-chips">
            {data.players.map((p, i) => (
              <button
                type="button"
                key={p.id}
                className={`player-chip ${selected.includes(p.id) ? 'selected' : ''}`}
                aria-pressed={selected.includes(p.id)}
                onClick={() =>
                  setSelected((current) =>
                    current.includes(p.id)
                      ? current.filter((id) => id !== p.id)
                      : [...current, p.id],
                  )
                }
              >
                <Avatar name={p.name} index={i} small />
                {p.name}
                {selected.includes(p.id) && <Check size={15} />}
              </button>
            ))}
          </div>
          {!data.players.length && (
            <p className="field-help">
              No sign-ups needed. Add at least 4 players for doubles, or 2 for singles.
            </p>
          )}
        </div>
        <div className="form-grid">
          <label className="field">
            Play style
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as 'singles' | 'doubles')}
            >
              <option value="doubles">Doubles · 4 players</option>
              <option value="singles">Singles · 2 players</option>
            </select>
          </label>
          <label className="field">
            Courts
            <select
              aria-label="Courts"
              value={courts}
              onChange={(e) => setCourts(Number(e.target.value))}
            >
              {Array.from({ length: Math.max(6, previous?.courtCount ?? 1) }, (_, i) => i + 1).map(
                (c) => (
                  <option key={c} value={c}>
                    {c} court{c > 1 ? 's' : ''}
                  </option>
                ),
              )}
            </select>
          </label>
        </div>
        <div className="field">
          <span>Keep the games…</span>
          <div className="mode-options">
            {[
              {
                id: 'balanced' as const,
                title: 'Balanced',
                text: 'Fair turns, even teams',
                icon: Sparkles,
              },
              {
                id: 'fair' as const,
                title: 'Fair',
                text: 'Playing time comes first',
                icon: Clock3,
              },
              { id: 'variety' as const, title: 'Fresh', text: 'Mix up your partners', icon: Users },
            ].map((m) => (
              <button
                type="button"
                key={m.id}
                className={`mode-option ${mode === m.id ? 'selected' : ''}`}
                onClick={() => setMode(m.id)}
                aria-pressed={mode === m.id}
              >
                <m.icon size={18} />
                <strong>{m.title}</strong>
                <small>{m.text}</small>
              </button>
            ))}
          </div>
        </div>
        <PlanningFields value={planning} onChange={setPlanning} mode={mode} courtCount={courts} />
        <div className="field">
          <span>How would you like to score?</span>
          <div className="scoring-mode-options" role="group" aria-label="Scoring mode">
            {(
              [
                { id: 'team', label: 'Team points' },
                { id: 'individual', label: 'Player points' },
                { id: 'combined', label: 'Team + player points' },
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                className={scoringMode === option.id ? 'selected' : ''}
                aria-pressed={scoringMode === option.id}
                onClick={() => setScoringMode(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <small className="field-help">
            Player points tally into their side’s score. Unassigned points stay visible.
          </small>
        </div>
        <button
          className="text-button"
          type="button"
          aria-expanded={advanced}
          onClick={() => setAdvanced(!advanced)}
        >
          <Settings2 size={16} /> Scoring options{' '}
          <ChevronRight size={15} className={advanced ? 'rotate-90' : ''} />
        </button>
        {advanced && (
          <div className="form-grid">
            <label className="field">
              Points per game
              <select
                aria-label="Points per game"
                value={target}
                onChange={(e) => setTarget(Number(e.target.value))}
              >
                {Array.from(new Set([11, 15, 21, ...(previous ? [previous.target] : [])]))
                  .sort((a, b) => a - b)
                  .map((n) => (
                    <option key={n} value={n}>
                      {n} points{n !== 21 ? ' · house format' : ' · standard'}
                    </option>
                  ))}
              </select>
              <small className="field-help">
                Win by {previous?.winBy ?? 2}, capped at{' '}
                {previous && target === previous.target
                  ? previous.cap
                  : target === 21
                    ? 30
                    : target + 9}
                .
              </small>
            </label>
            <label className="field">
              Match length
              <select
                aria-label="Match length"
                value={bestOf}
                onChange={(e) => {
                  const next = Number(e.target.value) as 1 | 3
                  setPlanning((current) =>
                    current.matchMinutes === (bestOf === 3 ? 30 : 12)
                      ? { ...current, matchMinutes: next === 3 ? 30 : 12 }
                      : current,
                  )
                  setBestOf(next)
                }}
              >
                <option value={1}>One game · social</option>
                <option value={3}>Best of 3 games</option>
              </select>
            </label>
          </div>
        )}
        <div className="modal-actions">
          <span className="field-help">
            {selected.length < (format === 'doubles' ? 4 : 2)
              ? `Select at least ${format === 'doubles' ? 4 : 2} players to start.`
              : 'You can add people or take breaks anytime.'}
          </span>
          <button
            type="submit"
            className="button primary"
            disabled={selected.length < (format === 'doubles' ? 4 : 2)}
          >
            Let’s play <ArrowRight size={17} />
          </button>
        </div>
      </form>
    </Modal>
  )
}
