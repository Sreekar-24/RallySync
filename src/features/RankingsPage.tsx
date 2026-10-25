import { useMemo, useState } from 'react'
import {
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  Handshake,
  Medal,
  Swords,
  Trophy,
} from 'lucide-react'
import { useRally } from '../store'
import { getAnalytics, type AnalyticsFilters, type AnalyticsPlayer } from '../domain/analytics'
import InsightsPanel, { type InsightsView } from './insights/InsightsPanel'
import ReportActions from './ReportActions'
import './collection.css'
import './insights/insights.css'

type RankingSort = 'wins' | 'rate' | 'rating' | 'performance' | 'credit'
const localDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export default function RankingsPage() {
  const { data } = useRally()
  const [scope, setScope] = useState('overall')
  const [format, setFormat] = useState<'all' | 'singles' | 'doubles'>('all')
  const [sort, setSort] = useState<RankingSort>('wins')
  const [view, setView] = useState<InsightsView>('standings')
  const [selected, setSelected] = useState<string[]>([])
  const [from, setFrom] = useState(() => localDate(new Date(Date.now() - 30 * 86400000)))
  const [to, setTo] = useState(() => localDate(new Date()))
  const filters = useMemo<AnalyticsFilters>(() => {
    const value: AnalyticsFilters = { format, playerIds: selected.length ? selected : undefined }
    if (scope === 'today') {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      const end = new Date(start)
      end.setDate(end.getDate() + 1)
      value.from = start.getTime()
      value.to = end.getTime()
    } else if (scope === 'range') {
      if (from) value.from = new Date(`${from}T00:00:00`).getTime()
      if (to) {
        const end = new Date(`${to}T00:00:00`)
        end.setDate(end.getDate() + 1)
        value.to = end.getTime()
      }
    } else if (scope !== 'overall') value.sessionId = scope
    return value
  }, [scope, format, from, to, selected])
  const rangeInvalid = scope === 'range' && Boolean(from && to && from > to)
  const analytics = useMemo(() => getAnalytics(data, filters), [data, filters])
  const standings = useMemo(
    () =>
      [...analytics.players].sort((a, b) => {
        const winRate = b.winRate - a.winRate
        const pointDiff = b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst)
        const metric =
          sort === 'rate'
            ? winRate || b.wins - a.wins
            : sort === 'rating'
              ? b.rating - a.rating || b.played - a.played
              : sort === 'performance'
                ? b.performanceIndex - a.performanceIndex || b.played - a.played
                : sort === 'credit'
                  ? (b.creditedPoints ?? -1) - (a.creditedPoints ?? -1) ||
                    b.attributionCoverage - a.attributionCoverage
                  : b.wins - a.wins || pointDiff || winRate
        return metric || a.name.localeCompare(b.name)
      }),
    [analytics.players, sort],
  )
  const scopeLabel =
    scope === 'overall'
      ? 'All time'
      : scope === 'today'
        ? 'Today'
        : scope === 'range'
          ? `${from || 'Beginning'} to ${to || 'present'}`
          : (data.sessions.find((s) => s.id === scope)?.name ?? 'Selected session')
  const rankingDescription =
    sort === 'wins'
      ? 'More wins rank first, then point difference, then win percentage.'
      : sort === 'rate'
        ? 'Higher win percentage ranks first, then more wins.'
        : sort === 'rating'
          ? 'Higher provisional team-result Elo ranks first, then more matches.'
          : sort === 'performance'
            ? 'Higher experimental performance index ranks first, then more matches.'
            : 'More recorded credited points rank first, then higher attribution coverage. Unknown values rank last.'
  const metricColumn =
    sort === 'rating'
      ? 'Provisional rating'
      : sort === 'performance'
        ? 'Performance index'
        : sort === 'credit'
          ? 'Credited points'
          : null
  const metricValue = (row: AnalyticsPlayer) =>
    sort === 'rating'
      ? row.rating
      : sort === 'performance'
        ? `${row.performanceIndex} / 100`
        : (row.creditedPoints ?? 'Unknown')

  return (
    <div className="collection-page rankings-page">
      <header className="collection-heading">
        <div>
          <p className="collection-eyebrow">YOUR GAME, WITH PERSPECTIVE</p>
          <h1>Find your form.</h1>
          <p>Results, partnerships, and a fair share of the court.</p>
        </div>
        <span className="collection-heading-icon lime">
          <Trophy size={27} />
        </span>
      </header>
      <div className="rankings-intro">
        <div>
          <span className="collection-icon">
            <Medal size={23} />
          </span>
          <div>
            <strong>A fuller picture of your crew.</strong>
            <p>Compare like with like. Keep small samples in perspective.</p>
          </div>
        </div>
        <span>
          {analytics.summary.completedMatches} completed{' '}
          {analytics.summary.completedMatches === 1 ? 'match' : 'matches'}{' '}
          <ArrowUpRight size={17} />
        </span>
      </div>
      <div className="insights-heading-actions">
        <span className="insights-coverage">
          <CheckCircle2 size={17} />
          <span>
            <strong>{Math.round(analytics.summary.attributionCoverage * 100)}%</strong> of points
            have individual attribution in this view.
          </span>
        </span>
        <ReportActions data={data} filters={filters} scopeLabel={scopeLabel} rankBy={sort} />
      </div>
      <section className="insights-controls" aria-label="Filter results and insights">
        <div className="insights-filter-row">
          <label className="insights-filter">
            Time span
            <select
              aria-label="Leaderboard time span"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="overall">All time</option>
              <option value="today">Today</option>
              <option value="range">Date range</option>
              {[...data.sessions]
                .sort((a, b) => b.startedAt - a.startedAt)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="insights-filter">
            Play format
            <select
              aria-label="Leaderboard format"
              value={format}
              onChange={(e) => setFormat(e.target.value as typeof format)}
            >
              <option value="all">All formats</option>
              <option value="singles">Singles</option>
              <option value="doubles">Doubles</option>
            </select>
          </label>
          {view === 'standings' && (
            <label className="insights-filter">
              Rank players by
              <select
                aria-label="Rank players by"
                value={sort}
                onChange={(e) => setSort(e.target.value as RankingSort)}
              >
                <option value="wins">Most wins</option>
                <option value="rate">Win percentage</option>
                <option value="rating">Provisional strength</option>
                <option value="performance">Weighted performance</option>
                <option value="credit">Credited points</option>
              </select>
            </label>
          )}
          {scope === 'range' && (
            <div className="insights-date-range">
              <label className="insights-filter">
                From
                <input
                  type="date"
                  aria-label="Results from date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label className="insights-filter">
                Through
                <input
                  type="date"
                  aria-label="Results through date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </div>
          )}
        </div>
        {rangeInvalid && (
          <p className="insights-filter-error" role="alert">
            Choose an end date on or after the start date.
          </p>
        )}
        <details className="insights-player-filter">
          <summary>
            Players · {selected.length ? `${selected.length} selected` : 'Everyone'}
          </summary>
          <p className="insights-scope-note">
            Includes matches involving any selected player. Standings show those players;
            relationship views also show their partners and opponents.
          </p>
          <div className="insights-player-options">
            {data.players.map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(p.id)}
                  onChange={(e) =>
                    setSelected((current) =>
                      e.target.checked ? [...current, p.id] : current.filter((id) => id !== p.id),
                    )
                  }
                />
                {p.name}
              </label>
            ))}
            {selected.length > 0 && (
              <button type="button" onClick={() => setSelected([])}>
                Show everyone
              </button>
            )}
            {!data.players.length && (
              <p className="insights-scope-note">
                Your crew will appear here after you add players.
              </p>
            )}
          </div>
        </details>
      </section>
      <div className="insights-tabs" role="group" aria-label="Results view">
        {[
          { id: 'standings' as const, label: 'Standings', icon: BarChart3 },
          { id: 'partnerships' as const, label: 'Partnerships', icon: Handshake },
          { id: 'opponents' as const, label: 'Opponents', icon: Swords },
          { id: 'participation' as const, label: 'Participation', icon: Clock3 },
        ].map((tab) => (
          <button
            key={tab.id}
            className={view === tab.id ? 'active' : ''}
            aria-pressed={view === tab.id}
            onClick={() => setView(tab.id)}
          >
            <tab.icon size={17} />
            {tab.label}
          </button>
        ))}
      </div>
      {view !== 'standings' ? (
        <InsightsPanel analytics={analytics} view={view} />
      ) : (
        <>
          <div className="collection-toolbar rankings-toolbar">
            <div>
              <h2>Player standings</h2>
              <p>Confirmed results only · Minimum 1 match</p>
            </div>
            <span className="collection-count">{standings.length} players</span>
          </div>
          {!standings.length ? (
            <div className="collection-empty">
              <span className="collection-empty-icon">
                <Trophy size={30} />
              </span>
              <h3>The leaderboard starts on court.</h3>
              <p>
                Confirm a completed match to see standings. Try another format, player selection, or
                time span if your results are elsewhere.
              </p>
            </div>
          ) : (
            <div className="rankings-table-wrap">
              <table className="rankings-table">
                <caption className="collection-sr">
                  Player rankings. {rankingDescription} Remaining ties are alphabetical.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Rank</th>
                    <th scope="col">Player</th>
                    <th scope="col">Played</th>
                    <th scope="col">Wins</th>
                    <th scope="col">Losses</th>
                    <th scope="col">Win rate</th>
                    <th scope="col">Point diff.</th>
                    <th scope="col">Court time</th>
                    {metricColumn && <th scope="col">{metricColumn}</th>}
                  </tr>
                </thead>
                <tbody>
                  {standings.map((row, index) => (
                    <tr key={row.playerId} className={index === 0 ? 'leading' : ''}>
                      <td data-label="Rank">
                        <span className={`rankings-position place-${index + 1}`}>
                          {index < 3 && <Medal size={16} aria-hidden="true" />}
                          {index + 1}
                        </span>
                      </td>
                      <th scope="row">
                        <span className="rankings-player">
                          <span className={`collection-avatar small tone-${index % 5}`}>
                            {row.name
                              .split(/\s+/)
                              .slice(0, 2)
                              .map((part) => part[0])
                              .join('')}
                          </span>
                          <span>
                            {row.name}
                            <small>
                              {row.played < 5
                                ? 'Early days · small sample'
                                : `${row.played} recorded matches`}
                            </small>
                          </span>
                        </span>
                      </th>
                      <td data-label="Played">{row.played}</td>
                      <td data-label="Wins" className="rankings-wins">
                        {row.wins}
                      </td>
                      <td data-label="Losses">{row.losses}</td>
                      <td data-label="Win rate">{Math.round(row.winRate * 100)}%</td>
                      <td data-label="Point diff.">
                        {row.pointsFor - row.pointsAgainst > 0 ? '+' : ''}
                        {row.pointsFor - row.pointsAgainst}
                      </td>
                      <td data-label="Court time">{Math.round(row.minutes)} min</td>
                      {metricColumn && (
                        <td data-label={metricColumn} className="insights-metric-value">
                          {metricValue(row)}
                          {sort === 'credit' && (
                            <small>
                              {Math.round(row.attributionCoverage * 100)}% side attribution coverage
                            </small>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="rankings-notes">
            <div>
              <strong>How this ranking works</strong>
              <p>
                {rankingDescription} Remaining ties are alphabetical. Players with different match
                counts, scoring formats, or opponents may not be directly comparable.
              </p>
            </div>
            <div>
              <strong>Performance ≠ playing priority</strong>
              <p>
                Standings never award extra court time. Availability and participation determine
                fair rotation. Individual credit is optional and should not be treated as an
                objective measure of ability.
              </p>
            </div>
          </div>
          {sort === 'performance' && (
            <details className="insights-explanation">
              <summary>The weighted performance formula</summary>
              <p>{analytics.definitions.performance}</p>
              <p>
                The win-rate and opposition terms are shrunk toward neutral for small samples.
                Individual attribution is excluded from this index because recording habits differ.
              </p>
            </details>
          )}
          {sort === 'rating' && (
            <p className="insights-threshold-note">{analytics.definitions.rating}</p>
          )}
          {sort === 'credit' && (
            <p className="insights-threshold-note">
              {analytics.definitions.attribution} Raw credited totals depend on playing time and
              scoring habits; compare coverage before drawing conclusions.
            </p>
          )}
        </>
      )}
    </div>
  )
}
