import { useEffect, useId, useMemo, useState } from 'react'
import {
  ArrowDownRight,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  ExternalLink,
  Minus,
  Plus,
  Pause,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import './rules.css'

type Topic =
  'All rules' | 'The basics' | 'Serving' | 'Singles' | 'Doubles' | 'Common calls' | 'Social formats'
type Rule = {
  id: string
  topic: Exclude<Topic, 'All rules'>
  title: string
  summary: string
  details: string[]
  house?: boolean
}

const topics: Topic[] = [
  'All rules',
  'The basics',
  'Serving',
  'Singles',
  'Doubles',
  'Common calls',
  'Social formats',
]
const rules: Rule[] = [
  {
    id: 'scoring',
    topic: 'The basics',
    title: 'Every rally is a point.',
    summary: 'The side that wins a rally adds one point, whether serving or receiving.',
    details: [
      'The standard match is best of three games. Each game is normally played to 21 points.',
      'At 20–20, a side needs a two-point lead. At 29–29, the next point wins: 30 is the cap.',
      'The side that wins a game serves first in the next game.',
    ],
  },
  {
    id: 'service-court',
    topic: 'Serving',
    title: 'Even right. Odd left.',
    summary: 'Your side’s score tells you which service court to serve from.',
    details: [
      'Serve from the right service court when your side has an even score, including zero. Use the left court when your side has an odd score.',
      'The server and receiver stand in diagonally opposite service courts without touching the boundary lines.',
      'In doubles, the score determines the service court, but player identity also depends on the previous service sequence. Try the diagram above for the court position.',
    ],
  },
  {
    id: 'legal-serve',
    topic: 'Serving',
    title: 'Make a legal serve.',
    summary: 'Stand still, serve diagonally, and use one continuous forward action.',
    details: [
      'Some part of both feet of the server and receiver must stay in contact with the court and stationary from the start of service until delivery.',
      'Under the standard fixed-height service law, the whole shuttle must be below 1.15 metres from the court surface when struck. Check the service regulations used by your competition.',
      'The server must release the shuttle without adding spin, initially hit its base, and continue the racket’s forward movement once service begins.',
      'The shuttle must travel upward over the net and, if not intercepted, land within the correct receiving service court, including its boundary lines.',
    ],
  },
  {
    id: 'singles-lines',
    topic: 'Singles',
    title: 'Singles: long and narrow.',
    summary: 'Use the inner sidelines and the full back boundary.',
    details: [
      'In singles, both service and rally play use the inner side boundaries.',
      'The back boundary is the outer back line, including for a serve. The short service line still bounds the front of the receiving service court.',
      'After a serve is returned, the full singles court is in play.',
    ],
  },
  {
    id: 'doubles-lines',
    topic: 'Doubles',
    title: 'Doubles: watch the back line.',
    summary: 'A serve is short and wide. Rally play uses the full court.',
    details: [
      'For service in doubles, use the outer sidelines and the inner back service line.',
      'Once the serve is returned, the outer back boundary and outer sidelines are in play.',
      'A shuttle landing on a relevant boundary line is in. The correct boundary depends on whether this is the serve or a later shot.',
    ],
  },
  {
    id: 'doubles-rotation',
    topic: 'Doubles',
    title: 'Rotate only when you should.',
    summary: 'Partners change service courts after winning a point while their side serves.',
    details: [
      'When the serving side wins a rally, the same player serves again from the alternate service court.',
      'When the receiving side wins a rally, it scores a point and gains service. Its players do not swap courts just because they won that rally.',
      'The new server is the player correctly positioned in the service court corresponding to that side’s score. The opponents do not change their service positions until the appropriate serving-side point.',
      'After the service is returned, either partner can play the shuttle from any position on their own side. Service position is different from rally positioning.',
    ],
  },
  {
    id: 'ends',
    topic: 'The basics',
    title: 'Take a breather. Change ends.',
    summary: 'Standard intervals and end changes keep a match fair.',
    details: [
      'In a standard 21-point game, an interval of no more than 60 seconds is allowed when the leading score reaches 11. Between games, the interval is no more than 120 seconds.',
      'Change ends after the first game and after the second game if a third will be played.',
      'In the third game, change ends when a side first scores 11.',
    ],
  },
  {
    id: 'line-calls',
    topic: 'Common calls',
    title: 'On the line? It’s in.',
    summary: 'Boundary lines form part of the area they mark.',
    details: [
      'A shuttle touching a relevant boundary line is in. A shuttle landing completely outside it is out.',
      'Use the service boundaries for a serve and the rally boundaries after the serve is returned.',
      'For an informal game, agree on a fair procedure for uncertain calls before playing. Replaying a disputed point by agreement is a house arrangement, not an automatic official let.',
    ],
  },
  {
    id: 'faults',
    topic: 'Common calls',
    title: 'Know the common faults.',
    summary: 'Net contact, an out shuttle, or an illegal hit can end a rally.',
    details: [
      'A shuttle landing out, failing to pass over the net, touching a player’s body or clothing, or hitting the ceiling is normally a fault. Check any approved venue-specific regulations.',
      'Touching the net or its supports with your racket, person, or clothing while the shuttle is in play is a fault.',
      'Partners cannot hit the shuttle successively. A carried or slung shuttle is also a fault.',
      'Your initial contact with the shuttle must be on your own side. A legal follow-through over the net is permitted. Obstructing or distracting an opponent is not.',
    ],
  },
  {
    id: 'lets',
    topic: 'Common calls',
    title: 'A let replays the rally.',
    summary: 'A genuine interruption can mean no point is awarded.',
    details: [
      'A let means the play since the last service does not count, and the last server serves again.',
      'Examples include a server serving before the receiver is ready, unless the receiver attempts to return, or an unforeseen or accidental situation.',
      'A serve clipping the net is not automatically a let in badminton. If it crosses and otherwise lands legally, play continues.',
    ],
  },
  {
    id: 'timed',
    topic: 'Social formats',
    title: 'Short on time? Agree first.',
    summary: 'Timed games work well when everyone knows the finish rule.',
    details: [
      'Choose the duration and decide what happens when the timer ends: finish the current rally, allow a draw, or play a deciding point.',
      'Agree on whether games stop at the target score or continue for the full time.',
      'These are recreational rules. Mark them as custom settings rather than presenting them as standard BWF match rules.',
    ],
    house: true,
  },
  {
    id: 'friendly',
    topic: 'Social formats',
    title: 'Make your house rules clear.',
    summary: 'Short games, handicaps, and rotating partners are welcome—with shared expectations.',
    details: [
      'Agree on target points, winning margin, score cap, and fixed or rotating partners before starting.',
      'A handicap should be recorded as part of the match rules, not confused with points won during rallies.',
      'Keep official-format and custom-format results distinguishable when comparing records and rankings.',
    ],
    house: true,
  },
]

type DemoSide = 'A' | 'B'
const exampleRallies: DemoSide[] = ['A', 'B', 'B', 'A']

function demoSequence(winners: DemoSide[]) {
  let serving: DemoSide = 'A'
  let a = 0
  let b = 0
  const right = { A: 'A1', B: 'B1' }
  for (const winner of winners) {
    if (winner === 'A') a++
    else b++
    if (winner === serving)
      right[winner] = right[winner].endsWith('1') ? `${winner}2` : `${winner}1`
    serving = winner
  }
  return { a, b, serving, right }
}

function CourtExplainer() {
  const [format, setFormat] = useState<'singles' | 'doubles'>('doubles')
  const [winners, setWinners] = useState<DemoSide[]>([])
  const [boundary, setBoundary] = useState<'service' | 'rally'>('service')
  const [lessonStep, setLessonStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const id = useId().replace(/:/g, '')
  const state = demoSequence(winners)
  const score = state.serving === 'A' ? state.a : state.b
  const even = score % 2 === 0
  const receiving: DemoSide = state.serving === 'A' ? 'B' : 'A'
  const serviceCourt = even ? 'right' : 'left'
  const courtPosition = (player: string): 'right' | 'left' =>
    state.right[player[0] as DemoSide] === player ? 'right' : 'left'
  const playerY = (player: string) => {
    const side = player[0] as DemoSide
    const right = format === 'singles' ? even : courtPosition(player) === 'right'
    return side === 'A' ? (right ? 225 : 115) : right ? 115 : 225
  }
  const serverId =
    format === 'singles'
      ? `${state.serving}1`
      : [
          state.right[state.serving],
          `${state.serving}${state.right[state.serving].endsWith('1') ? '2' : '1'}`,
        ][even ? 0 : 1]
  const receiverId =
    format === 'singles'
      ? `${receiving}1`
      : [state.right[receiving], `${receiving}${state.right[receiving].endsWith('1') ? '2' : '1'}`][
          even ? 0 : 1
        ]
  const serverX = state.serving === 'A' ? 125 : 395
  const receiverX = state.serving === 'A' ? 395 : 125
  const serverY = playerY(serverId)
  const receiverY = playerY(receiverId)
  const sideTop = format === 'singles' ? 80 : 60
  const sideBottom = format === 'singles' ? 260 : 280
  const leftBack = format === 'singles' ? 52 : 76
  const rightBack = format === 'singles' ? 468 : 444
  const lastWinner = winners.at(-1)
  const priorServing = winners.length > 1 ? winners.at(-2)! : 'A'
  const keptServe = lastWinner === priorServing
  const explanation = !lastWinner
    ? 'Start at 0–0. A1 serves from the right; B1 receives diagonally opposite.'
    : format === 'singles'
      ? `${serverId} serves from the ${serviceCourt}. The receiver stands diagonally opposite.`
      : keptServe
        ? `Side ${lastWinner} won while serving. Only ${lastWinner}1 and ${lastWinner}2 swap. Side ${receiving} stays in place; ${serverId} serves again.`
        : `Side ${lastWinner} won while receiving. Nobody swaps. ${serverId} now serves from the ${serviceCourt}.`

  useEffect(() => {
    if (!playing) return
    const timer = window.setTimeout(() => {
      const next = lessonStep + 1
      setWinners(exampleRallies.slice(0, next))
      setLessonStep(next)
      if (next === exampleRallies.length) setPlaying(false)
    }, 2600)
    return () => window.clearTimeout(timer)
  }, [playing, lessonStep])

  const award = (winner: DemoSide) => {
    setPlaying(false)
    setLessonStep(0)
    setWinners((current) => [...current, winner])
  }
  const reset = () => {
    setWinners([])
    setLessonStep(0)
    setPlaying(false)
  }
  const nextExample = () => {
    setPlaying(false)
    const next = lessonStep >= exampleRallies.length ? 1 : lessonStep + 1
    setLessonStep(next)
    setWinners(exampleRallies.slice(0, next))
  }
  return (
    <section className="rules-explainer" aria-labelledby="service-heading">
      <div className="rules-explainer-content">
        <span className="rules-eyebrow rules-eyebrow-light">
          <Sparkles size={14} aria-hidden="true" /> LEARN BY PLAYING
        </span>
        <h2 id="service-heading">Serving, made simple.</h2>
        <p>
          Follow the same named players through each rally. A highlight changes who serves; only the
          correct partners move.
        </p>
        <div className="rules-mode" role="group" aria-label="Court format">
          {(['singles', 'doubles'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={format === value}
              onClick={() => setFormat(value)}
            >
              {value === 'singles' ? 'Singles' : 'Doubles'}
            </button>
          ))}
        </div>
      </div>
      <div className="rules-court-wrap">
        <div className="rules-court-label">
          <span className="rules-live-dot" /> NEXT SERVE <span>{format}</span>
        </div>
        <div
          className="rules-match-score"
          aria-label={`Demonstration score: Side A ${state.a}, Side B ${state.b}`}
        >
          <span className={state.serving === 'A' ? 'is-serving' : ''}>
            A <strong>{state.a}</strong>
          </span>
          <span aria-hidden="true">–</span>
          <span className={state.serving === 'B' ? 'is-serving' : ''}>
            B <strong>{state.b}</strong>
          </span>
        </div>
        <svg
          className="rules-court"
          viewBox="0 0 520 340"
          role="img"
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-desc`}
        >
          <title id={`${id}-title`}>
            {format} service court at a score of {score}
          </title>
          <desc id={`${id}-desc`}>
            {serverId} serves from the {serviceCourt} service court to {receiverId} diagonally
            opposite. {explanation}{' '}
            {boundary === 'rally'
              ? 'The outline shows the full legal rally court.'
              : 'Highlighted areas show the service courts.'}
          </desc>
          <defs>
            <pattern id={`${id}-grid`} width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#ffffff" strokeOpacity=".025" />
            </pattern>
            <marker
              id={`${id}-arrow`}
              markerWidth="6"
              markerHeight="6"
              refX="5"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L6,3 L0,6" fill="#d9f96c" />
            </marker>
          </defs>
          <rect width="520" height="340" fill={`url(#${id}-grid)`} />
          <rect x="52" y="60" width="416" height="220" rx="1" fill="#24463e" />
          {boundary === 'service' ? (
            <>
              <rect
                className="rules-highlight"
                x={leftBack}
                y={even ? 170 : sideTop}
                width={194 - leftBack}
                height={even ? sideBottom - 170 : 170 - sideTop}
                fill="#d9f96c"
                fillOpacity=".24"
              />
              <rect
                className="rules-highlight"
                x="326"
                y={even ? sideTop : 170}
                width={rightBack - 326}
                height={even ? 170 - sideTop : sideBottom - 170}
                fill="#d9f96c"
                fillOpacity=".24"
              />
            </>
          ) : (
            <rect
              className="rules-rally-area"
              x="52"
              y={sideTop}
              width="416"
              height={sideBottom - sideTop}
              fill="#d9f96c"
              fillOpacity=".1"
              stroke="#d9f96c"
              strokeWidth="3"
            />
          )}
          <g fill="none" stroke="#e8f4df" strokeWidth="1.7" strokeOpacity=".72">
            <rect x="52" y="60" width="416" height="220" />
            <path d="M52 80H468 M52 260H468 M76 60V280 M444 60V280 M194 60V280 M326 60V280 M52 170H194 M326 170H468" />
          </g>
          {format === 'singles' && (
            <rect
              x="52"
              y="80"
              width="416"
              height="180"
              fill="none"
              stroke="#d9f96c"
              strokeWidth="2.2"
            />
          )}
          <path d="M260 42V298" stroke="#f7faf5" strokeWidth="3" />
          <path d="M253 52H267 M253 288H267" stroke="#f7faf5" strokeWidth="3" />
          <text x="260" y="28" textAnchor="middle" className="rules-svg-label">
            NET
          </text>
          <text x="126" y="310" textAnchor="middle" className="rules-svg-label">
            SIDE A
          </text>
          <text x="395" y="310" textAnchor="middle" className="rules-svg-label">
            SIDE B
          </text>
          <text x="73" y="151" className="rules-own-court-label">
            L
          </text>
          <text x="73" y="195" className="rules-own-court-label">
            R
          </text>
          <text x="444" y="151" className="rules-own-court-label">
            R
          </text>
          <text x="444" y="195" className="rules-own-court-label">
            L
          </text>
          {boundary === 'service' && (
            <path
              className="rules-shuttle-path"
              key={`${format}-${state.serving}-${even}`}
              d={`M${serverX + (state.serving === 'A' ? 24 : -24)} ${serverY} Q260 ${even ? 130 : 210} ${receiverX + (state.serving === 'A' ? -24 : 24)} ${receiverY}`}
              fill="none"
              stroke="#d9f96c"
              strokeWidth="2"
              strokeDasharray="5 6"
              markerEnd={`url(#${id}-arrow)`}
            />
          )}
          {(format === 'doubles' ? ['A1', 'A2', 'B1', 'B2'] : ['A1', 'B1']).map((player) => {
            const serving = player === serverId
            const receives = player === receiverId
            return (
              <g
                key={player}
                className="rules-court-player"
                data-player={player}
                data-position={format === 'singles' ? serviceCourt : courtPosition(player)}
                data-role={serving ? 'server' : receives ? 'receiver' : 'partner'}
                style={{
                  transform: `translate(${player.startsWith('A') ? 125 : 395}px, ${playerY(player)}px)`,
                }}
              >
                <title>
                  {player} · {serving ? 'Server' : receives ? 'Receiver' : 'Partner'} ·{' '}
                  {format === 'singles' ? serviceCourt : courtPosition(player)} service court
                </title>
                {serving && (
                  <circle className="rules-server-halo" r="27" fill="#d9f96c" fillOpacity=".15" />
                )}
                <circle
                  r="19"
                  fill={serving ? '#d9f96c' : player.startsWith('A') ? '#9cbcae' : '#d1c3e7'}
                  stroke={serving ? '#d9f96c' : receives ? '#fff' : '#203e36'}
                  strokeWidth={receives ? '3' : '1.5'}
                />
                <text y="4" textAnchor="middle" className="rules-player-letter rules-player-server">
                  {player}
                </text>
                {serving && (
                  <text y="-34" textAnchor="middle" className="rules-server-caption">
                    SERVE
                  </text>
                )}
              </g>
            )
          })}
        </svg>
        <div className="rules-court-key">
          <span>
            <i className="rules-key-server" />
            Server
          </span>
          <span>
            <i className="rules-key-receiver" />
            Receiver ring
          </span>
          <span>R / L = facing the net</span>
        </div>
        <div
          className="rules-boundary-toggle"
          role="group"
          aria-label="Court boundary demonstration"
        >
          <button
            type="button"
            aria-pressed={boundary === 'service'}
            onClick={() => setBoundary('service')}
          >
            Serve lines
          </button>
          <button
            type="button"
            aria-pressed={boundary === 'rally'}
            onClick={() => setBoundary('rally')}
          >
            Rally lines
          </button>
        </div>
        <p className="rules-boundary-note" aria-live="polite">
          {boundary === 'service'
            ? format === 'doubles'
              ? 'Doubles serve: wide sidelines, inner back service line.'
              : 'Singles serve: narrow sidelines, full back line.'
            : format === 'doubles'
              ? 'After the return: the full wide, long court is in play.'
              : 'After the return: the full length, narrow court is in play.'}
        </p>
      </div>
      <div className="rules-explainer-controls">
        <div className="rules-score-control">
          <span>
            Serving side’s score{' '}
            <strong className="rules-serving-side">Side {state.serving}</strong>
          </span>
          <div className="rules-score-stepper">
            <button
              type="button"
              aria-label="Decrease serving score"
              title="Undo the last demonstrated rally"
              disabled={!winners.length}
              onClick={() => {
                setPlaying(false)
                setLessonStep(0)
                setWinners((current) => current.slice(0, -1))
              }}
            >
              <Minus size={17} />
            </button>
            <output aria-label="Serving score">{score}</output>
            <button
              type="button"
              aria-label="Increase serving score"
              disabled={score === 30}
              onClick={() => award(state.serving)}
            >
              <Plus size={17} />
            </button>
          </div>
        </div>
        <div className="rules-service-answer" aria-live="polite" aria-atomic="true">
          <Check size={17} aria-hidden="true" />
          <span>
            <strong>{even ? 'Even score → right court' : 'Odd score → left court'}</strong>
            <br />
            {explanation}
          </span>
        </div>
        <div className="rules-demo-actions">
          <button
            className="rules-next"
            type="button"
            disabled={score === 30}
            onClick={() => award(state.serving)}
          >
            Point to serving side <ArrowRight size={16} />
          </button>
          <button
            className="rules-reset"
            type="button"
            aria-label="Reset service demonstration"
            onClick={reset}
          >
            <RotateCcw size={17} />
          </button>
        </div>
        <button
          className="rules-side-out"
          type="button"
          disabled={(receiving === 'A' ? state.a : state.b) === 30}
          onClick={() => award(receiving)}
        >
          Point to receiving side <ArrowRight size={15} />
        </button>
        <details
          className="rules-guided-example"
          onToggle={(event) => {
            if (!event.currentTarget.open) setPlaying(false)
          }}
        >
          <summary>Watch a four-rally example</summary>
          <div className="rules-example-controls">
            <button
              type="button"
              onClick={() => {
                if (playing) setPlaying(false)
                else {
                  if (lessonStep >= exampleRallies.length || lessonStep === 0) {
                    setWinners([])
                    setLessonStep(0)
                  }
                  setPlaying(true)
                }
              }}
              aria-label={playing ? 'Pause rally example' : 'Play rally example'}
            >
              {playing ? <Pause size={15} /> : <Play size={15} />}
              {playing ? 'Pause' : 'Play'}
            </button>
            <button type="button" onClick={nextExample}>
              Next rally <ArrowRight size={15} />
            </button>
            <span aria-live="polite">{lessonStep} / 4</span>
          </div>
          <p>A wins → B wins → B wins → A wins. Watch who stays still when service changes.</p>
        </details>
        <p className="rules-demo-note">
          These are positions for the next serve. After the return, players can move freely on their
          side.
        </p>
      </div>
    </section>
  )
}

export default function RulesPage() {
  const [topic, setTopic] = useState<Topic>('All rules')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const filtered = useMemo(
    () =>
      rules.filter(
        (rule) =>
          (topic === 'All rules' || rule.topic === topic) &&
          `${rule.title} ${rule.summary} ${rule.details.join(' ')} ${rule.topic}`
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
      ),
    [search, topic],
  )
  return (
    <div className="rules-page">
      <header className="rules-page-heading">
        <div>
          <span className="rules-eyebrow">A LITTLE KNOW-HOW GOES A LONG WAY</span>
          <h1>
            Know the game.<span>Enjoy every rally.</span>
          </h1>
          <p>
            Your courtside companion for the basics, the tricky calls, and everything in between.
          </p>
        </div>
        <div className="rules-heading-mark" aria-hidden="true">
          <BookOpen size={30} strokeWidth={1.5} />
          <span>PLAY. LEARN. REPEAT.</span>
        </div>
      </header>
      <CourtExplainer />
      <section className="rules-library" aria-labelledby="rules-library-title">
        <div className="rules-library-heading">
          <div>
            <span className="rules-eyebrow">THE QUICK REFERENCE</span>
            <h2 id="rules-library-title">Less guessing. More playing.</h2>
          </div>
          <label className="rules-search">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search a rule or question…"
              aria-label="Search badminton rules"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button type="button" aria-label="Clear rule search" onClick={() => setSearch('')}>
                <X size={16} />
              </button>
            )}
          </label>
        </div>
        <div className="rules-topics" role="group" aria-label="Filter rules by topic">
          {topics.map((item) => (
            <button
              type="button"
              key={item}
              className={item === topic ? 'is-active' : ''}
              aria-pressed={item === topic}
              onClick={() => setTopic(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <p className="rules-result-count" aria-live="polite">
          {filtered.length} {filtered.length === 1 ? 'rule' : 'rules'} to explore{' '}
          <span>· Tap a card for the details</span>
        </p>
        <div className="rules-grid">
          {filtered.map((rule, index) => (
            <article
              key={rule.id}
              className={`rules-card ${expanded === rule.id ? 'is-open' : ''}`}
            >
              <button
                type="button"
                className="rules-card-trigger"
                onClick={() => setExpanded(expanded === rule.id ? null : rule.id)}
                aria-expanded={expanded === rule.id}
                aria-controls={`rule-${rule.id}`}
              >
                <div className="rules-card-top">
                  <span className={`rules-card-topic ${rule.house ? 'is-house' : ''}`}>
                    {rule.house ? 'House rules' : rule.topic}
                  </span>
                  <span className="rules-card-number">{String(index + 1).padStart(2, '0')}</span>
                </div>
                <h3>{rule.title}</h3>
                <p>{rule.summary}</p>
                <span className="rules-card-bottom">
                  {expanded === rule.id ? 'Close explanation' : 'Read the rule'}
                  <ChevronDown size={17} />
                </span>
              </button>
              <div
                hidden={expanded !== rule.id}
                className="rules-card-details"
                id={`rule-${rule.id}`}
              >
                <ul>
                  {rule.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
                {rule.house && (
                  <p className="rules-house-note">
                    <CircleHelp size={15} aria-hidden="true" />
                    Recreational variation—not standard competition law.
                  </p>
                )}
              </div>
            </article>
          ))}
        </div>
        {filtered.length === 0 && (
          <div className="rules-empty">
            <Search size={28} />
            <h3>No rules found</h3>
            <p>Try “serve”, “line”, or “doubles”, or explore another topic.</p>
            <button
              type="button"
              onClick={() => {
                setSearch('')
                setTopic('All rules')
              }}
            >
              Show all rules <ArrowRight size={16} />
            </button>
          </div>
        )}
      </section>
      <aside className="rules-source">
        <div className="rules-source-icon">
          <BookOpen size={21} />
        </div>
        <div>
          <strong>A handy guide, with the official rules a tap away.</strong>
          <p>
            These explanations summarize standard badminton laws. Competition formats and service
            regulations can vary; check the current rules for your event. Cached guidance remains
            available offline.
          </p>
        </div>
        <a
          href="https://corporate.bwfbadminton.com/statutes/"
          target="_blank"
          rel="noopener noreferrer"
        >
          BWF laws & regulations <ExternalLink size={15} aria-hidden="true" />
        </a>
      </aside>
      <div className="rules-footer-note">
        <ArrowDownRight size={16} aria-hidden="true" />
        Good games start with everyone on the same page.
      </div>
    </div>
  )
}
