import { useEffect, useState, type FormEvent } from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Coffee,
  Flag,
  Play,
  Plus,
  Settings2,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react'
import { Avatar, CourtArt, Modal, Shuttle } from '../components'
import { useRally } from '../store'
import { scoreMatch, suggestMatch, attendanceSummary } from '../domain/engine'
import { type Match, type Session, type PlannedMatch } from '../domain/model'
import ScoreDialog from './scoring/ScoreDialog'
import SessionSchedule from './schedule/SessionSchedule'
import PlanningFields, { defaultPlanningSettings } from './schedule/PlanningFields'
import { generatePlan, editPlanSlot } from '../domain/planner'
import SessionActions from './SessionActions'
import ReportActions from './ReportActions'
import AvailabilityWindow from './AvailabilityWindow'
import { downloadBackup } from '../lib/storage'

function currentlyAvailable(session: Session, id: string, now = Date.now()) {
  const window = session.availability?.[id]
  return (
    session.availablePlayerIds.includes(id) &&
    (window?.from ?? 0) <= now &&
    (window?.until ?? Infinity) > now
  )
}
function availabilityLabel(session: Session, id: string, now = Date.now()) {
  const window = session.availability?.[id]
  if (window?.from && window.from > now)
    return `Arrives ${new Date(window.from).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
  if (window?.until && window.until <= now) return 'Finished for today'
  return 'Taking a break'
}

export default function PlayPage({
  onNavigate,
}: {
  onNavigate: (page: 'players' | 'rules' | 'history' | 'rankings') => void
}) {
  const { data, commit, notify, readOnly, startDemo, isDemo } = useRally()
  const session = data.sessions.find((s) => s.status === 'active')
  const [setup, setSetup] = useState(false)
  const [attendance, setAttendance] = useState(false)
  const [scoring, setScoring] = useState<string | null>(null)
  const [lineup, setLineup] = useState<number | null>(null)
  const [ending, setEnding] = useState(false)
  const [view, setView] = useState<'courts' | 'schedule'>('courts')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(timer)
  }, [])
  const activeMatches = data.matches.filter(
    (m) => m.sessionId === session?.id && m.status === 'playing',
  )
  const completed = data.matches.filter(
    (m) => m.sessionId === session?.id && m.status === 'completed',
  )
  const selectedMatch = data.matches.find((m) => m.id === scoring)
  const playerName = (id: string) => data.players.find((p) => p.id === id)?.name ?? 'Unknown player'
  const nextSlot = (s: Session, court: number) =>
    s.plan?.slots.find((slot) => slot.court === court && !slot.matchId)
  const start = (court: number, teams?: { teamA: string[]; teamB: string[] }, slotId?: string) => {
    if (!session) return
    let newId: string | null = null
    try {
      commit((current) => {
        let liveSession = current.sessions.find((s) => s.id === session.id)
        if (!liveSession || liveSession.status !== 'active') return current
        let slot = slotId
          ? liveSession.plan?.slots.find((s) => s.id === slotId)
          : nextSlot(liveSession, court)
        if (slotId && (!slot || slot.matchId)) return current
        if (
          slot &&
          teams &&
          (JSON.stringify(slot.teamA) !== JSON.stringify(teams.teamA) ||
            JSON.stringify(slot.teamB) !== JSON.stringify(teams.teamB))
        ) {
          liveSession = editPlanSlot(current, liveSession, slot.id, teams.teamA, teams.teamB)
          slot = liveSession.plan?.slots.find((s) => s.id === slot!.id)
        }
        const suggested =
          teams ?? slot ?? (!liveSession.plan ? suggestMatch(current, liveSession, court) : null)
        if (!suggested) return current
        const ids = [...suggested.teamA, ...suggested.teamB]
        const size = liveSession.format === 'singles' ? 1 : 2
        const busy = new Set(
          current.matches
            .filter((m) => m.status === 'playing')
            .flatMap((m) => [...m.teamA, ...m.teamB]),
        )
        const now = Date.now()
        if (
          suggested.teamA.length !== size ||
          suggested.teamB.length !== size ||
          new Set(ids).size !== size * 2 ||
          ids.some(
            (id) =>
              busy.has(id) ||
              !liveSession!.availablePlayerIds.includes(id) ||
              (liveSession!.availability?.[id]?.from ?? 0) > now ||
              (liveSession!.availability?.[id]?.until ?? Infinity) <= now,
          ) ||
          current.matches.some(
            (m) => m.sessionId === session.id && m.court === court && m.status === 'playing',
          )
        )
          return current
        newId = crypto.randomUUID()
        const match: Match = {
          id: newId,
          sessionId: session.id,
          court,
          teamA: suggested.teamA,
          teamB: suggested.teamB,
          startedAt: now,
          status: 'playing',
          actions: [],
          revision: 0,
          ...(slot ? { planSlotId: slot.id } : {}),
        }
        const plannedSession =
          slot && liveSession.plan
            ? {
                ...liveSession,
                plan: {
                  ...liveSession.plan,
                  revision: liveSession.plan.revision + 1,
                  slots: liveSession.plan.slots.map((s) =>
                    s.id === slot!.id ? { ...s, matchId: match.id, startsAt: now } : s,
                  ),
                },
              }
            : liveSession
        return {
          ...current,
          sessions: current.sessions.map((s) => (s.id === session.id ? plannedSession : s)),
          matches: [...current.matches, match],
        }
      })
      if (newId) {
        setScoring(newId)
        notify(`Court ${court} is ready. Let’s play!`)
      } else
        notify(
          'This lineup is not available now. Check breaks, court occupancy, and availability windows.',
        )
    } catch (error) {
      notify(error instanceof Error ? error.message : 'This lineup needs review.')
    }
  }
  const endSession = () => {
    if (!session || activeMatches.length) return
    commit((current) => ({
      ...current,
      sessions: current.sessions.map((s) =>
        s.id === session.id ? { ...s, status: 'completed', endedAt: Date.now() } : s,
      ),
    }))
    setEnding(false)
    notify('Session complete. Your results are saved on this device.')
  }
  const loadDemo = () => {
    startDemo()
    setView('courts')
  }
  const suggestions = new Map<number, ReturnType<typeof suggestMatch>>()
  let planningData = data
  if (session)
    for (let court = 1; court <= session.courtCount; court++) {
      const planned = nextSlot(session, court)
      const suggestion = session.plan
        ? planned
          ? { teamA: planned.teamA, teamB: planned.teamB, reason: planned.reason }
          : null
        : suggestMatch(planningData, session, court, now)
      suggestions.set(court, suggestion)
      if (suggestion)
        planningData = {
          ...planningData,
          matches: [
            ...planningData.matches,
            {
              id: `preview-${court}`,
              sessionId: session.id,
              court,
              teamA: suggestion.teamA,
              teamB: suggestion.teamB,
              startedAt: now,
              status: 'playing',
              actions: [],
              revision: 0,
            },
          ],
        }
    }
  const recent = data.matches
    .filter((m) => m.status === 'completed')
    .slice(-3)
    .reverse()
  const liveIds = new Set(activeMatches.flatMap((m) => [...m.teamA, ...m.teamB]))

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR COURTSIDE COMPANION</span>
          <h1>{session ? 'Let’s keep the rally going.' : 'The court is calling.'}</h1>
          <p>
            {session
              ? 'Good matches, fair turns. We’ll handle the organizing.'
              : 'A little less organizing. A lot more badminton.'}
          </p>
        </div>
        <button
          className="button primary"
          disabled={readOnly}
          onClick={() => (session ? setAttendance(true) : setSetup(true))}
        >
          {session ? (
            <>
              <Users size={17} /> Manage players
            </>
          ) : (
            <>
              <Plus size={18} /> New session
            </>
          )}
        </button>
      </div>

      {!session ? (
        <section className="welcome-hero">
          <div className="hero-copy">
            <span className="hero-kicker">
              <span className="status-dot" /> MADE FOR YOUR REGULAR CREW
            </span>
            <h2>
              Good games.
              <br />
              <span>Great company.</span>
            </h2>
            <p>
              Get everyone on court. Keep teams balanced.
              <br className="desktop-break" /> Make every rally count.
            </p>
            <div className="hero-actions">
              <button className="button lime" disabled={readOnly} onClick={() => setSetup(true)}>
                Start a session <ArrowRight size={17} />
              </button>
              {!data.players.length && !data.sessions.length && (
                <button className="hero-demo" disabled={readOnly} onClick={loadDemo}>
                  Explore a demo <ChevronRight size={16} />
                </button>
              )}
            </div>
            <span className="hero-footnote">
              <Check size={14} /> No accounts. No fuss. Works offline.
            </span>
          </div>
          <div className="hero-visual">
            <CourtArt />
            <div className="floating-label">
              <Shuttle size={24} />
              <span>
                <strong>Your next great match</strong>
                <small>Starts with a fair lineup.</small>
              </span>
              <span className="floating-spark">✦</span>
            </div>
          </div>
        </section>
      ) : (
        <section className="session-banner">
          <div className="session-banner-icon">
            <Shuttle size={30} />
          </div>
          <div className="session-banner-title">
            <span className="hero-kicker">
              <span className="status-dot pulse" /> SESSION IN PROGRESS
            </span>
            <h2>{session.name}</h2>
            <p>
              {session.format === 'doubles' ? 'Doubles' : 'Singles'} · {session.target} points ·{' '}
              {session.bestOf === 1 ? 'One game' : 'Best of 3'} ·{' '}
              {session.mode === 'balanced'
                ? 'Balanced teams'
                : session.mode === 'fair'
                  ? 'Fair rotation'
                  : 'Partner variety'}
            </p>
          </div>
          <div className="session-time">
            <Clock3 size={18} />
            <strong>
              {Math.max(0, Math.floor((now - session.startedAt) / 60000))}
              <small> min</small>
            </strong>
            <span>on court together</span>
          </div>
          <button
            className="button session-end"
            disabled={readOnly}
            onClick={() => setEnding(true)}
          >
            <Flag size={16} /> End session
          </button>
        </section>
      )}

      {session && (
        <div className="play-session-tools">
          <div className="play-view-tabs" role="group" aria-label="Session view">
            <button
              className={view === 'courts' ? 'active' : ''}
              aria-pressed={view === 'courts'}
              onClick={() => setView('courts')}
            >
              <Play size={16} /> Courts
            </button>
            <button
              className={view === 'schedule' ? 'active' : ''}
              aria-pressed={view === 'schedule'}
              onClick={() => setView('schedule')}
            >
              <Clock3 size={16} /> Full schedule{' '}
              {session.plan ? `(${session.plan.slots.length})` : ''}
            </button>
          </div>
          <SessionActions
            session={session}
            onDeleted={() => {
              setScoring(null)
              setEnding(false)
              setAttendance(false)
            }}
          />
        </div>
      )}
      {session && view === 'schedule' && (
        <SessionSchedule
          session={session}
          onStart={(slotId) => {
            const slot = session.plan?.slots.find((s) => s.id === slotId)
            if (slot) start(slot.court, undefined, slotId)
          }}
          onScore={(id) => setScoring(id)}
        />
      )}
      <div className="stat-grid">
        <Stat
          icon={<Users size={19} />}
          value={session ? session.playerIds.length : data.players.length}
          label={session ? 'Players in session' : 'Your players'}
          detail={
            session
              ? `${session.availablePlayerIds.filter((id) => currentlyAvailable(session, id, now)).length} available to play`
              : 'Build your regular crew'
          }
          color="green"
        />
        <Stat
          icon={<Shuttle size={20} />}
          value={
            session ? completed.length : data.matches.filter((m) => m.status === 'completed').length
          }
          label={session ? 'Matches finished' : 'Matches together'}
          detail={session ? 'Every result, remembered' : 'Your story, one match at a time'}
          color="purple"
        />
        <Stat
          icon={<Clock3 size={19} />}
          value={
            session
              ? session.availablePlayerIds.filter(
                  (id) => !liveIds.has(id) && currentlyAvailable(session, id, now),
                ).length
              : data.sessions.filter((s) => s.status === 'completed').length
          }
          label={session ? 'Ready for a turn' : 'Sessions played'}
          detail={session ? 'Rotation keeps it fair' : 'Make the next one a good one'}
          color="orange"
        />
      </div>

      <div className="dashboard-columns" hidden={Boolean(session && view === 'schedule')}>
        <section className="panel courts-panel">
          <div className="section-heading">
            <div>
              <h2>{session ? 'On the courts' : 'Your next session'}</h2>
              <p>
                {session
                  ? `${activeMatches.length} of ${session.courtCount} courts playing`
                  : 'Bring your people. We’ll take it from there.'}
              </p>
            </div>
            {session && (
              <span className="tag">
                <span className="status-dot" /> Live
              </span>
            )}
          </div>
          {session ? (
            <div className={`court-grid ${session.courtCount === 1 ? 'single-court' : ''}`}>
              {Array.from({ length: session.courtCount }, (_, index) => {
                const court = index + 1
                const match = activeMatches.find((m) => m.court === court)
                const score = match ? scoreMatch(match, session) : null
                const suggestion = !match ? suggestions.get(court) : null
                const teamA = match?.teamA ?? suggestion?.teamA ?? []
                const teamB = match?.teamB ?? suggestion?.teamB ?? []
                return (
                  <article key={court} className={`court-card ${match ? 'court-live' : ''}`}>
                    <div className="court-card-heading">
                      <span>
                        <span className="court-number">{String(court).padStart(2, '0')}</span> Court{' '}
                        {court}
                      </span>
                      <span className={`tag ${match ? 'tag-live' : ''}`}>
                        {match ? 'Playing' : suggestion ? 'Ready to rally' : 'Waiting'}
                      </span>
                    </div>
                    {teamA.length ? (
                      <>
                        <div className="court-teams">
                          <div>
                            {teamA.map((id) => (
                              <div className="court-person" key={id}>
                                <Avatar
                                  name={playerName(id)}
                                  index={data.players.findIndex((p) => p.id === id)}
                                  small
                                />
                                <span>{playerName(id)}</span>
                              </div>
                            ))}
                          </div>
                          <div className="court-versus">
                            {match ? (
                              <span className="mini-score">
                                {score?.a}
                                <i>:</i>
                                {score?.b}
                              </span>
                            ) : (
                              'vs'
                            )}
                          </div>
                          <div>
                            {teamB.map((id) => (
                              <div className="court-person" key={id}>
                                <Avatar
                                  name={playerName(id)}
                                  index={data.players.findIndex((p) => p.id === id)}
                                  small
                                />
                                <span>{playerName(id)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <p className="court-reason">
                          {match
                            ? `${session.bestOf === 3 ? `Games ${score?.gamesA}–${score?.gamesB} · ` : ''}${Math.max(0, Math.floor((now - match.startedAt) / 60000))} min on court`
                            : suggestion?.reason}
                        </p>
                        <div className="court-actions">
                          <button
                            className={`button ${match ? 'primary' : 'soft'}`}
                            disabled={
                              !match &&
                              (readOnly ||
                                [...teamA, ...teamB].some(
                                  (id) => liveIds.has(id) || !currentlyAvailable(session, id, now),
                                ))
                            }
                            onClick={() =>
                              match ? setScoring(match.id) : start(court, suggestion ?? undefined)
                            }
                          >
                            {match ? (
                              <>
                                Open scoreboard <ArrowRight size={16} />
                              </>
                            ) : (
                              <>
                                <Play size={15} /> Start match
                              </>
                            )}
                          </button>
                          {!match && (
                            <button
                              className="icon-button outlined"
                              aria-label={`Edit teams on court ${court}`}
                              disabled={readOnly}
                              onClick={() => setLineup(court)}
                            >
                              <Settings2 size={17} />
                            </button>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="court-empty">
                        <Shuttle size={30} />
                        <strong>A little more company?</strong>
                        <p>
                          {session.format === 'doubles'
                            ? 'Four available players'
                            : 'Two available players'}{' '}
                          are needed for a match.
                        </p>
                        <button
                          className="button soft"
                          disabled={readOnly}
                          onClick={() => setAttendance(true)}
                        >
                          Manage players
                        </button>
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="session-empty">
              <div className="empty-court">
                <Shuttle size={34} />
              </div>
              <h3>Every great rally starts here.</h3>
              <p>
                Choose your players and courts.
                <br />
                We’ll suggest the teams and keep the score.
              </p>
              <button className="button soft" disabled={readOnly} onClick={() => setSetup(true)}>
                Set up your first session <ArrowRight size={16} />
              </button>
              <div className="session-steps">
                <span>
                  <b>1</b> Pick your crew
                </span>
                <span>
                  <b>2</b> Find your balance
                </span>
                <span>
                  <b>3</b> Play your game
                </span>
              </div>
            </div>
          )}
        </section>

        <aside className="dashboard-aside">
          {session ? (
            <section className="panel rotation-panel">
              <div className="section-heading">
                <div>
                  <h2>On the sidelines</h2>
                  <p>Your turn is coming.</p>
                </div>
                <Coffee size={19} className="muted" />
              </div>
              <div className="waiting-list" tabIndex={0} aria-label="Waiting players">
                {session.playerIds
                  .filter((id) => !liveIds.has(id))
                  .map((id) => {
                    const available = currentlyAvailable(session, id, now)
                    const last = Math.max(
                      attendanceSummary(session, id, now).waitingSince,
                      ...data.matches
                        .filter(
                          (m) =>
                            m.sessionId === session.id &&
                            m.status !== 'playing' &&
                            [...m.teamA, ...m.teamB].includes(id),
                        )
                        .map((m) => m.endedAt ?? m.startedAt),
                    )
                    return (
                      <div className="waiting-player" key={id}>
                        <Avatar
                          name={playerName(id)}
                          index={data.players.findIndex((p) => p.id === id)}
                          small
                        />
                        <div>
                          <strong>{playerName(id)}</strong>
                          <span>
                            {available
                              ? `${Math.max(0, Math.floor((now - last) / 60000))} min waiting`
                              : availabilityLabel(session, id, now)}
                          </span>
                        </div>
                        <span className={`availability-dot ${available ? '' : 'resting'}`} />
                      </div>
                    )
                  })}
                {session.playerIds.every((id) => liveIds.has(id)) && (
                  <p className="small-empty">Everyone is on court. Nice!</p>
                )}
              </div>
              <button
                className="text-button full-width"
                disabled={readOnly}
                onClick={() => setAttendance(true)}
              >
                Manage availability <ArrowRight size={15} />
              </button>
            </section>
          ) : (
            <section className="panel crew-panel">
              <span className="mini-label">BETTER TOGETHER</span>
              <h2>
                Your people.
                <br /> Your kind of game.
              </h2>
              <div className="crew-avatars">
                {['AM', 'PS', 'JC', '+'].map((name, i) => (
                  <span className={`avatar avatar-${i}`} key={name}>
                    {name}
                  </span>
                ))}
              </div>
              <p>Keep your regulars and welcome new faces. Nobody needs an account.</p>
              <button className="text-button" onClick={() => onNavigate('players')}>
                Meet your crew <ArrowRight size={16} />
              </button>
            </section>
          )}
          <section className="rules-promo">
            <div className="rules-promo-icon">
              <CircleHelp size={22} />
            </div>
            <span className="mini-label">A LITTLE COURTSIDE KNOW-HOW</span>
            <h3>“Whose serve is it?”</h3>
            <p>Clear up the call. Explore the rules with interactive court guides.</p>
            <button className="text-button" onClick={() => onNavigate('rules')}>
              Learn the game <ArrowRight size={16} />
            </button>
          </section>
        </aside>
      </div>

      <section className="panel recent-panel">
        <div className="section-heading">
          <div>
            <h2>Recent rallies</h2>
            <p>The games worth remembering.</p>
          </div>
          <button className="text-button" onClick={() => onNavigate('history')}>
            View history <ArrowRight size={16} />
          </button>
        </div>
        {recent.length ? (
          <div className="recent-list">
            {recent.map((m) => {
              const s = data.sessions.find((s) => s.id === m.sessionId)!
              const score = scoreMatch(m, s)
              return (
                <div className="recent-match" key={m.id}>
                  <div className="recent-match-icon">
                    <Trophy size={18} />
                  </div>
                  <div className="recent-match-name">
                    <strong>
                      {m.teamA.map(playerName).join(' & ')} <span>vs</span>{' '}
                      {m.teamB.map(playerName).join(' & ')}
                    </strong>
                    <small>
                      {s.name} · Court {m.court}
                    </small>
                  </div>
                  <span className="result-score">
                    {score.games.map((g) => `${g.a}–${g.b}`).join(' / ')}
                  </span>
                  <span className="tag">Finished</span>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="recent-empty">
            <div>
              <Trophy size={20} />
              <span>Your first match has a place here.</span>
            </div>
            <small>Results and rankings appear when you finish a match.</small>
          </div>
        )}
      </section>

      {setup && (
        <SessionSetup
          onClose={() => setSetup(false)}
          onCreated={() => {
            setSetup(false)
            setView('schedule')
            notify('Session ready. Your complete schedule is waiting.')
          }}
        />
      )}
      {attendance && session && (
        <AttendanceDialog session={session} onClose={() => setAttendance(false)} />
      )}
      {selectedMatch && session && (
        <ScoreDialog
          match={selectedMatch}
          session={session}
          onClose={() => setScoring(null)}
          onRules={() => {
            setScoring(null)
            onNavigate('rules')
          }}
        />
      )}
      {lineup !== null && session && (
        <LineupDialog
          session={session}
          court={lineup}
          slot={nextSlot(session, lineup)}
          onClose={() => setLineup(null)}
          onStart={(teams) => {
            start(lineup, teams)
            setLineup(null)
          }}
        />
      )}
      {ending && session && (
        <Modal
          title="Call it a good session?"
          subtitle="Your match history and rankings stay with your crew."
          onClose={() => setEnding(false)}
        >
          {activeMatches.length ? (
            <div className="notice">
              Finish or stop the {activeMatches.length} active match
              {activeMatches.length > 1 ? 'es' : ''} before ending the session.
            </div>
          ) : (
            <>
              <div className="finish-summary">
                <Trophy size={28} />
                <strong>
                  {completed.length} matches. {session.playerIds.length} players.
                </strong>
                <p>A good time, well played.</p>
              </div>
              <ReportActions data={data} sessionId={session.id} scopeLabel={session.name} />
              <button
                className="button soft full-width"
                onClick={() => !isDemo && downloadBackup(data)}
                disabled={isDemo}
              >
                <ArrowDownToLine size={17} /> Download a backup
              </button>
            </>
          )}
          <div className="modal-actions">
            <button className="button ghost" onClick={() => setEnding(false)}>
              Keep playing
            </button>
            <button
              className="button primary"
              disabled={activeMatches.length > 0 || readOnly}
              onClick={endSession}
            >
              End session <Check size={16} />
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Stat({
  icon,
  value,
  label,
  detail,
  color,
}: {
  icon: React.ReactNode
  value: number
  label: string
  detail: string
  color: string
}) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${color}`}>{icon}</div>
      <div>
        <span className="stat-label">{label}</span>
        <strong>{String(value).padStart(2, '0')}</strong>
        <small>{detail}</small>
      </div>
    </div>
  )
}

