import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Check,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { useRally } from '../store'
import { getStandings } from '../domain/engine'
import type { Player } from '../domain/model'
import './collection.css'

const levels = [
  'New to the game',
  'Finding my rhythm',
  'Comfortable on court',
  'Strong club player',
  'Advanced player',
]
const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

export default function PeoplePage() {
  const { data, commit, notify, readOnly } = useRally()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Player | 'new' | null>(null)
  const [removing, setRemoving] = useState<Player | null>(null)
  const statsByPlayer = useMemo(
    () => new Map(getStandings(data).map((row) => [row.playerId, row])),
    [data],
  )
  const filtered = data.players.filter((player) =>
    player.name.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()),
  )
  const totalPlayed = data.matches.filter((match) => match.status === 'completed').length

  function save(name: string, level: number) {
    const clean = name.trim().replace(/\s+/g, ' ')
    if (!clean) return 'Give this player a name.'
    if (
      data.players.some(
        (player) =>
          player.id !== (editing !== 'new' && editing ? editing.id : '') &&
          player.name.toLocaleLowerCase() === clean.toLocaleLowerCase(),
      )
    )
      return 'That name is already in your group. Add an initial to tell them apart.'
    if (readOnly) return 'This tab is read-only. Use the active organizer tab.'
    const player: Player =
      editing && editing !== 'new'
        ? { ...editing, name: clean, level }
        : { id: crypto.randomUUID(), name: clean, level, createdAt: Date.now() }
    commit((current) => ({
      ...current,
      players:
        editing === 'new'
          ? [...current.players, player]
          : current.players.map((item) => (item.id === player.id ? player : item)),
    }))
    notify(editing === 'new' ? `${clean} is in. Ready when you are.` : 'Player details updated.')
    setEditing(null)
    return null
  }

  function requestRemove(player: Player) {
    const used =
      data.sessions.some((session) => session.playerIds.includes(player.id)) ||
      data.matches.some((match) => [...match.teamA, ...match.teamB].includes(player.id))
    if (used) {
      notify('This player has session history. Keep the profile to preserve your records.')
      return
    }
    setRemoving(player)
  }

  function confirmRemove() {
    if (!removing || readOnly) return
    if (
      data.sessions.some((session) => session.playerIds.includes(removing.id)) ||
      data.matches.some((match) => [...match.teamA, ...match.teamB].includes(removing.id))
    ) {
      notify('This player now has session history, so their profile was kept.')
      setRemoving(null)
      return
    }
    commit((current) => ({
      ...current,
      players: current.players.filter((player) => player.id !== removing.id),
    }))
    notify(`${removing.name} removed.`)
    setRemoving(null)
  }

  return (
    <div className="collection-page people-page">
      <header className="collection-heading">
        <div>
          <p className="collection-eyebrow">YOUR COURTSIDE CREW</p>
          <h1>Better together.</h1>
          <p>Your regulars, your newcomers, your next great partnership.</p>
        </div>
        <button
          className="collection-button primary"
          disabled={readOnly}
          onClick={() => setEditing('new')}
        >
          <Plus size={18} /> Add player
        </button>
      </header>

      <div className="people-overview">
        <div>
          <span className="collection-icon">
            <Users size={21} />
          </span>
          <div>
            <strong>{data.players.length}</strong>
            <span>players in your group</span>
          </div>
        </div>
        <div>
          <span className="collection-icon muted">
            <Check size={21} />
          </span>
          <div>
            <strong>{totalPlayed}</strong>
            <span>completed matches together</span>
          </div>
        </div>
        <p>
          No accounts needed.
          <br />
          <span>Just good company.</span>
        </p>
      </div>

      <div className="collection-toolbar">
        <div>
          <h2>
            Your players <span className="collection-count">{data.players.length}</span>
          </h2>
          <p>Starting levels help us suggest balanced teams.</p>
        </div>
        <label className="collection-search">
          <Search size={18} />
          <span className="collection-sr">Search players</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a player…"
            type="search"
          />
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="collection-empty">
          <span className="collection-empty-icon">
            <UserRound size={29} />
          </span>
          <h3>{query ? 'No players found' : 'Every great session starts with your people.'}</h3>
          <p>
            {query
              ? 'Try a different name or clear your search.'
              : 'Add your friends by name. They can join the game without signing up.'}
          </p>
          {!query && (
            <button
              disabled={readOnly}
              className="collection-button primary"
              onClick={() => setEditing('new')}
            >
              <Plus size={17} /> Add your first player
            </button>
          )}
        </div>
      ) : (
        <div className="people-grid">
          {filtered.map((player, index) => {
            const stats = statsByPlayer.get(player.id) ?? { played: 0, wins: 0, pointsFor: 0 }
            return (
              <article className="people-card" key={player.id}>
                <div className="people-card-top">
                  <span className={`collection-avatar tone-${index % 5}`}>
                    {initials(player.name)}
                  </span>
                  <div className="people-card-actions">
                    <button
                      className="collection-icon-button"
                      disabled={readOnly}
                      aria-label={`Edit ${player.name}`}
                      onClick={() => setEditing(player)}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="collection-icon-button"
                      disabled={readOnly}
                      aria-label={`Remove ${player.name}`}
                      onClick={() => requestRemove(player)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <h3>{player.name}</h3>
                <span className="people-level">
                  <span className="people-level-bars" aria-hidden="true">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <i key={value} className={value <= player.level ? 'filled' : ''} />
                    ))}
                  </span>
                  {levels[player.level - 1] || 'Starting level'}
                </span>
                <div className="people-card-stats">
                  <div>
                    <strong>{stats.played}</strong>
                    <span>Matches</span>
                  </div>
                  <div>
                    <strong>{stats.wins}</strong>
                    <span>Wins</span>
                  </div>
                  <div>
                    <strong>
                      {stats.played ? `${Math.round((stats.wins / stats.played) * 100)}%` : '—'}
                    </strong>
                    <span>Win rate</span>
                  </div>
                </div>
                <p className="people-card-foot">
                  <ArrowUpRight size={14} />{' '}
                  {stats.played
                    ? `${stats.pointsFor} points scored with their sides`
                    : 'A fresh start. Their story begins next game.'}
                </p>
              </article>
            )
          })}
        </div>
      )}
      <p className="collection-footnote">
        Starting levels are organizer estimates, not official rankings. Match statistics include
        completed matches only.
      </p>

      {editing && (
        <PlayerEditor
          key={editing === 'new' ? 'new' : editing.id}
          player={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
      {removing && (
        <RemovalDialog
          name={removing.name}
          onClose={() => setRemoving(null)}
          onConfirm={confirmRemove}
        />
      )}
    </div>
  )
}

function PlayerEditor({
  player,
  onClose,
  onSave,
}: {
  player: Player | null
  onClose: () => void
  onSave: (name: string, level: number) => string | null
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState(player?.name || '')
  const [level, setLevel] = useState(player?.level || 3)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog
      className="collection-dialog"
      ref={ref}
      onCancel={onClose}
      aria-labelledby="player-dialog-title"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          setError(onSave(name, level))
        }}
      >
        <div className="collection-dialog-heading">
          <div>
            <p className="collection-eyebrow">THE MORE, THE MERRIER</p>
            <h2 id="player-dialog-title">
              {player ? 'Player details' : 'Meet your next teammate.'}
            </h2>
          </div>
          <button
            type="button"
            className="collection-icon-button"
            aria-label="Close player form"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <label className="collection-field">
          Player name
          <input
            autoFocus
            required
            maxLength={40}
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setError(null)
            }}
            placeholder="e.g. Priya S."
            autoComplete="off"
          />
        </label>
        <fieldset className="people-level-picker">
          <legend>
            Starting level <span>It’s an estimate. You can change it later.</span>
          </legend>
          <div>
            {levels.map((label, index) => (
              <label className={level === index + 1 ? 'selected' : ''} key={label}>
                <input
                  type="radio"
                  name="level"
                  value={index + 1}
                  checked={level === index + 1}
                  onChange={() => setLevel(index + 1)}
                />
                <span>{index + 1}</span>
                <span>{label}</span>
                {level === index + 1 && <Check size={16} />}
              </label>
            ))}
          </div>
        </fieldset>
        {error && (
          <p className="collection-error" role="alert">
            {error}
          </p>
        )}
        <div className="collection-dialog-footer">
          <button type="button" className="collection-button" onClick={onClose}>
            Cancel
          </button>
          <button className="collection-button primary" type="submit">
            {player ? 'Save changes' : 'Add player'}
            <Plus size={17} />
          </button>
        </div>
      </form>
    </dialog>
  )
}

function RemovalDialog({
  name,
  onClose,
  onConfirm,
}: {
  name: string
  onClose: () => void
  onConfirm: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog
      className="collection-dialog small"
      ref={ref}
      onCancel={onClose}
      aria-labelledby="remove-player-title"
    >
      <h2 id="remove-player-title">Remove {name}?</h2>
      <p>
        This removes their unused profile from your group. Players with session history are kept to
        protect your records.
      </p>
      <div className="collection-dialog-footer">
        <button autoFocus className="collection-button" onClick={onClose}>
          Keep player
        </button>
        <button className="collection-button danger" onClick={onConfirm}>
          Remove player
        </button>
      </div>
    </dialog>
  )
}
