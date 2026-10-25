import { describe, expect, it, vi } from 'vitest'
import type { AppData, Match, Session } from '../domain/model'
import {
  buildReport,
  csvCell,
  escapeHTML,
  printReport,
  reportFileName,
  reportToCSV,
  reportToHTML,
  reportToJSON,
} from './reports'

const at = Date.UTC(2026, 0, 10, 10)
const minute = 60000

function fixture(): AppData {
  const ids = ['a', 'b', 'c', 'd', 'e']
  const session = (id: string, format: 'singles' | 'doubles', startedAt: number): Session => ({
    id,
    name: id === 'doubles' ? 'Friday friends' : 'Singles afternoon',
    startedAt,
    endedAt: startedAt + 30 * minute,
    format,
    courtCount: 1,
    target: 3,
    winBy: 2,
    cap: 5,
    bestOf: 1,
    mode: 'fair',
    playerIds: format === 'doubles' ? ids.slice(0, 4) : ['a', 'e'],
    availablePlayerIds: format === 'doubles' ? ids.slice(0, 4) : ['a', 'e'],
    status: 'completed',
  })
  const match = (
    id: string,
    sessionId: string,
    teamA: string[],
    teamB: string[],
    startedAt: number,
    status: Match['status'] = 'completed',
  ): Match => ({
    id,
    sessionId,
    court: 1,
    teamA,
    teamB,
    startedAt,
    endedAt: status === 'playing' ? undefined : startedAt + 5 * minute,
    status,
    revision: 4,
    actions: [
      { id: `${id}-1`, kind: 'point', side: 'A', playerId: teamA[0], at: startedAt },
      { id: `${id}-2`, kind: 'point', side: 'B', at: startedAt + 1 },
      { id: `${id}-3`, kind: 'point', side: 'A', at: startedAt + 2 },
      { id: `${id}-4`, kind: 'point', side: 'A', at: startedAt + 3 },
    ],
  })
  return {
    version: 2,
    players: ids.map((id) => ({
      id,
      name: id === 'a' ? 'Anaya' : id === 'e' ? 'Elsewhere only' : `Player ${id}`,
      level: 3,
      createdAt: at,
    })),
    sessions: [
      session('doubles', 'doubles', at),
      session('singles', 'singles', at + 24 * 60 * minute),
    ],
    matches: [
      match('d1', 'doubles', ['a', 'b'], ['c', 'd'], at),
      match('s1', 'singles', ['a'], ['e'], at + 24 * 60 * minute),
    ],
  }
}

