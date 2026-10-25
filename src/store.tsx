import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { initialData, type AppData } from './domain/model'
import {
  emptySync,
  journalState,
  loadState,
  saveState,
  validateData,
  type SavedState,
  type SyncConfig,
} from './lib/storage'
import { pullSheet, pushSheet, validateSheetEndpoint } from './lib/sheets'

interface RallyContext {
  data: AppData
  ready: boolean
  readOnly: boolean
  persistStatus: 'saved' | 'saving' | 'error'
  storageError: string | null
  commit: (updater: (data: AppData) => AppData) => void
  notify: (message: string) => void
  toast: string | null
  sync: SyncConfig
  syncBusy: boolean
  syncError: string | null
  configureSync: (endpoint: string, role: 'organizer' | 'viewer') => void
  syncNow: () => Promise<void>
  resolveSync: (choice: 'pull' | 'push') => Promise<void>
}
const Context = createContext<RallyContext | null>(null)

export function RallyProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<SavedState>({
    id: 'main',
    data: initialData(),
    sync: emptySync(),
  })
  const [ready, setReady] = useState(false)
  const [locked, setLocked] = useState(false)
  const [storageBlocked, setStorageBlocked] = useState(false)
  const [persistStatus, setPersistStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const [storageError, setStorageError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const ref = useRef(saved)
  const busy = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const saveQueue = useRef(Promise.resolve())
  const readOnly =
    locked || storageBlocked || Boolean(saved.sync.endpoint && saved.sync.role === 'viewer')

  const notify = useCallback((message: string) => {
    setToast(message)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), 4500)
  }, [])
  const replace = useCallback((next: SavedState) => {
    const stamped = {
      ...next,
      saveId: crypto.randomUUID(),
      generation: (ref.current.generation ?? 0) + 1,
    }
    try {
      journalState(stamped)
    } catch {
      setStorageError(
        'Recovery storage is full or unavailable. Wait for the local save indicator and download a backup before closing.',
      )
    }
    ref.current = stamped
    setSaved(stamped)
  }, [])

  useEffect(() => {
    let active = true
    loadState()
      .then((state) => {
        if (active) {
          if (state) {
            ref.current = state
            setSaved(state)
          }
          setReady(true)
        }
      })
      .catch(() => {
        if (active) {
          setStorageError(
            'Your saved data could not be opened. Do not clear browser data. Reopen the app, or restore an exported backup in another browser.',
          )
          setPersistStatus('error')
          setReady(true)
          setStorageBlocked(true)
        }
      })
    return () => {
      active = false
    }
  }, [replace])

  useEffect(() => {
    if (!navigator.locks) return
    let release: (() => void) | undefined
    let active = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const acquire = (retried = false) => {
      void navigator.locks
        .request('rallysync-editor', { ifAvailable: true }, async (lock) => {
          if (!active) return
          if (!lock) {
            setLocked(true)
            // React development StrictMode can release the previous effect's lock
            // just after this request. Retry once, without stealing another tab's lock.
            if (!retried) retryTimer = setTimeout(() => acquire(true), 75)
            return
          }
          setLocked(false)
          await new Promise<void>((resolve) => {
            release = resolve
          })
        })
        .catch(() => {
          if (active) setLocked(true)
        })
    }
    acquire()
    return () => {
      active = false
      clearTimeout(retryTimer)
      release?.()
    }
  }, [])

  useEffect(() => {
    if (!ready || locked || storageBlocked) return
    let active = true
    setPersistStatus('saving')
    saveQueue.current = saveQueue.current
      .catch(() => {})
      .then(() => saveState(saved))
      .then(() => {
        if (active) {
          setPersistStatus('saved')
          setStorageError(null)
        }
      })
      .catch(() => {
        if (active) {
          setPersistStatus('error')
          setStorageError(
            'Changes are in memory but could not be saved on this device. Download a backup now.',
          )
        }
      })
    return () => {
      active = false
    }
  }, [saved, ready, locked, storageBlocked])

  const commit = useCallback(
    (updater: (data: AppData) => AppData) => {
      if (!ready || readOnly) {
        notify('This is a read-only view. Use the organizer device to make changes.')
        return
      }
      const current = ref.current
      const data = updater(current.data)
      if (data === current.data) return
      replace({
        ...current,
        data,
        sync: { ...current.sync, dirty: true, mutationId: crypto.randomUUID() },
      })
    },
    [ready, readOnly, notify, replace],
  )

  const configureSync = useCallback(
    (endpoint: string, role: 'organizer' | 'viewer') => {
      if (locked || storageBlocked) return
      const normalized = endpoint ? validateSheetEndpoint(endpoint) : ''
      const current = ref.current
      const hasHistory = Boolean(
        current.data.players.length || current.data.sessions.length || current.data.matches.length,
      )
      const sameEndpoint = Boolean(normalized && normalized === current.sync.endpoint)
      replace({
        ...current,
        sync: sameEndpoint
          ? { ...current.sync, role }
          : {
              ...emptySync(),
              endpoint: normalized,
              role,
              dirty: Boolean(normalized && role === 'organizer' && hasHistory),
              mutationId:
                normalized && role === 'organizer' && hasHistory ? crypto.randomUUID() : null,
            },
      })
      setSyncError(null)
    },
    [locked, storageBlocked, replace],
  )

  const performSync = useCallback(
    async (resolution?: 'pull' | 'push') => {
      if (
        busy.current ||
        locked ||
        storageBlocked ||
        !ready ||
        !ref.current.sync.endpoint ||
        !navigator.onLine
      )
        return
      busy.current = true
      setSyncBusy(true)
      const captured = ref.current
      try {
        const remote = await pullSheet(captured.sync.endpoint)
        if (ref.current.sync.endpoint !== captured.sync.endpoint) return
        const current = ref.current
        if (resolution === 'pull' || current.sync.role === 'viewer') {
          if (remote.data) {
            replace({
              ...current,
              data: validateData(remote.data),
              sync: {
                ...current.sync,
                revision: remote.revision,
                lastSyncAt: Date.now(),
                dirty: false,
                mutationId: null,
              },
            })
          } else
            throw new Error('The shared sheet is empty. An organizer must upload a session first.')
        } else if (current.sync.dirty || resolution === 'push') {
          // Acknowledgement may have been lost after a successful upload.
          if (remote.mutationId && remote.mutationId === current.sync.mutationId) {
            replace({
              ...current,
              sync: {
                ...current.sync,
                revision: remote.revision,
                lastSyncAt: Date.now(),
                dirty: false,
              },
            })
          } else {
            if (resolution !== 'push' && remote.revision !== current.sync.revision)
              throw new Error(
                'Both this device and the sheet have changes. Choose which copy to keep in Settings; neither was overwritten.',
              )
            const mutationId = current.sync.mutationId || crypto.randomUUID()
            const result = await pushSheet(
              current.sync.endpoint,
              current.data,
              remote.revision,
              mutationId,
            )
            const latest = ref.current
            if (latest.sync.endpoint !== current.sync.endpoint) return
            const unchanged = latest.data === current.data
            replace({
              ...latest,
              sync: {
                ...latest.sync,
                revision: result.revision,
                lastSyncAt: Date.now(),
                dirty: !unchanged,
                mutationId: unchanged ? mutationId : latest.sync.mutationId,
              },
            })
          }
        } else if (remote.revision !== current.sync.revision && remote.data) {
          replace({
            ...current,
            data: validateData(remote.data),
            sync: {
              ...current.sync,
              revision: remote.revision,
              lastSyncAt: Date.now(),
              dirty: false,
            },
          })
        } else replace({ ...current, sync: { ...current.sync, lastSyncAt: Date.now() } })
        setSyncError(null)
      } catch (error) {
        setSyncError(
          error instanceof Error
            ? error.message
            : 'Could not sync. Your local data is still available.',
        )
      } finally {
        busy.current = false
        setSyncBusy(false)
      }
    },
    [locked, storageBlocked, ready, replace],
  )

  useEffect(() => {
    if (!ready || !saved.sync.endpoint) return
    // No background sync assumption: retry while open and on reconnect.
    const tick = () => {
      if (!document.hidden) void performSync()
    }
    const interval = setInterval(tick, 15000)
    const pending = setTimeout(tick, 2500)
    window.addEventListener('online', tick)
    return () => {
      clearInterval(interval)
      clearTimeout(pending)
      window.removeEventListener('online', tick)
    }
  }, [ready, saved.sync.endpoint, performSync])

  return (
    <Context.Provider
      value={{
        data: saved.data,
        ready,
        readOnly,
        persistStatus,
        storageError,
        commit,
        notify,
        toast,
        sync: saved.sync,
        syncBusy,
        syncError,
        configureSync,
        syncNow: () => performSync(),
        resolveSync: (choice) => performSync(choice),
      }}
    >
      {children}
    </Context.Provider>
  )
}

export function useRally() {
  const value = useContext(Context)
  if (!value) throw new Error('useRally must be used inside RallyProvider')
  return value
}
