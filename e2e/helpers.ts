import { expect, type Page } from '@playwright/test'
import { createDemo } from '../src/lib/demo'
import type { AppData } from '../src/domain/model'
import type { SyncConfig } from '../src/lib/storage'

const localSync = (): SyncConfig => ({
  endpoint: '',
  role: 'organizer',
  revision: 0,
  lastSyncAt: null,
  dirty: false,
  mutationId: null,
})

/** Seed deterministic REAL persisted history, independently of the demo sandbox. */
export async function seedRealDemo(
  page: Page,
  input?: AppData,
  sync = localSync(),
): Promise<AppData> {
  await page.goto('./')
  await expect(page.locator('main h1')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Saved on this device', exact: true }),
  ).toBeVisible()
  let data = input
  if (!data) {
    const builtAt = Date.now()
    const sample = createDemo()
    const browserNow = await page.evaluate(() => Date.now())
    const offset = browserNow - builtAt
    data = {
      ...sample,
      version: 2,
      players: sample.players.map((player) => ({
        ...player,
        createdAt: player.createdAt + offset,
      })),
      sessions: sample.sessions.map((session) => ({
        ...session,
        startedAt: session.startedAt + offset,
        endedAt: session.endedAt === undefined ? undefined : session.endedAt + offset,
      })),
      matches: sample.matches.map((match) => ({
        ...match,
        startedAt: match.startedAt + offset,
        endedAt: match.endedAt === undefined ? undefined : match.endedAt + offset,
        actions: match.actions.map((action) => ({ ...action, at: action.at + offset })),
      })),
    }
  }
  const normalized: AppData = { ...data, version: 2 }
  await page.evaluate(
    async ({ data, sync }) => {
      localStorage.removeItem('rallysync-pending-save')
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('rallysync')
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('snapshots'))
            request.result.createObjectStore('snapshots', { keyPath: 'id' })
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('snapshots', 'readwrite')
        transaction
          .objectStore('snapshots')
          .put({ id: 'main', data, sync, saveId: 'browser-fixture', generation: 1 })
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
      database.close()
    },
    { data: normalized, sync },
  )
  await page.reload()
  await expect(page.locator('main h1')).toBeVisible()
  return normalized
}

/** Inspect durable history, not the current in-memory demo view. */
export async function readSavedData(page: Page): Promise<AppData> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('rallysync')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<AppData>((resolve, reject) => {
        const request = database
          .transaction('snapshots', 'readonly')
          .objectStore('snapshots')
          .get('main')
        request.onsuccess = () => resolve(request.result.data)
        request.onerror = () => reject(request.error)
      })
    } finally {
      database.close()
    }
  })
}