function SessionSetup({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { data, commit, notify } = useRally()
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<string[]>(data.players.map((p) => p.id))
  const [guest, setGuest] = useState('')
  const [format, setFormat] = useState<'singles' | 'doubles'>('doubles')
  const [courts, setCourts] = useState(1)
  const [target, setTarget] = useState(21)
  const [bestOf, setBestOf] = useState<1 | 3>(1)
  const [mode, setMode] = useState<'balanced' | 'fair' | 'variety'>('balanced')
  const [advanced, setAdvanced] = useState(false)
  const [planning, setPlanning] = useState(defaultPlanningSettings)
  const [scoringMode, setScoringMode] = useState<'team' | 'individual' | 'combined'>('combined')
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
      winBy: 2,
      cap: target === 21 ? 30 : target + 9,
      bestOf,
      mode,
      planning,
      scoringMode,
      playerIds: selected,
      availablePlayerIds: selected,
      status: 'active',
      attendance: selected.map((playerId) => ({ playerId, at: now, available: true })),
    }
    commit((current) => {
      if (current.sessions.some((s) => s.status === 'active')) return current
      const combined = { ...current, sessions: [...current.sessions, session] }
      const planned = { ...session, plan: generatePlan(combined, session) }
      return { ...combined, sessions: [...current.sessions, planned] }
    })
    onCreated()
  }
  return (
    <Modal
      title="Make room for a good game."
      subtitle="Pick your crew. We’ll take care of the rotation."
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} className="form-stack">
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
            <select value={courts} onChange={(e) => setCourts(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6].map((c) => (
                <option key={c} value={c}>
                  {c} court{c > 1 ? 's' : ''}
                </option>
              ))}
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
                {[11, 15, 21].map((n) => (
                  <option key={n} value={n}>
                    {n} points{n !== 21 ? ' · house format' : ' · standard'}
                  </option>
                ))}
              </select>
              <small className="field-help">
                Win by 2, capped at {target === 21 ? 30 : target + 9}.
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

function AttendanceDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const { data, commit, readOnly, notify } = useRally()
  const [name, setName] = useState('')
  const busy = new Set(
    data.matches.filter((m) => m.status === 'playing').flatMap((m) => [...m.teamA, ...m.teamB]),
  )
  const setAvailable = (id: string, available: boolean) => {
    commit((current) => ({
      ...current,
      sessions: current.sessions.map((s) =>
        s.id !== session.id
          ? s
          : {
              ...s,
              playerIds: s.playerIds.includes(id) ? s.playerIds : [...s.playerIds, id],
              availablePlayerIds: available
                ? [...new Set([...s.availablePlayerIds, id])]
                : s.availablePlayerIds.filter((p) => p !== id),
              attendance: [...(s.attendance ?? []), { playerId: id, at: Date.now(), available }],
            },
      ),
    }))
  }
  const add = () => {
    const value = name.trim()
    if (!value) return
    const exists = data.players.find((p) => p.name.toLowerCase() === value.toLowerCase())
    if (exists) {
      setAvailable(exists.id, true)
      setName('')
      return
    }
    const id = crypto.randomUUID()
    commit((current) => ({
      ...current,
      players: [...current.players, { id, name: value, level: 3, createdAt: Date.now() }],
      sessions: current.sessions.map((s) =>
        s.id === session.id
          ? {
              ...s,
              playerIds: [...s.playerIds, id],
              availablePlayerIds: [...s.availablePlayerIds, id],
              attendance: [
                ...(s.attendance ?? []),
                { playerId: id, at: Date.now(), available: true },
              ],
            }
          : s,
      ),
    }))
    setName('')
    notify(`${value} joined. Rotation now includes them.`)
  }
  return (
    <Modal
      title="Everyone gets a turn."
      subtitle="New arrival? Taking a breather? Keep the lineup up to date."
      onClose={onClose}
    >
      <div className="quick-add">
        <input
          aria-label="Add player to session"
          placeholder="Add a player by name"
          maxLength={48}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
        />
        <button className="button soft" disabled={readOnly || !name.trim()} onClick={add}>
          <Plus size={16} /> Add
        </button>
      </div>
      <div className="attendance-list">
        {data.players.map((p, i) => {
          const joined = session.playerIds.includes(p.id)
          const available = session.availablePlayerIds.includes(p.id)
          return (
            <div className="attendance-row" key={p.id}>
              <Avatar name={p.name} index={i} small />
              <div>
                <strong>{p.name}</strong>
                <small>
                  {busy.has(p.id)
                    ? 'On court · finish match to take a break'
                    : !joined
                      ? 'Not in this session'
                      : available
                        ? currentlyAvailable(session, p.id)
                          ? 'Ready for the next rally'
                          : availabilityLabel(session, p.id)
                        : 'Taking a break / away'}
                </small>
              </div>
              <button
                className={`button ${available ? 'ghost' : 'soft'} small`}
                disabled={readOnly || busy.has(p.id)}
                onClick={() => setAvailable(p.id, !available)}
              >
                {available ? (
                  <>
                    <Coffee size={15} /> Break
                  </>
                ) : joined ? (
                  'Return'
                ) : (
                  'Join'
                )}
              </button>
              <AvailabilityWindow session={session} playerId={p.id} name={p.name} />
            </div>
          )
        })}
      </div>
      <div className="notice subtle">
        <Clock3 size={17} />
        <span>
          Waiting starts when a player joins or returns. Time away doesn’t create extra priority.
        </span>
      </div>
      <div className="modal-actions">
        <button className="button primary" onClick={onClose}>
          All set <Check size={16} />
        </button>
      </div>
    </Modal>
  )
}

