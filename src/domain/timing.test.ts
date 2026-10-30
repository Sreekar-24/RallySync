import { describe, expect, it } from 'vitest'
import type { Match, Session } from './model'
import { adjustMatchScores, buildFinalResult } from './engine'
import { validateData } from '../lib/storage'
import {
  isMatchPaused,
  matchElapsedMinutes,
  matchPlayIntervals,
  matchPlayMinutes,
  pauseMatch,
  resumeMatch,
  syncMatchTiming,
} from './timing'

const minute = 60_000
const session: Session = {
  id: 's',
  name: 'Test',
  startedAt: 0,
  format: 'singles',
  courtCount: 1,
  target: 1,
  winBy: 1,
  cap: 1,
  bestOf: 1,
  mode: 'fair',
  playerIds: ['a', 'b'],
  availablePlayerIds: ['a', 'b'],
  status: 'active',
}
const match: Match = {
  id: 'm',
  sessionId: 's',
  court: 1,
  teamA: ['a'],
  teamB: ['b'],
  startedAt: 0,
  status: 'playing',
  actions: [],
  revision: 0,
  timing: { pauses: [] },
}

describe('pause-aware match timing', () => {
  it('excludes persisted pauses and freezes the timer until resume', () => {
    const paused = pauseMatch(match, session, 2 * minute)
    expect(isMatchPaused(paused)).toBe(true)
    expect(matchPlayMinutes(paused, 8 * minute)).toBe(2)
    expect(() => pauseMatch(paused, session, 9 * minute)).toThrow()
    const resumed = resumeMatch(paused, 8 * minute)
    expect(isMatchPaused(resumed)).toBe(false)
    expect(matchPlayMinutes(resumed, 10 * minute)).toBe(4)
    expect(matchPlayIntervals(resumed, 10 * minute)).toEqual([
      [0, 2 * minute],
      [8 * minute, 10 * minute],
    ])
    expect(resumed.revision).toBe(2)
  })
  it('clips an abandoned open pause at its confirmation time', () => {
    const stopped = {
      ...pauseMatch(match, session, 2 * minute),
      status: 'abandoned' as const,
      endedAt: 9 * minute,
    }
    expect(matchPlayMinutes(stopped, 20 * minute)).toBe(2)
    expect(matchElapsedMinutes(stopped, 20 * minute)).toBe(9)
  })
  it('records the winning rally time, clears it on undo and restores original time', () => {
    const won = syncMatchTiming(
      { ...match, actions: [{ id: 'win', kind: 'point', side: 'A', at: 5 * minute }] },
      session,
      5 * minute,
    )
    expect(won.timing?.finishedAt).toBe(5 * minute)
    expect(matchPlayMinutes({ ...won, status: 'completed', endedAt: 20 * minute })).toBe(5)
    const reopened = syncMatchTiming(
      { ...won, actions: [...won.actions, { id: 'undo', kind: 'undo', at: 7 * minute }] },
      session,
      7 * minute,
    )
    expect(reopened.timing?.finishedAt).toBeUndefined()
    // Undo the undo is not redo; a later new winning point sets its own finish.
    const wonAgain = syncMatchTiming(
      {
        ...reopened,
        actions: [...reopened.actions, { id: 'new', kind: 'point', side: 'B', at: 9 * minute }],
      },
      session,
      9 * minute,
    )
    expect(wonAgain.timing?.finishedAt).toBe(9 * minute)
  })
  it('uses original surviving rally time when undoing a score retraction', () => {
    const actions: Match['actions'] = [
      { id: 'win', kind: 'point', side: 'A', at: 5 * minute },
      { id: 'remove', kind: 'remove', side: 'A', targetId: 'win', at: 8 * minute },
      { id: 'undo', kind: 'undo', at: 9 * minute },
    ]
    expect(syncMatchTiming({ ...match, actions }, session, 9 * minute).timing?.finishedAt).toBe(
      5 * minute,
    )
  })
  it('retains actual original finish when accepted results are corrected later', () => {
    const won = buildFinalResult(match, session, [{ a: 1, b: 0 }], 5 * minute)
    const corrected = buildFinalResult(
      { ...won, endedAt: 8 * minute },
      session,
      [{ a: 0, b: 1 }],
      99 * minute,
    )
    expect(corrected.timing?.finishedAt).toBe(5 * minute)
    expect(corrected.endedAt).toBe(8 * minute)
    expect(matchPlayMinutes(corrected)).toBe(5)
    expect(
      adjustMatchScores(won, session, [{ a: 0, b: 0 }], 9 * minute).timing?.finishedAt,
    ).toBeUndefined()
  })
  it('keeps legacy records elapsed without inventing pause tracking', () => {
    const { timing: _unused, ...legacy } = match
    const changed = syncMatchTiming(
      { ...legacy, endedAt: 8 * minute, status: 'completed' },
      session,
      9 * minute,
    )
    expect(changed.timing).toBeUndefined()
    expect(matchPlayMinutes(changed)).toBe(8)
  })
  it('validates timing intervals without dropping timing through backups', () => {
    const data = {
      version: 2,
      players: ['a', 'b'].map((id) => ({ id, name: id, level: 3, createdAt: 0 })),
      sessions: [session],
      matches: [
        { ...match, timing: { pauses: [{ from: minute, to: 2 * minute }, { from: 3 * minute }] } },
      ],
    }
    expect(validateData(data).matches[0].timing).toEqual(data.matches[0].timing)
    const bad = (timing: unknown) => ({ ...data, matches: [{ ...match, timing }] })
    expect(() =>
      validateData(bad({ pauses: [{ from: minute, to: 3 * minute }, { from: 2 * minute }] })),
    ).toThrow('pause')
    expect(() => validateData(bad({ pauses: [{ from: minute }, { from: 2 * minute }] }))).toThrow(
      'pause',
    )
    expect(() =>
      validateData({
        ...data,
        matches: [
          { ...match, endedAt: 2 * minute, timing: { pauses: [], finishedAt: 3 * minute } },
        ],
      }),
    ).toThrow('play end')
  })
})