describe('scoped analysis reports', () => {
  it('exports one session with linked participants and rules, without unrelated history or credentials', () => {
    const data = fixture()
    const report = buildReport(data, { sessionId: 'doubles', generatedAt: at + 30 * minute })
    expect(report.reportType).toBe('session')
    expect(report.scope.label).toBe('Friday friends')
    expect(report.matches.map((m) => m.id)).toEqual(['d1'])
    expect(report.sessions.map((s) => s.id)).toEqual(['doubles'])
    expect(report.players.map((p) => p.id).sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(report.standings).toHaveLength(4)
    expect(report.sessions[0].scoringRules).toEqual({ target: 3, winBy: 2, cap: 5, bestOf: 1 })
    expect(reportToJSON(report)).not.toContain('Elsewhere only')
    expect(reportToJSON(report)).not.toContain('endpoint')
    expect(data.matches).toHaveLength(2)
  })

  it('uses the same format and exclusive date boundaries as the visible analytics', () => {
    const data = fixture()
    const report = buildReport(data, {
      filters: { format: 'doubles', from: at, to: at + 24 * 60 * minute },
      scopeLabel: 'Selected doubles',
      generatedAt: at + 30 * minute,
    })
    expect(report.matches.map((m) => m.id)).toEqual(['d1'])
    expect(report.standings).toHaveLength(4)
    expect(report.scope.label).toBe('Selected doubles')
    const excluded = buildReport(data, {
      filters: { to: data.matches[0].endedAt },
      generatedAt: at + 30 * minute,
    })
    expect(excluded.matches).toHaveLength(0)
    expect(excluded.standings).toHaveLength(0)
    expect(excluded.scope.timeBoundary).toBe('from-inclusive-to-exclusive')
  })

  it('distinguishes a session leaderboard from a session-results report', () => {
    const data = fixture()
    const standings = buildReport(data, { filters: { sessionId: 'doubles' }, generatedAt: at })
    const results = buildReport(data, { sessionId: 'doubles', generatedAt: at })
    expect(standings.reportType).toBe('leaderboard')
    expect(reportToCSV(standings)).toContain('"Player","Player ID","Played"')
    expect(results.reportType).toBe('session')
    expect(reportToCSV(results)).toContain('Game scores A–B')
    expect(standings.matches.map((match) => match.id)).toEqual(
      results.matches.map((match) => match.id),
    )
  })

  it('filters selected standings while retaining the partners and opponents needed to explain results', () => {
    const report = buildReport(fixture(), {
      filters: { sessionId: 'doubles', playerIds: ['a'] },
      generatedAt: at + 30 * minute,
    })
    expect(report.standings.map((p) => p.playerId)).toEqual(['a'])
    expect(report.matches).toHaveLength(1)
    expect(report.players.map((p) => p.id).sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(report.opponents.every((pair) => pair.playerIds.includes('a'))).toBe(true)
  })

  it('keeps stopped and active matches in session exports without declaring them accepted wins', () => {
    const data = fixture()
    data.sessions[0].status = 'active'
    data.sessions[0].endedAt = undefined
    data.matches.push(
      { ...data.matches[0], id: 'stopped', status: 'abandoned' },
      { ...data.matches[0], id: 'active', status: 'playing', endedAt: undefined },
    )
    const report = buildReport(data, { sessionId: 'doubles', generatedAt: at + 10 * minute })
    expect(report.matches).toHaveLength(3)
    expect(report.summary.completedMatches).toBe(1)
    expect(report.summary.stoppedMatches).toBe(1)
    expect(report.summary.activeMatches).toBe(1)
    expect(report.matches.find((m) => m.id === 'active')?.winner).toBeNull()
    expect(report.matches.find((m) => m.id === 'stopped')?.winner).toBeNull()
    expect(report.matches.find((m) => m.id === 'active')?.elapsedMinutes).toBe(10)
    expect(report.standings.find((p) => p.playerId === 'a')?.wins).toBe(1)
  })

  it('distinguishes credited, unassigned points, and unknown individual contribution', () => {
    const report = buildReport(fixture(), { sessionId: 'doubles', generatedAt: at + 30 * minute })
    expect(report.matches[0].creditedPoints.a).toBe(1)
    expect(report.matches[0].unassignedPoints).toEqual({ a: 2, b: 1 })
    expect(report.matches[0].attributionCoverage).toBe(0.25)
    expect(report.standings.find((p) => p.playerId === 'b')?.creditedPoints).toBeNull()
    expect(report.definitions.points).toContain('unassigned is not zero')
  })

  it('marks score-adjusted or synthetic results unsuitable for observed rally-sequence analysis', () => {
    const data = fixture()
    data.matches[0].actions[0].synthetic = true
    expect(buildReport(data, { sessionId: 'doubles' }).matches[0].observedRallyOrder).toBe(false)
  })

  it('requires explicit observed-point provenance rather than trusting legacy synthetic sequences', () => {
    const data = fixture()
    expect(buildReport(data, { sessionId: 'doubles' }).matches[0].observedRallyOrder).toBe(false)
    data.matches[0].actions.forEach((action) => {
      if (action.kind === 'point') action.synthetic = false
    })
    expect(buildReport(data, { sessionId: 'doubles' }).matches[0].observedRallyOrder).toBe(true)
    data.matches[0].actions = []
    expect(buildReport(data, { sessionId: 'doubles' }).matches[0].observedRallyOrder).toBe(false)
  })

  it('produces valid machine-readable JSON with explicit analysis report identity', () => {
    const report = buildReport(fixture(), { sessionId: 'doubles', generatedAt: at })
    const parsed = JSON.parse(reportToJSON(report))
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.application).toBe('RallySync')
    expect(parsed.reportType).toBe('session')
    expect(parsed.definitions.report).toContain('not an application backup')
    expect(parsed.generatedAt).toBe(new Date(at).toISOString())
  })

  it('preserves selected ranking order and documents its tie-breaks', () => {
    const data = fixture()
    data.players.find((player) => player.id === 'c')!.level = 5
    const report = buildReport(data, { sessionId: 'doubles', rankBy: 'rating', generatedAt: at })
    expect(report.standings[0].playerId).toBe('c')
    expect(report.ranking.by).toBe('rating')
    expect(report.ranking.description).toContain('Provisional strength rating')
    expect(reportToHTML(report)).toContain('Provisional strength rating')
    const credited = buildReport(data, { sessionId: 'doubles', rankBy: 'credit', generatedAt: at })
    expect(credited.standings[0].playerId).toBe('a')
    expect(credited.ranking.description).toContain('unknown last')
  })
})

describe('spreadsheet and printable exports', () => {
  it('quotes delimiters and neutralizes formula prefixes, including after whitespace', () => {
    expect(csvCell('hello,"world"')).toBe('"hello,""world"""')
    for (const value of ['=HYPERLINK("bad")', '+cmd', '-cmd', '@SUM(A1)', ' \n=cmd'])
      expect(csvCell(value)).toBe(`"'${value.replace(/"/g, '""')}"`)
    expect(csvCell(-5)).toBe('"-5"')
    expect(csvCell(null)).toBe('""')
  })

  it('exports session match records separately from leaderboard rows and preserves scope', () => {
    const data = fixture()
    data.players[0].name = '=IMPORTXML("bad")'
    const sessionCSV = reportToCSV(buildReport(data, { sessionId: 'doubles', generatedAt: at }))
    expect(sessionCSV).toContain('Game scores A–B')
    expect(sessionCSV).toContain("'=IMPORTXML")
    expect(sessionCSV).not.toContain('Elsewhere only')
    const leaderboardCSV = reportToCSV(
      buildReport(data, { filters: { format: 'singles' }, generatedAt: at }),
    )
    expect(leaderboardCSV).toContain('Performance index')
    expect(leaderboardCSV).toContain('Elsewhere only')
    expect(leaderboardCSV.startsWith('\uFEFF')).toBe(true)
  })

  it('escapes all untrusted content in the printable report rather than executing markup', () => {
    const data = fixture()
    data.players[0].name = '<img src=x onerror="alert(1)">'
    data.sessions[0].name = '</title><script>alert(1)</script>'
    const report = buildReport(data, { sessionId: 'doubles', generatedAt: at })
    const html = reportToHTML(report)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
    expect(html).toContain('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('Save as PDF')
    expect(html).toContain('Partnerships')
    expect(html).toContain('Participation')
    expect(escapeHTML('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;')
  })

  it('uses safe filenames and handles a blocked print window without pretending it worked', () => {
    const report = buildReport(fixture(), { scopeLabel: '../../Club / Finals?', generatedAt: at })
    expect(reportFileName(report, 'json')).toBe('rallysync-club-finals-2026-01-10.json')
    vi.stubGlobal('window', { open: () => null })
    try {
      expect(printReport(report)).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('opens an isolated print window, writes the escaped report, and requests printing after layout', () => {
    vi.useFakeTimers()
    const popup = {
      opener: {},
      document: { open: vi.fn(), write: vi.fn(), close: vi.fn() },
      focus: vi.fn(),
      print: vi.fn(),
      setTimeout,
    }
    const open = vi.fn(() => popup)
    vi.stubGlobal('window', { open })
    try {
      const report = buildReport(fixture(), { sessionId: 'doubles', generatedAt: at })
      expect(printReport(report)).toBe(true)
      expect(open).toHaveBeenCalledWith('', '_blank', 'width=1100,height=800')
      expect(popup.opener).toBeNull()
      expect(popup.document.write).toHaveBeenCalledWith(reportToHTML(report))
      expect(popup.print).not.toHaveBeenCalled()
      vi.runAllTimers()
      expect(popup.print).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})
