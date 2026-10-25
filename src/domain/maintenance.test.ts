import { describe, expect, it } from 'vitest'
import { createDemo } from '../lib/demo'
import { deleteSession, legacyDemoCleanup } from './maintenance'

describe('scoped history deletion', () => {
  it('deletes only selected session results while preserving identities and other sessions', () => {
    const data = createDemo()
    data.sessions.push({ ...data.sessions[0], id: 'real', status: 'completed' })
    data.matches.push({ ...data.matches[0], id: 'real-match', sessionId: 'real' })
    const next = deleteSession(data, 'demo-session')
    expect(next.sessions.map((s) => s.id)).toEqual(['real'])
    expect(next.matches.map((m) => m.id)).toEqual(['real-match'])
    expect(next.players).toEqual(data.players)
    expect(data.sessions).toHaveLength(2)
  })
  it('removes old sample history without deleting renamed or reused profiles', () => {
    const data = createDemo()
    data.players[0].name = 'My real friend'
    data.sessions.push({
      ...data.sessions[0],
      id: 'real',
      status: 'completed',
      playerIds: ['demo-player-1'],
      availablePlayerIds: ['demo-player-1'],
    })
    const result = legacyDemoCleanup(data)
    expect(result.sessions).toBe(1)
    expect(result.matches).toBe(1)
    expect(result.players).toBe(6)
    expect(result.data.players.map((p) => p.id)).toEqual(['demo-player-0', 'demo-player-1'])
    expect(result.data.sessions.map((s) => s.id)).toEqual(['real'])
  })
})
