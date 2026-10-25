import { useState } from 'react'
import { Clock3, Hash, RotateCcw, SlidersHorizontal } from 'lucide-react'
import type { PlanningSettings, Session } from '../../domain/model'
import { defaultPlannerWeights } from '../../domain/planner'
import './schedule.css'

export function defaultPlanningSettings(): PlanningSettings {
  return {
    basis: 'matches',
    matchCount: 12,
    durationMinutes: 120,
    matchMinutes: 12,
    changeoverMinutes: 2,
  }
}

const weightLabels: {
  key: keyof NonNullable<PlanningSettings['weights']>
  label: string
  help: string
}[] = [
  {
    key: 'fairness',
    label: 'Fair playing time',
    help: 'Share court opportunity while players are available.',
  },
  { key: 'rest', label: 'Even rest gaps', help: 'Spread breaks and reduce back-to-back games.' },
  {
    key: 'balance',
    label: 'Competitive balance',
    help: 'Reduce the difference in estimated side strength.',
  },
  {
    key: 'variety',
    label: 'Different matchups',
    help: 'Repeat partners and opponents less often.',
  },
  {
    key: 'partnership',
    label: 'Partnership history',
    help: 'Consider performance together, with small-sample caution.',
  },
  {
    key: 'contribution',
    label: 'Recorded contribution',
    help: 'Use optional credited-point history where available.',
  },
]

export default function PlanningFields({
  value,
  onChange,
  mode = 'balanced',
  courtCount = 1,
}: {
  value: PlanningSettings
  onChange: (value: PlanningSettings) => void
  mode?: Session['mode']
  courtCount?: number
}) {
  const [advanced, setAdvanced] = useState(false)
  const weights = value.weights ?? defaultPlannerWeights(mode)
  const roundMinutes = value.matchMinutes + value.changeoverMinutes
  const estimatedRounds =
    roundMinutes > 0
      ? Math.max(0, Math.floor((value.durationMinutes + value.changeoverMinutes) / roundMinutes))
      : 0
  return (
    <div className="planning-fields">
      <div className="planning-basis" role="group" aria-label="Plan the session by">
        <button
          type="button"
          className={value.basis === 'matches' ? 'selected' : ''}
          aria-pressed={value.basis === 'matches'}
          onClick={() => onChange({ ...value, basis: 'matches' })}
        >
          <Hash size={17} />
          <span>
            <strong>Match count</strong>
            <small>Choose how many to play</small>
          </span>
        </button>
        <button
          type="button"
          className={value.basis === 'duration' ? 'selected' : ''}
          aria-pressed={value.basis === 'duration'}
          onClick={() => onChange({ ...value, basis: 'duration' })}
        >
          <Clock3 size={17} />
          <span>
            <strong>Time budget</strong>
            <small>Plan around your booking</small>
          </span>
        </button>
      </div>
      <div className="planning-input-grid">
        {value.basis === 'matches' ? (
          <label className="planning-field">
            <span>Total matches</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={200}
              required
              value={value.matchCount}
              onChange={(event) => onChange({ ...value, matchCount: Number(event.target.value) })}
            />
            <small>Across all courts, not per player.</small>
          </label>
        ) : (
          <label className="planning-field">
            <span>Session length (hours)</span>
            <input
              type="number"
              inputMode="decimal"
              min={0.25}
              max={12}
              step={0.25}
              required
              value={value.durationMinutes / 60}
              onChange={(event) =>
                onChange({ ...value, durationMinutes: Number(event.target.value) * 60 })
              }
            />
            <small>
              About {estimatedRounds * courtCount} matches across {courtCount} court
              {courtCount === 1 ? '' : 's'}.
            </small>
          </label>
        )}
        <label className="planning-field">
          <span>Estimated match (minutes)</span>
          <input
            type="number"
            inputMode="numeric"
            min={2}
            max={120}
            required
            value={value.matchMinutes}
            onChange={(event) => onChange({ ...value, matchMinutes: Number(event.target.value) })}
          />
          <small>Longer for best-of-three matches.</small>
        </label>
        <label className="planning-field">
          <span>Changeover (minutes)</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={20}
            required
            value={value.changeoverMinutes}
            onChange={(event) =>
              onChange({ ...value, changeoverMinutes: Number(event.target.value) })
            }
          />
          <small>A moment to switch and settle in.</small>
        </label>
      </div>
      <p className="planning-estimate-note">
        <Clock3 size={14} />
        Times are estimates. Actual scores decide when a match finishes.
      </p>
      <button
        type="button"
        className="planning-advanced-toggle"
        onClick={() => setAdvanced(!advanced)}
        aria-expanded={advanced}
      >
        <SlidersHorizontal size={16} /> Recommendation preferences{' '}
        <span>{value.weights ? 'Custom' : 'Preset'}</span>
      </button>
      {advanced && (
        <div className="planning-weight-panel">
          <div className="planning-weight-intro">
            <p>
              Give the planner your priorities. Availability and double-booking rules always apply.
            </p>
            {value.weights && (
              <button type="button" onClick={() => onChange({ ...value, weights: undefined })}>
                <RotateCcw size={14} /> Use preset
              </button>
            )}
          </div>
          {weightLabels.map(({ key, label, help }) => (
            <label className="planning-weight" key={key}>
              <span>
                <strong>{label}</strong>
                <small>{help}</small>
              </span>
              <input
                type="range"
                aria-label={label}
                min={0}
                max={10}
                step={1}
                value={weights[key]}
                onChange={(event) =>
                  onChange({ ...value, weights: { ...weights, [key]: Number(event.target.value) } })
                }
              />
              <output>{weights[key]}</output>
            </label>
          ))}
          <p className="planning-estimate-note">
            Credited points are optional and subjective. The default contribution weight is zero.
          </p>
        </div>
      )}
    </div>
  )
}
