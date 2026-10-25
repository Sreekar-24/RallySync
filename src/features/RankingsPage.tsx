import { useMemo, useState } from 'react'
import { ArrowUpRight, ChevronDown, Medal, Trophy } from 'lucide-react'
import { useRally } from '../store'
import { getStandings } from '../domain/engine'
import './collection.css'

export default function RankingsPage() {
  const { data } = useRally()
  const [scope, setScope] = useState('overall')
  const [sort, setSort] = useState('wins')
  const standings = useMemo(() => {
    let scoped = data
    if (scope === 'today') {
      const dayStart = new Date()
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(dayStart)
      dayEnd.setDate(dayEnd.getDate() + 1)
      scoped = {
        ...data,
        matches: data.matches.filter(
          (match) =>
            (match.endedAt ?? match.startedAt) >= dayStart.getTime() &&
            (match.endedAt ?? match.startedAt) < dayEnd.getTime(),
        ),
      }
    } else if (scope !== 'overall')
      scoped = { ...data, matches: data.matches.filter((match) => match.sessionId === scope) }
    return getStandings(scoped)
      .filter((row) => row.played > 0)
      .sort((a, b) => {
        const winRate = b.wins / b.played - a.wins / a.played
        const pointDiff = b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst)
        return (
          (sort === 'rate'
            ? winRate || b.wins - a.wins
            : b.wins - a.wins || pointDiff || winRate) ||
          (data.players.find((player) => player.id === a.playerId)?.name || '').localeCompare(
            data.players.find((player) => player.id === b.playerId)?.name || '',
          )
        )
      })
  }, [data, scope, sort])
  const name = (id: string) =>
    data.players.find((player) => player.id === id)?.name || 'Unknown player'
  const completedCount =
    scope === 'overall'
      ? data.matches.filter((match) => match.status === 'completed').length
      : scope === 'today'
        ? data.matches.filter(
            (match) =>
              match.status === 'completed' &&
              new Date(match.endedAt ?? match.startedAt).toDateString() ===
                new Date().toDateString(),
          ).length
        : data.matches.filter((match) => match.status === 'completed' && match.sessionId === scope)
            .length

  return (
    <div className="collection-page rankings-page">
      <header className="collection-heading">
        <div>
          <p className="collection-eyebrow">A LITTLE FRIENDLY COMPETITION</p>
          <h1>Find your form.</h1>
          <p>Celebrate the results. Keep the bigger picture in view.</p>
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
            <strong>Results, with perspective.</strong>
            <p>One good session is a start. Every match adds to the story.</p>
          </div>
        </div>
        <span>
          {completedCount} completed {completedCount === 1 ? 'match' : 'matches'}{' '}
          <ArrowUpRight size={17} />
        </span>
      </div>
      <div className="collection-toolbar rankings-toolbar">
        <div>
          <h2>Player standings</h2>
          <p>Completed results only · Minimum 1 match</p>
        </div>
        <div className="rankings-filters">
          <label className="collection-select">
            <span className="collection-sr">Leaderboard time span</span>
            <select value={scope} onChange={(event) => setScope(event.target.value)}>
              <option value="overall">All time</option>
              <option value="today">Today</option>
              {[...data.sessions]
                .sort((a, b) => b.startedAt - a.startedAt)
                .map((session) => (
                  <option value={session.id} key={session.id}>
                    {session.name}
                  </option>
                ))}
            </select>
            <ChevronDown size={16} />
          </label>
          <label className="collection-select">
            <span className="collection-sr">Rank players by</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="wins">Most wins</option>
              <option value="rate">Win percentage</option>
            </select>
            <ChevronDown size={16} />
          </label>
        </div>
      </div>
      {standings.length === 0 ? (
        <div className="collection-empty">
          <span className="collection-empty-icon">
            <Trophy size={30} />
          </span>
          <h3>The leaderboard starts on court.</h3>
          <p>
            Finish a match to see player standings here. Try a different time span if your results
            are elsewhere.
          </p>
        </div>
      ) : (
        <div className="rankings-table-wrap">
          <table className="rankings-table">
            <caption className="collection-sr">
              Player rankings, sorted by{' '}
              {sort === 'wins'
                ? 'wins, then point difference, then win percentage'
                : 'win percentage, then wins'}
              , with alphabetical tie-break
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
              </tr>
            </thead>
            <tbody>
              {standings.map((row, index) => (
                <tr key={row.playerId} className={index === 0 ? 'leading' : ''}>
                  <td data-label="Rank">
                    <span className={`rankings-position place-${index + 1}`}>
                      {index < 3 ? <Medal size={16} aria-hidden="true" /> : null}
                      {index + 1}
                    </span>
                  </td>
                  <th scope="row">
                    <span className="rankings-player">
                      <span className={`collection-avatar small tone-${index % 5}`}>
                        {name(row.playerId)
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join('')}
                      </span>
                      <span>
                        {name(row.playerId)}
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
                  <td data-label="Win rate">{Math.round((row.wins / row.played) * 100)}%</td>
                  <td data-label="Point diff.">
                    {row.pointsFor - row.pointsAgainst > 0 ? '+' : ''}
                    {row.pointsFor - row.pointsAgainst}
                  </td>
                  <td data-label="Court time">{Math.round(row.minutes)} min</td>
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
            {sort === 'wins'
              ? 'More wins rank first, then higher point difference, then win percentage.'
              : 'Higher win percentage ranks first, then more wins.'}{' '}
            Remaining ties are alphabetical. Players with different match counts or opponents may
            not be directly comparable.
          </p>
        </div>
        <div>
          <strong>Performance ≠ playing priority</strong>
          <p>
            Standings never give a player more court time. Fair rotation uses participation and
            availability, not their leaderboard position.
          </p>
        </div>
      </div>
    </div>
  )
}
