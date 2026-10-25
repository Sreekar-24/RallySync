import { ArrowDownUp, Clock3, Handshake, Swords } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Analytics } from '../../domain/analytics'
import './insights.css'

export type InsightsView = 'standings' | 'partnerships' | 'opponents' | 'participation'
const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`

export default function InsightsPanel({
  analytics,
  view,
}: {
  analytics: Analytics
  view: Exclude<InsightsView, 'standings'>
}) {
  const [sort, setSort] = useState('form')
  const pairs = useMemo(
    () =>
      [...analytics.partnerships].sort((a, b) =>
        sort === 'matches'
          ? b.played - a.played || b.adjustedPerformance - a.adjustedPerformance
          : sort === 'wins'
            ? b.wins - a.wins || b.played - a.played
            : b.adjustedPerformance - a.adjustedPerformance || b.played - a.played,
      ),
    [analytics.partnerships, sort],
  )
  const [opponentSort, setOpponentSort] = useState('matches')
  const opponents = useMemo(
    () =>
      [...analytics.opponents].sort((a, b) =>
        opponentSort === 'close'
          ? Math.abs(a.winsA - a.winsB) / a.played - Math.abs(b.winsA - b.winsB) / b.played ||
            b.played - a.played
          : b.played - a.played,
      ),
    [analytics.opponents, opponentSort],
  )
  const [participationSort, setParticipationSort] = useState('wait')
  const participation = useMemo(
    () =>
      [...analytics.participation].sort((a, b) =>
        participationSort === 'play'
          ? b.minutes - a.minutes
          : participationSort === 'name'
            ? a.name.localeCompare(b.name)
            : b.longestWaitMinutes - a.longestWaitMinutes,
      ),
    [analytics.participation, participationSort],
  )

  if (view === 'partnerships')
    return (
      <section className="insights-section" aria-labelledby="partnership-title">
        <div className="insights-section-heading">
          <div>
            <h2 id="partnership-title">Better as a pair?</h2>
            <p>Results together, with opposition and sample size in perspective.</p>
          </div>
          <label className="insights-select">
            <ArrowDownUp size={15} />
            <span className="sr-only">Sort partnerships</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="form">Above expectation</option>
              <option value="matches">Most matches together</option>
              <option value="wins">Most wins together</option>
            </select>
          </label>
        </div>
        {!pairs.length ? (
          <Empty
            icon={<Handshake size={28} />}
            title="Partnerships start with doubles."
            text="Complete a doubles match in this scope to compare players who played on the same side."
          />
        ) : (
          <div className="insights-table-wrap">
            <table className="insights-table">
              <caption className="sr-only">
                Doubles partnerships. Form is wins above expectation, shrunk toward neutral for
                small samples.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Partnership</th>
                  <th scope="col">Together</th>
                  <th scope="col">Wins / losses</th>
                  <th scope="col">Win rate</th>
                  <th scope="col">Point difference</th>
                  <th scope="col">Adjusted form</th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((p) => (
                  <tr key={p.playerIds.join('|')}>
                    <th scope="row">
                      <strong>{p.names.join(' & ')}</strong>
                      <small>
                        {p.played < 5
                          ? 'Provisional · fewer than 5 matches'
                          : `${p.expectedWins.toFixed(1)} wins expected from opposition`}
                      </small>
                    </th>
                    <td data-label="Together">{p.played}</td>
                    <td data-label="Wins / losses">
                      <strong>{p.wins}</strong>
                      <span className="insights-separator"> / </span>
                      {p.losses}
                    </td>
                    <td data-label="Win rate">{Math.round(p.winRate * 100)}%</td>
                    <td data-label="Point difference">{signed(p.pointsFor - p.pointsAgainst)}</td>
                    <td data-label="Adjusted form">
                      <span
                        className={`insights-form ${p.adjustedPerformance >= 0 ? 'positive' : 'negative'}`}
                      >
                        {signed(Math.round(p.adjustedPerformance * 100))} pp
                      </span>
                      <small>{p.expectedWins.toFixed(1)} expected wins</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <details className="insights-explanation">
          <summary>How partnership form works</summary>
          <p>{analytics.definitions.partnership}</p>
          <p>
            A high raw win rate against weaker opposition can be less informative than competitive
            results against strong opponents. The score is a statistical hint, not a label of
            personal compatibility.
          </p>
        </details>
      </section>
    )

  if (view === 'opponents')
    return (
      <section className="insights-section" aria-labelledby="opponent-title">
        <div className="insights-section-heading">
          <div>
            <h2 id="opponent-title">Across the net.</h2>
            <p>Players on opposing sides, rather than partners on the same side.</p>
          </div>
          <label className="insights-select">
            <ArrowDownUp size={15} />
            <span className="sr-only">Sort opponents</span>
            <select value={opponentSort} onChange={(e) => setOpponentSort(e.target.value)}>
              <option value="matches">Most encounters</option>
              <option value="close">Closest win record</option>
            </select>
          </label>
        </div>
        {!opponents.length ? (
          <Empty
            icon={<Swords size={28} />}
            title="Every rivalry starts somewhere."
            text="Accepted match results will show how players have performed on opposite sides."
          />
        ) : (
          <div className="insights-table-wrap">
            <table className="insights-table">
              <caption className="sr-only">
                Opposing-player encounters. In doubles these are team results, not individual
                singles results.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Opponents</th>
                  <th scope="col">Encounters</th>
                  <th scope="col">Wins by side</th>
                  <th scope="col">Side points</th>
                </tr>
              </thead>
              <tbody>
                {opponents.map((p) => (
                  <tr key={p.playerIds.join('|')}>
                    <th scope="row">
                      <strong>
                        {p.names[0]} <span className="insights-vs">vs</span> {p.names[1]}
                      </strong>
                      <small>
                        {p.played < 5 ? 'Small sample' : `${p.played} recorded encounters`}
                      </small>
                    </th>
                    <td data-label="Encounters">{p.played}</td>
                    <td data-label="Wins by side">
                      <div className="insights-head-to-head">
                        <span>
                          {p.names[0]} <b>{p.winsA}</b>
                        </span>
                        <span>
                          {p.names[1]} <b>{p.winsB}</b>
                        </span>
                      </div>
                      <div className="insights-comparison" aria-hidden="true">
                        <i style={{ width: `${(p.winsA / p.played) * 100}%` }} />
                      </div>
                    </td>
                    <td data-label="Side points">
                      {p.pointsA} – {p.pointsB}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="insights-note">
          {analytics.definitions.opponents} Filter to singles for singles-only head-to-head records.
        </p>
      </section>
    )

  return (
    <section className="insights-section" aria-labelledby="participation-title">
      <div className="insights-section-heading">
        <div>
          <h2 id="participation-title">A fair share of the court.</h2>
          <p>Actual elapsed time while available, including stopped matches.</p>
        </div>
        <label className="insights-select">
          <ArrowDownUp size={15} />
          <span className="sr-only">Sort participation</span>
          <select value={participationSort} onChange={(e) => setParticipationSort(e.target.value)}>
            <option value="wait">Longest waiting gap</option>
            <option value="play">Most court time</option>
            <option value="name">Player name</option>
          </select>
        </label>
      </div>
      {!participation.length ? (
        <Empty
          icon={<Clock3 size={28} />}
          title="Participation starts with a session."
          text="Players’ availability, court time, and recorded breaks appear here."
        />
      ) : (
        <div className="insights-table-wrap">
          <table className="insights-table">
            <caption className="sr-only">
              Participation by player. Court and waiting time are elapsed estimates; breaks are
              excluded.
            </caption>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">Court time</th>
                <th scope="col">Waiting time</th>
                <th scope="col">Longest wait</th>
                <th scope="col">Play / rest streak</th>
              </tr>
            </thead>
            <tbody>
              {participation.map((p) => (
                <tr key={p.playerId}>
                  <th scope="row">
                    <strong>{p.name}</strong>
                    <small>{p.availableMinutes} min available</small>
                    <div
                      className="insights-time-bar"
                      role="img"
                      aria-label={`${p.name}: ${p.minutes} minutes on court and ${p.waitingMinutes} minutes waiting`}
                    >
                      <i
                        style={{
                          width: `${p.availableMinutes ? Math.min(100, (p.minutes / p.availableMinutes) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </th>
                  <td data-label="Court time">{p.minutes} min</td>
                  <td data-label="Waiting time">{p.waitingMinutes} min</td>
                  <td data-label="Longest wait">{p.longestWaitMinutes} min</td>
                  <td data-label="Play / rest streak">
                    {p.maxConsecutivePlays} / {p.maxConsecutiveRests}
                    <small>consecutive recorded rounds</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="insights-note">
        {analytics.definitions.participation} This is a participation view, not a performance
        ranking.
      </p>
    </section>
  )
}

function Empty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="insights-empty">
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  )
}
