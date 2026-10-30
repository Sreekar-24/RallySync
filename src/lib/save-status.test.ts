import { describe, expect, it } from 'vitest'
import { emptySync } from './storage'
import { saveStatus } from './save-status'

const state = {
  isDemo: false,
  online: true,
  persistStatus: 'saved' as const,
  storageError: null,
  sync: emptySync(),
  syncBusy: false,
  syncError: null,
}
describe('save status trust', () => {
  it('prioritizes save failures over offline and syncing states', () => {
    expect(saveStatus({ ...state, online: false, persistStatus: 'error' })).toBe('Backup needed')
    expect(saveStatus({ ...state, syncBusy: true, storageError: 'Quota' })).toBe('Backup needed')
  })
  it('does not claim a pending write is saved offline or synced', () => {
    expect(saveStatus({ ...state, online: false, persistStatus: 'saving' })).toBe(
      'Offline · saving…',
    )
    expect(
      saveStatus({
        ...state,
        persistStatus: 'saving',
        sync: { ...emptySync(), endpoint: 'test', lastSyncAt: 1 },
      }),
    ).toBe('Saving on device…')
    expect(saveStatus({ ...state, online: false })).toBe('Offline · saved locally')
  })
  it('keeps the demo separate from real storage failures', () => {
    expect(saveStatus({ ...state, isDemo: true, persistStatus: 'error' })).toBe('Demo · not saved')
  })
})