function LineupDialog({
  session,
  court,
  slot,
  onClose,
  onStart,
}: {
  session: Session
  court: number
  slot?: PlannedMatch
  onClose: () => void
  onStart: (teams: { teamA: string[]; teamB: string[] }) => void
}) {
  const { data } = useRally()
  const suggestion = slot ?? suggestMatch(data, session, court)
  const [teamA, setA] = useState(suggestion?.teamA ?? [])
  const [teamB, setB] = useState(suggestion?.teamB ?? [])
  const count = session.format === 'doubles' ? 2 : 1
  const busy = new Set(
    data.matches.filter((m) => m.status === 'playing').flatMap((m) => [...m.teamA, ...m.teamB]),
  )
  const eligible = data.players.filter(
    (p) =>
      session.availablePlayerIds.includes(p.id) &&
      !busy.has(p.id) &&
      (session.availability?.[p.id]?.from ?? 0) <= Date.now() &&
      (session.availability?.[p.id]?.until ?? Infinity) > Date.now(),
  )
  const chosen = [...teamA, ...teamB]
  const valid =
    chosen.filter(Boolean).length === count * 2 &&
    new Set(chosen).size === count * 2 &&
    chosen.every((id) => eligible.some((p) => p.id === id))
  return (
    <Modal
      title={`Your lineup. Court ${court}.`}
      subtitle="Our suggestion is a starting point. You know your crew best."
      onClose={onClose}
    >
      <div className="lineup-columns">
        {(
          [
            ['A', teamA, setA],
            ['B', teamB, setB],
          ] as const
        ).map(([side, team, set]) => (
          <div key={side}>
            <span className="eyebrow">SIDE {side}</span>
            {Array.from({ length: count }, (_, i) => (
              <label className="field" key={i}>
                Player {i + 1}
                <select
                  aria-label={`Side ${side} player ${i + 1}`}
                  value={team[i] ?? ''}
                  onChange={(e) => {
                    const next = [...team]
                    next[i] = e.target.value
                    set(next)
                  }}
                >
                  <option value="">Choose player</option>
                  {eligible.map((p) => (
                    <option
                      key={p.id}
                      value={p.id}
                      disabled={chosen.includes(p.id) && team[i] !== p.id}
                    >
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        ))}
      </div>
      <p className="field-help">
        Manual teams may trade competitive balance or playing-time fairness for your preferred
        matchup.
      </p>
      <div className="modal-actions">
        <button className="button ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={!valid}
          onClick={() => onStart({ teamA, teamB })}
        >
          <Play size={16} /> Start match
        </button>
      </div>
    </Modal>
  )
}

export { default as FinalScoreEntry } from './scoring/FinalScoreEntry'
