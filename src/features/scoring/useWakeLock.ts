import { useEffect, useRef, useState } from 'react'

/** Screen locks are optional, visible-page only, and never block scoring. */
export function useWakeLock(active: boolean) {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator
  const [enabled, setEnabled] = useState(false)
  const [status, setStatus] = useState<'off' | 'requesting' | 'on' | 'unavailable'>('off')
  const [retry, setRetry] = useState(0)
  const wanted = useRef(false)
  wanted.current = enabled && active
  useEffect(() => {
    if (!enabled || !active || !supported) {
      setStatus('off')
      return
    }
    let disposed = false
    let lock: WakeLockSentinel | undefined
    let requesting = false
    const release = () => {
      const previous = lock
      lock = undefined
      if (previous && !previous.released) void previous.release().catch(() => {})
    }
    const acquire = async () => {
      if (
        disposed ||
        !wanted.current ||
        document.visibilityState !== 'visible' ||
        requesting ||
        lock
      )
        return
      requesting = true
      setStatus('requesting')
      try {
        const next = await navigator.wakeLock.request('screen')
        if (disposed || !wanted.current || document.visibilityState !== 'visible') {
          await next.release()
          return
        }
        lock = next
        setStatus('on')
        next.addEventListener('release', () => {
          if (lock === next) {
            lock = undefined
            if (!disposed) setStatus('unavailable')
          }
        })
      } catch {
        if (!disposed) setStatus('unavailable')
      } finally {
        requesting = false
      }
    }
    const visibility = () => {
      if (document.visibilityState === 'visible') void acquire()
      else {
        release()
        setStatus('off')
      }
    }
    void acquire()
    document.addEventListener('visibilitychange', visibility)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', visibility)
      release()
    }
  }, [enabled, active, supported, retry])
  return {
    supported,
    enabled,
    status,
    toggle: () => {
      if (enabled && status === 'unavailable') setRetry((value) => value + 1)
      else setEnabled((value) => !value)
    },
    disable: () => setEnabled(false),
  }
}
