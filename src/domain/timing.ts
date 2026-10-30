import type { Match, Session } from './model'
import { getEffectiveScoreActions, scoreMatch } from './engine'

export function isMatchPaused(match: Match): boolean {
  return (
    match.status === 'playing' &&
    match.timing?.pauses.at(-1)?.to === undefined &&
    Boolean(match.timing?.pauses.length)
  )
}

/** Elapsed court occupancy, retaining the confirmation timestamp for auditability. */
export function matchElapsedMinutes(match: Match, now = Date.now()): number {
  return Math.max(0, (match.endedAt ?? now) - match.startedAt) / 60_000
}

/** Match time excluding only recorded pauses and tracked result-review time. */
export function matchPlayIntervals(match: Match, now = Date.now()): [number, number][] {
  const end = Math.max(
    match.startedAt,
    Math.min(match.endedAt ?? now, match.timing?.finishedAt ?? Infinity),
  )
  const intervals: [number, number][] = []
  let cursor = match.startedAt
  for (const pause of match.timing?.pauses ?? []) {
    const from = Math.max(cursor, Math.min(end, pause.from))
    if (from > cursor) intervals.push([cursor, from])
    cursor = Math.max(cursor, Math.min(end, pause.to ?? end))
  }
  if (cursor < end) intervals.push([cursor, end])
  return intervals
}

export function matchPlayMinutes(match: Match, now = Date.now()): number {
  return matchPlayIntervals(match, now).reduce((sum, [from, to]) => sum + to - from, 0) / 60_000
}

/** Keep the play-end timestamp consistent with a newly accepted scoring operation. */
export function syncMatchTiming(match: Match, session: Session, now = Date.now()): Match {
  if (!match.timing) return match
  const complete = scoreMatch(match, session).complete
  if (!complete) {
    if (match.timing.finishedAt === undefined) return match
    const { finishedAt: _oldEnd, ...timing } = match.timing
    return { ...match, timing }
  }
  if (match.timing.finishedAt !== undefined) return match
  const finishedAt = Math.max(
    match.startedAt,
    Math.min(now, getEffectiveScoreActions(match, session).at(-1)?.action.at ?? now),
  )
  return { ...match, timing: { ...match.timing, finishedAt } }
}

export function pauseMatch(match: Match, session: Session, now = Date.now()): Match {
  if (match.status !== 'playing' || scoreMatch(match, session).complete || isMatchPaused(match))
    throw new Error('Only an unfinished, running match can be paused.')
  const from = Math.max(match.startedAt, match.timing?.pauses.at(-1)?.to ?? 0, now)
  return {
    ...match,
    revision: match.revision + 1,
    timing: { ...match.timing, pauses: [...(match.timing?.pauses ?? []), { from }] },
  }
}

export function resumeMatch(match: Match, now = Date.now()): Match {
  if (!isMatchPaused(match)) throw new Error('This match is not paused.')
  return {
    ...match,
    revision: match.revision + 1,
    timing: {
      ...match.timing!,
      pauses: match.timing!.pauses.map((pause, index, pauses) =>
        index === pauses.length - 1 ? { ...pause, to: Math.max(pause.from, now) } : pause,
      ),
    },
  }
}
