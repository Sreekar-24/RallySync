import { useEffect, useState } from 'react'
import { Clock3, Pause, Play } from 'lucide-react'
import type { Match, Session } from '../../domain/model'
import { isMatchPaused, matchPlayMinutes, pauseMatch, resumeMatch } from '../../domain/timing'
import { scoreMatch } from '../../domain/engine'
import { useRally } from '../../store'
import './match-clock.css'

export default function MatchClock({
  match,
  session,
  disabled = false,
}: {
  match: Match
  session: Session
  disabled?: boolean
}) {
  const { commit, readOnly } = useRally()
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')
  const paused = isMatchPaused(match)
  const complete = scoreMatch(match, session).complete
  useEffect(() => {
    if (paused || complete || match.status !== 'playing') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [paused, complete, match.status])
  const seconds = Math.floor(matchPlayMinutes(match, now) * 60)
  function toggle() {
    try {
      const at = Date.now()
      commit((data) => ({
        ...data,
        matches: data.matches.map((current) =>
          current.id !== match.id
            ? current
            : isMatchPaused(current)
              ? resumeMatch(current, at)
              : pauseMatch(current, session, at),
        ),
      }))
      setNow(at)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change the match timer.')
    }
  }
  return (
    <div className={`match-clock ${paused ? 'is-paused' : ''}`}>
      <span
        className="match-clock-time"
        title={
          match.timing
            ? 'Excludes recorded pauses and tracked result review; not active rally time.'
            : 'Elapsed time. Earlier unrecorded pauses are unknown.'
        }
      >
        <Clock3 size={15} />
        <strong>
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
        </strong>
        <span>
          {paused ? 'Paused' : complete ? 'Play ended' : match.timing ? 'Play time' : 'Elapsed'}
        </span>
      </span>
      {!complete && match.status === 'playing' && (
        <button
          type="button"
          className="text-button"
          disabled={disabled || readOnly}
          onClick={toggle}
        >
          {paused ? <Play size={15} /> : <Pause size={15} />}
          {paused ? 'Resume match' : 'Pause match'}
        </button>
      )}
      {paused && <p role="status">Scoring paused. Court stays reserved; resume when ready.</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
