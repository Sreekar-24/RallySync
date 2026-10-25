import { useState } from 'react'
import { Check, Clock3 } from 'lucide-react'
import type { Session } from '../domain/model'
import { useRally } from '../store'

function dateInput(timestamp?: number) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return new Date(timestamp - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export default function AvailabilityWindow({
  session,
  playerId,
  name,
}: {
  session: Session
  playerId: string
  name: string
}) {
  const { commit, readOnly, notify } = useRally()
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState('')
  const [until, setUntil] = useState('')
  const [error, setError] = useState('')
  return (
    <>
      <button
        type="button"
        className="icon-button outlined window-button"
        aria-label={`Availability window for ${name}`}
        aria-expanded={open}
        disabled={readOnly || !session.playerIds.includes(playerId)}
        onClick={() => {
          const window = session.availability?.[playerId]
          setFrom(dateInput(window?.from))
          setUntil(dateInput(window?.until))
          setError('')
          setOpen(!open)
        }}
      >
        <Clock3 size={16} />
      </button>
      {open && (
        <div className="availability-editor">
          <label>
            Available from
            <input
              aria-label={`Available from for ${name}`}
              type="datetime-local"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            Available until
            <input
              aria-label={`Available until for ${name}`}
              type="datetime-local"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </label>
          <p>
            Use an arrival or departure time to plan their remaining turns. Blank means no
            additional time limit. Active matches stay in place.
          </p>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="button soft"
            onClick={() => {
              const fromTime = from ? new Date(from).getTime() : undefined
              const untilTime = until ? new Date(until).getTime() : undefined
              if (
                (fromTime !== undefined && !Number.isFinite(fromTime)) ||
                (untilTime !== undefined && !Number.isFinite(untilTime)) ||
                (untilTime !== undefined && untilTime <= (fromTime ?? session.startedAt))
              ) {
                setError('Choose a departure after the arrival or session start.')
                return
              }
              commit((current) => ({
                ...current,
                sessions: current.sessions.map((s) =>
                  s.id === session.id
                    ? {
                        ...s,
                        availability: {
                          ...s.availability,
                          [playerId]: {
                            ...(fromTime !== undefined ? { from: fromTime } : {}),
                            ...(untilTime !== undefined ? { until: untilTime } : {}),
                          },
                        },
                      }
                    : s,
                ),
              }))
              setOpen(false)
              notify('Availability updated. Future matches have been reviewed.')
            }}
          >
            <Check size={16} /> Apply availability
          </button>
        </div>
      )}
    </>
  )
}
