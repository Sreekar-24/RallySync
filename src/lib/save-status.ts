import type { SyncConfig } from './storage'

/** A durable local save is the prerequisite for every reassuring status. */
export function saveStatus({
  isDemo,
  online,
  persistStatus,
  storageError,
  sync,
  syncBusy,
  syncError,
}: {
  isDemo: boolean
  online: boolean
  persistStatus: 'saved' | 'saving' | 'error'
  storageError: string | null
  sync: SyncConfig
  syncBusy: boolean
  syncError: string | null
}) {
  if (isDemo) return 'Demo · not saved'
  if (persistStatus === 'error' || storageError) return 'Backup needed'
  if (persistStatus === 'saving') return online ? 'Saving on device…' : 'Offline · saving…'
  if (!online) return 'Offline · saved locally'
  if (syncBusy) return 'Syncing…'
  if (syncError) return 'Sync needs attention'
  if (sync.endpoint) {
    if (!sync.lastSyncAt) return 'Connection not checked'
    return sync.dirty ? 'Changes waiting to sync' : 'All changes synced'
  }
  return 'Saved on this device'
}
