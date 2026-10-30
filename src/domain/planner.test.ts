import { describe, expect, it } from 'vitest'
import type { AppData, Match, Session } from './model'
import {
  courtOpportunityBefore,
  buildPlanContext,
  buildPlanPrompt,
  defaultPlannerWeights,
  editPlanSlot,
  generatePlan,
  planSummary,
  replanSession,
  validatePlanAssignments,
} from './planner'

const at = 1_800_000_000_000
const minute = 60_000
function fixture(
  count = 8,
  courts = 1,
  mode: Session['mode'] = 'fair',
): { data: AppData; session: Session } {
  const players = Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i + 1}`,
    level: [1, 5, 2, 4, 3, 4, 2, 3][i % 8],
    createdAt: at,
  }))
  const session: Session = {
    id: 's1',
    name: 'Friends',
    startedAt: at,
    format: 'doubles',
    courtCount: courts,
    target: 21,
    winBy: 2,
    cap: 30,
    bestOf: 1,
    mode,
    playerIds: players.map((p) => p.id),
    availablePlayerIds: players.map((p) => p.id),
    attendance: players.map((p) => ({ playerId: p.id, at, available: true })),
    status: 'active',
    planning: {
      basis: 'matches',
      matchCount: 12,
      durationMinutes: 120,
      matchMinutes: 12,
      changeoverMinutes: 2,
    },
  }
  return { data: { version: 2, players, sessions: [session], matches: [] }, session }
}
function assertNoOverlap(session: Session) {
  const duration = session.planning!.matchMinutes * minute
  const slots = session.plan!.slots
  for (let i = 0; i < slots.length; i++) {
    const a = slots[i]
    expect(new Set([...a.teamA, ...a.teamB]).size).toBe(session.format === 'doubles' ? 4 : 2)
    for (let j = i + 1; j < slots.length; j++) {
      const b = slots[j]
      if (a.startsAt < b.startsAt + duration && b.startsAt < a.startsAt + duration) {
        expect(a.court).not.toBe(b.court)
        expect([...a.teamA, ...a.teamB].some((id) => [...b.teamA, ...b.teamB].includes(id))).toBe(
          false,
        )
      }
    }
  }
}

describe('complete session planning', () => {
  it('excludes tracked pauses and result review from recorded participation minutes', () => {
    const { data, session } = fixture(4)
    data.matches.push({
      id: 'timed',
      sessionId: session.id,
      court: 1,
      teamA: ['p0', 'p1'],
      teamB: ['p2', 'p3'],
      startedAt: at,
      endedAt: at + 20 * minute,
      status: 'completed',
      actions: [],
      revision: 1,
      timing: {
        pauses: [{ from: at + 2 * minute, to: at + 7 * minute }],
        finishedAt: at + 12 * minute,
      },
    })
    expect(planSummary(data, session, at + 30 * minute).map((row) => row.projectedMinutes)).toEqual(
      [7, 7, 7, 7],
    )
  })

  it('explains factual load, rest and repeated partnership evidence before each selection', () => {
    const { data, session } = fixture(4)
    data.players.forEach((player) => {
      player.level = 3
    })
    session.planning!.matchCount = 4
    const plan = generatePlan(data, session, { now: at })
    expect(plan.slots[0].reason).toContain(
      '0 earlier matches per selected player; 0 available rest rounds',
    )
    expect(plan.slots[0].reason).toContain('Estimated team rating gap: 0')
    expect(plan.slots[0].reason).toContain('2 partnerships new in recorded/planned history')
    expect(plan.slots[3].reason).toContain('3 earlier matches per selected player')
    expect(plan.slots[3].reason).toContain('Both partnerships appeared earlier')
    expect(plan.slots.every((slot) => slot.reason.length <= 1000)).toBe(true)
  })

  it('shows how a new plan changes each player’s estimated participation before it is applied', () => {
    const { data, session } = fixture(8)
    const planned = replanSession(data, session, at)
    const original = planSummary(data, planned)
    const shortened = {
      ...planned,
      plan: { ...planned.plan!, slots: planned.plan!.slots.slice(0, 1) },
    }
    const preview = planSummary(data, shortened)
    const chosen = new Set([...shortened.plan.slots[0].teamA, ...shortened.plan.slots[0].teamB])
    for (const row of preview) {
      expect(row.plannedMatches).toBe(chosen.has(row.playerId) ? 1 : 0)
      expect(row.projectedMinutes).toBe(chosen.has(row.playerId) ? 12 : 0)
      expect(row.maxConsecutiveRests).toBe(chosen.has(row.playerId) ? 0 : 1)
    }
    expect(original.every((row) => row.plannedMatches === 6)).toBe(true)
    expect(planned.plan!.slots).toHaveLength(12)
  })

  it('plans total matches, distributes eight players evenly, and spreads rests', () => {
    const { data, session } = fixture()
    const before = structuredClone(data)
    const planned = replanSession(data, session, at)
    expect(planned.plan!.slots).toHaveLength(12)
    assertNoOverlap(planned)
    const summary = planSummary(data, planned)
    expect(summary.map((p) => p.plannedMatches)).toEqual(Array(8).fill(6))
    expect(Math.max(...summary.map((p) => p.maxConsecutiveRests))).toBe(1)
    expect(Math.max(...summary.map((p) => p.maxConsecutivePlays))).toBe(1)
    expect(data).toEqual(before)
  })

  it('fills two courts with twelve players without double-booking or long rests', () => {
    const { data, session } = fixture(12, 2)
    session.planning!.matchCount = 18
    const planned = replanSession(data, session, at)
    expect(planned.plan!.slots).toHaveLength(18)
    assertNoOverlap(planned)
    const rows = planSummary(data, planned)
    expect(
      Math.max(...rows.map((p) => p.plannedMatches)) -
        Math.min(...rows.map((p) => p.plannedMatches)),
    ).toBeLessThanOrEqual(1)
    expect(Math.max(...rows.map((p) => p.maxConsecutiveRests))).toBeLessThanOrEqual(1)
    expect(Math.max(...rows.map((p) => p.maxConsecutivePlays))).toBeLessThanOrEqual(3)
  })

  it('calculates duration capacity including changeovers, not rounds as matches', () => {
    const { data, session } = fixture(8, 2)
    session.planning = {
      ...session.planning!,
      basis: 'duration',
      durationMinutes: 60,
      matchMinutes: 12,
      changeoverMinutes: 3,
    }
    const planned = replanSession(data, session, at)
    expect(planned.plan!.slots).toHaveLength(8)
    expect(
      Math.max(...planned.plan!.slots.map((s) => s.startsAt + 12 * minute)),
    ).toBeLessThanOrEqual(at + 60 * minute)
    assertNoOverlap(planned)
    expect(planned.plan!.warnings.some((w) => w.includes('estimates'))).toBe(true)
  })

  it('excludes players on a break and honors future arrival and early departure windows', () => {
    const { data, session } = fixture(8)
    session.availablePlayerIds = session.availablePlayerIds.filter(
      (id) => id !== 'p7' && id !== 'p6',
    )
    session.availability = { p6: { from: at + 28 * minute }, p0: { until: at + 28 * minute } }
    const plan = generatePlan(data, session, { now: at })
    expect(plan.slots.every((s) => ![...s.teamA, ...s.teamB].includes('p7'))).toBe(true)
    expect(
      plan.slots
        .filter((s) => [...s.teamA, ...s.teamB].includes('p6'))
        .every((s) => s.startsAt >= at + 28 * minute),
    ).toBe(true)
    expect(plan.slots.some((s) => [...s.teamA, ...s.teamB].includes('p6'))).toBe(true)
    expect(
      plan.slots
        .filter((s) => [...s.teamA, ...s.teamB].includes('p0'))
        .every((s) => s.startsAt + 12 * minute <= at + 28 * minute),
    ).toBe(true)
  })

  it('reports impossible plans without fabricating players or matches', () => {
    const { data, session } = fixture(3)
    const plan = generatePlan(data, session, { now: at })
    expect(plan.slots).toHaveLength(0)
    expect(plan.warnings.join(' ')).toContain('Only 0')
    session.planning = {
      ...session.planning!,
      basis: 'duration',
      durationMinutes: 5,
      matchMinutes: 12,
    }
    expect(generatePlan(data, session, { now: at }).warnings.join(' ')).toContain(
      'No complete match',
    )
  })

  it('supports singles without accidental doubles assignments', () => {
    const { data, session } = fixture(6, 2)
    session.format = 'singles'
    const planned = replanSession(data, session, at)
    expect(planned.plan!.slots.every((s) => s.teamA.length === 1 && s.teamB.length === 1)).toBe(
      true,
    )
    assertNoOverlap(planned)
  })

  it('provides genuinely different mode weights and permits transparent custom weighting', () => {
    expect(defaultPlannerWeights('fair').fairness).toBeGreaterThan(
      defaultPlannerWeights('balanced').fairness,
    )
    expect(defaultPlannerWeights('variety').variety).toBeGreaterThan(
      defaultPlannerWeights('balanced').variety,
    )
    const { data, session } = fixture(4)
    session.planning!.weights = {
      fairness: 0,
      rest: 0,
      balance: 0,
      variety: 0,
      partnership: 0,
      contribution: 0,
    }
    expect(
      generatePlan(data, session, { now: at }).warnings.some((w) => w.includes('weights are zero')),
    ).toBe(true)
  })

  it('balances strength before inventing compatibility from tiny samples', () => {
    const { data, session } = fixture(4, 1, 'balanced')
    data.players.forEach((p, i) => {
      p.level = i < 2 ? 5 : 1
    })
    session.planning!.matchCount = 1
    const first = generatePlan(data, session, { now: at }).slots[0]
    const level = (ids: string[]) =>
      ids.reduce((sum, id) => sum + data.players.find((p) => p.id === id)!.level, 0)
    expect(level(first.teamA)).toBe(level(first.teamB))
  })
})

describe('safe replanning and edits', () => {
  it('preserves linked played and active slots, counts them toward target, and keeps busy players off other courts', () => {
    const { data, session } = fixture(8, 2)
    session.plan = generatePlan(data, session, { now: at })
    const slot = session.plan.slots[0]
    const match: Match = {
      id: 'live',
      sessionId: session.id,
      court: slot.court,
      teamA: slot.teamA,
      teamB: slot.teamB,
      startedAt: at,
      status: 'playing',
      actions: [],
      revision: 0,
      planSlotId: slot.id,
    }
    slot.matchId = match.id
    data.matches.push(match)
    const now = at + 5 * minute
    const next = replanSession(data, session, now)
    expect(next.plan!.slots).toHaveLength(12)
    expect(next.plan!.slots.find((s) => s.id === slot.id)).toEqual(slot)
    const busy = [...match.teamA, ...match.teamB]
    expect(
      next
        .plan!.slots.filter((s) => !s.matchId && s.startsAt < at + 12 * minute)
        .every(
          (s) =>
            ![...s.teamA, ...s.teamB].some((id) => busy.includes(id)) && s.court !== match.court,
        ),
    ).toBe(true)
    expect(data.matches).toHaveLength(1)
    expect(match.actions).toHaveLength(0)
  })

  it('remembers actual consecutive games even when everyone has equal total playing time', () => {
    const { data, session } = fixture()
    for (let round = 0; round < 4; round++) {
      const ids = round < 2 ? ['p4', 'p5', 'p6', 'p7'] : ['p0', 'p1', 'p2', 'p3']
      data.matches.push({
        id: `prior-${round}`,
        sessionId: session.id,
        court: 1,
        teamA: ids.slice(0, 2),
        teamB: ids.slice(2),
        startedAt: at + round * 14 * minute,
        endedAt: at + (round * 14 + 12) * minute,
        status: 'abandoned',
        revision: 0,
        actions: [],
      })
    }
    const planned = replanSession(data, session, at + 56 * minute)
    const next = planned.plan!.slots.find((slot) => !slot.matchId)!
    expect(new Set([...next.teamA, ...next.teamB])).toEqual(new Set(['p4', 'p5', 'p6', 'p7']))
  })

  it('does not label players in an overlapping live match as resting', () => {
    const { data, session } = fixture(8, 2)
    session.planning!.matchCount = 2
    data.matches.push({
      id: 'live',
      sessionId: session.id,
      court: 1,
      teamA: ['p0', 'p1'],
      teamB: ['p2', 'p3'],
      startedAt: at,
      status: 'playing',
      revision: 0,
      actions: [],
    })
    const planned = replanSession(data, session, at + 5 * minute)
    expect(planned.plan!.slots.find((s) => !s.matchId)!.startsAt).toBe(at + 5 * minute)
    const summary = planSummary(data, planned)
    expect(summary.find((p) => p.playerId === 'p0')!.restRounds).toBe(0)
    expect(summary.find((p) => p.playerId === 'p0')!.maxConsecutiveRests).toBe(0)
  })

  it('keeps locked matchups stable during regeneration', () => {
    const { data, session } = fixture()
    session.plan = generatePlan(data, session, { now: at })
    session.plan.slots[4].locked = true
    const fixed = structuredClone(session.plan.slots[4])
    const next = replanSession(data, session, at)
    expect(next.plan!.slots.find((s) => s.id === fixed.id)).toEqual(fixed)
    assertNoOverlap(next)
  })

  it('releases an infeasible future lock with a warning when a player takes a break', () => {
    const { data, session } = fixture()
    session.plan = generatePlan(data, session, { now: at })
    const slot = session.plan.slots[0]
    slot.locked = true
    const away = slot.teamA[0]
    session.availablePlayerIds = session.availablePlayerIds.filter((id) => id !== away)
    const next = replanSession(data, session, at)
    expect(next.plan!.slots.every((s) => ![...s.teamA, ...s.teamB].includes(away))).toBe(true)
    expect(next.plan!.warnings.some((w) => w.includes('lock was released'))).toBe(true)
    assertNoOverlap(next)
  })

  it('swaps an equivalent future pairing into an edited first match and avoids duplicate intended encounters', () => {
    const { data, session } = fixture()
    session.plan = generatePlan(data, session, { now: at })
    const first = session.plan.slots[0]
    const future = session.plan.slots.find((s) => s.round === 2)!
    const edited = editPlanSlot(data, session, first.id, future.teamB, future.teamA, at)
    const selected = edited.plan!.slots.find((s) => s.id === first.id)!
    expect(selected.teamA).toEqual(future.teamB)
    expect(selected.teamB).toEqual(future.teamA)
    expect(selected.locked).toBe(true)
    const moved = edited.plan!.slots.find((s) => s.id === future.id)!
    expect(new Set([...moved.teamA, ...moved.teamB])).toEqual(
      new Set([...first.teamA, ...first.teamB]),
    )
    assertNoOverlap(edited)
  })

  it('rejects editing recorded matches or assigning unavailable players', () => {
    const { data, session } = fixture()
    session.plan = generatePlan(data, session, { now: at })
    const slot = session.plan.slots[0]
    slot.matchId = 'already-played'
    expect(() => editPlanSlot(data, session, slot.id, ['p0', 'p1'], ['p2', 'p3'], at)).toThrow(
      'unplayed',
    )
    delete slot.matchId
    session.availablePlayerIds = session.availablePlayerIds.filter((p) => p !== 'p0')
    expect(() => editPlanSlot(data, session, slot.id, ['p0', 'p1'], ['p2', 'p3'], at)).toThrow(
      'unavailable',
    )
  })
})

describe('external pairing exchange', () => {
  it('exports useful context and a prompt with stable IDs and no invented results', () => {
    const { data, session } = fixture()
    session.plan = generatePlan(data, session, { now: at })
    const context = buildPlanContext(data, session)
    expect(context.players).toHaveLength(8)
    expect(context.slots).toHaveLength(12)
    expect(context.expectedOutput.planRevision).toBe(session.plan.revision)
    expect(buildPlanPrompt(data, session)).toContain('Return only the expectedOutput JSON')
    expect(data.matches).toHaveLength(0)
  })

  it('accepts a complete validated plan but rejects stale, incomplete, duplicate and overlapping assignments', () => {
    const { data, session } = fixture(8, 2)
    session.plan = generatePlan(data, session, { now: at })
    const valid = buildPlanContext(data, session).expectedOutput
    expect(validatePlanAssignments(data, session, valid).revision).toBe(session.plan.revision + 1)
    expect(() => validatePlanAssignments(data, session, { ...valid, planRevision: 0 })).toThrow(
      'older plan revision',
    )
    expect(() =>
      validatePlanAssignments(data, session, { ...valid, assignments: valid.assignments.slice(1) }),
    ).toThrow('every unplayed')
    expect(() =>
      validatePlanAssignments(data, session, {
        ...valid,
        assignments: valid.assignments.map((a, i) => (i === 1 ? valid.assignments[0] : a)),
      }),
    ).toThrow('duplicate')
    expect(() =>
      validatePlanAssignments(data, session, {
        ...valid,
        assignments: valid.assignments.map((a, i) =>
          i === 1
            ? { ...a, teamA: valid.assignments[0].teamA, teamB: valid.assignments[0].teamB }
            : a,
        ),
      }),
    ).toThrow('overlapping')
  })

  it('protects locked pairings, player IDs, and exact team sizes on import', () => {
    const { data, session } = fixture()
    session.plan = generatePlan(data, session, { now: at })
    session.plan.slots[0].locked = true
    const valid = buildPlanContext(data, session).expectedOutput
    const changed = structuredClone(valid)
    changed.assignments[0].teamA = ['p6', 'p7']
    expect(() => validatePlanAssignments(data, session, changed)).toThrow('locked')
    session.plan.slots[0].locked = false
    changed.assignments[0].teamA = ['unknown', 'p1']
    expect(() => validatePlanAssignments(data, session, changed)).toThrow(
      'distinct session players',
    )
  })
})

describe('historical court opportunity', () => {
  it('integrates roster changes without creating late-arrival debt', () => {
    const { session } = fixture()
    session.attendance = session.playerIds.map((playerId, i) => ({
      playerId,
      at: at + (i >= 4 ? 30 * minute : 0),
      available: true,
    }))
    const opportunity = courtOpportunityBefore(session, at + 60 * minute)
    expect([...opportunity.values()]).toEqual([45, 45, 45, 45, 15, 15, 15, 15])
  })
  it('stops allocating opportunity during breaks and after departures', () => {
    const { session } = fixture()
    session.attendance!.push(
      ...session.playerIds
        .slice(4)
        .map((playerId) => ({ playerId, at: at + 30 * minute, available: false })),
    )
    expect([...courtOpportunityBefore(session, at + 60 * minute).values()]).toEqual([
      45, 45, 45, 45, 15, 15, 15, 15,
    ])
  })
})
