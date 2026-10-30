import { useEffect, useId, useState } from 'react'
import { ArrowRight, Clock3, Coffee, UserRound } from 'lucide-react'
import type { Session } from '../../domain/model'
import { playerNextUp } from '../../domain/next-up'
import { useRally } from '../../store'
import './player-next-up.css'

const preferenceKey = 'rallysync-next-player'
function rememberedPlayer() {
  try {
    return localStorage.getItem(preferenceKey) ?? ''
  } catch {
    return ''
  }
}

export default function PlayerNextUp({
  session,
  onScore,
}: {
  session: Session
  onScore?: (matchId: string) => void
}) {
  const { data } = useRally()
  const [preferred, setPreferred] = useState(rememberedPlayer)
  const [now, setNow] = useState(Date.now)
  const id = useId()
  useEffect(() => {
    const refresh = () => setNow(Date.now())
    const interval = setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  if (session.status !== 'active') return null
  const players = data.players.filter((player) => session.playerIds.includes(player.id))
  const selected = players.some((player) => player.id === preferred) ? preferred : ''
  const state = selected ? playerNextUp(data, session, selected, now) : null
  const name = (playerId: string) => data.players.find((p) => p.id === playerId)?.name ?? 'Player'
  const wait = state?.next ? Math.max(0, Math.ceil((state.next.estimatedAt - now) / 60_000)) : 0
  const attendance = {
    available: 'Resting now',
    break: 'Taking a break',
    'not-arrived': 'Arriving later',
    left: 'Availability ended',
  }
  return (
    <section className="player-next-up" aria-labelledby={`${id}-title`}>
      <div className="player-next-heading">
        <div>
          <p className="player-next-eyebrow">YOUR COURT CHECK</p>
          <h2 id={`${id}-title`}>What’s next for you?</h2>
        </div>
        <label className="player-next-select">
          <UserRound size={16} aria-hidden="true" />
          <span className="sr-only">Choose your name for next match</span>
          <select
            value={selected}
            onChange={(event) => {
              const value = event.target.value
              setPreferred(value)
              setNow(Date.now())
              try {
                if (value) localStorage.setItem(preferenceKey, value)
                else localStorage.removeItem(preferenceKey)
              } catch {
                // This device can still show a personal view without persistent preferences.
              }
            }}
          >
            <option value="">Choose your name</option>
            {players.map((player) => (
              <option key={player.id} value={player.id}>
                {player.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {state ? (
        <div className="player-next-content">
          <div className="player-next-now">
            <span className={`player-next-status ${state.current ? 'is-playing' : ''}`}>
              {state.current ? <span className="player-next-live-dot" /> : <Coffee size={15} />}
              {state.current
                ? `Playing · Court ${state.current.court}`
                : attendance[state.attendance]}
            </span>
            {state.current && onScore && (
              <button className="text-button" onClick={() => onScore(state.current!.id)}>
                Open your scoreboard <ArrowRight size={14} />
              </button>
            )}
          </div>
          {state.next ? (
            <div className="player-next-fixture">
              <div className="player-next-fixture-heading">
                <strong>Next · Court {state.next.slot.court}</strong>
                <span>
                  <Clock3 size={14} />
                  {state.next.waitingForLive
                    ? 'After games in progress'
                    : wait > 0
                      ? `About ${wait} min`
                      : 'Next available start'}
                </span>
              </div>
              <p>
                {state.next.teammates.length > 0 && (
                  <span>
                    With <strong>{state.next.teammates.map(name).join(' & ')}</strong>
                    {' · '}
                  </span>
                )}
                Against <strong>{state.next.opponents.map(name).join(' & ')}</strong>
              </p>
              <small>
                Round {state.next.slot.round} · Times are estimates; current games and lineup edits
                can change your turn.
              </small>
            </div>
          ) : (
            <p className="player-next-empty">
              {state.attendance === 'break'
                ? 'Mark yourself available in Manage players when you’re ready to return.'
                : state.attendance === 'left'
                  ? 'Update your availability in Manage players to join more games.'
                  : session.plan
                    ? 'No eligible upcoming match in this plan. Check the full schedule or refresh the lineup.'
                    : 'Create a session plan to see your next court and teammates here.'}
            </p>
          )}
        </div>
      ) : (
        <p className="player-next-empty">
          See your current court and next lineup. This selection stays on this device.
        </p>
      )}
    </section>
  )
}
