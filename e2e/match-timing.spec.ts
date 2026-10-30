import { expect, test, type Page } from '@playwright/test'
import type { AppData } from '../src/domain/model'
import { readSavedData, seedRealDemo } from './helpers'

function timedCourt(now: number): AppData {
  const startedAt = now - 2 * 60_000
  return {
    version: 2,
    players: ['Alice', 'Ben'].map((name) => ({
      id: name.toLowerCase(),
      name,
      level: 3,
      createdAt: startedAt,
    })),
    sessions: [
      {
        id: 'timed-session',
        name: 'Timed badminton',
        startedAt,
        format: 'singles',
        courtCount: 1,
        target: 1,
        winBy: 1,
        cap: 1,
        bestOf: 1,
        mode: 'fair',
        playerIds: ['alice', 'ben'],
        availablePlayerIds: ['alice', 'ben'],
        status: 'active',
      },
    ],
    matches: [
      {
        id: 'timed-match',
        sessionId: 'timed-session',
        court: 1,
        teamA: ['alice'],
        teamB: ['ben'],
        startedAt,
        status: 'playing',
        actions: [],
        revision: 0,
        timing: { pauses: [] },
      },
    ],
  }
}

async function open(page: Page) {
  await page.getByRole('button', { name: 'Open scoreboard', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

test('paused matches stay frozen after reload and resume without losing scores', async ({
  page,
}) => {
  const now = Date.now()
  await page.clock.install({ time: new Date(now - 1000) })
  await page.clock.pauseAt(new Date(now))
  await seedRealDemo(page, timedCourt(now))
  await open(page)
  await expect(page.locator('.match-clock-time strong')).toHaveText('2:00')
  await page.getByRole('button', { name: 'Pause match', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Point to side A', exact: true })).toBeDisabled()
  await expect(page.getByRole('spinbutton', { name: /^Side A score/ })).toBeDisabled()
  await expect
    .poll(async () => (await readSavedData(page)).matches[0].timing?.pauses.length)
    .toBe(1)
  await page.clock.fastForward(120_000)
  await expect(page.locator('.match-clock-time strong')).toHaveText('2:00')
  await page.reload()
  await open(page)
  await expect(page.getByRole('button', { name: 'Resume match', exact: true })).toBeEnabled()
  await expect(page.locator('.match-clock-time strong')).toHaveText('2:00')
  await page.getByRole('button', { name: 'Resume match', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Point to side A', exact: true })).toBeEnabled()
  await page.clock.fastForward(30_000)
  await expect(page.locator('.match-clock-time strong')).toHaveText('2:30')
  const saved = await readSavedData(page)
  expect(saved.matches[0].timing?.pauses[0].to).toBe(now + 120_000)
  expect(saved.matches[0].actions).toHaveLength(0)
})

test('result review keeps play time frozen while confirmation remains auditable', async ({
  page,
}) => {
  const now = Date.now()
  await page.clock.install({ time: new Date(now - 1000) })
  await page.clock.pauseAt(new Date(now))
  await seedRealDemo(page, timedCourt(now))
  await open(page)
  await page.getByRole('button', { name: 'Point to side A', exact: true }).click()
  await expect(page.locator('.match-clock-time')).toContainText('Play ended')
  await expect.poll(async () => (await readSavedData(page)).matches[0].timing?.finishedAt).toBe(now)
  await page.clock.fastForward(10 * 60_000)
  await expect(page.locator('.match-clock-time strong')).toHaveText('2:00')
  await page.getByRole('button', { name: 'Confirm result', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(async () => (await readSavedData(page)).matches[0].status).toBe('completed')
  const saved = (await readSavedData(page)).matches[0]
  expect(saved.timing?.finishedAt).toBe(now)
  expect(saved.endedAt).toBe(now + 10 * 60_000)
  // Restore normal timers for React's lazy-route/Suspense scheduling.
  await page.clock.resume()
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByRole('button', { name: /Timed badminton/ }).click()
  await expect(page.locator('.history-match-score')).toContainText('2 min play')
})

test('a paused match can stop while preserving its recorded pause', async ({ page }) => {
  const now = Date.now()
  await page.clock.install({ time: new Date(now - 1000) })
  await page.clock.pauseAt(new Date(now))
  await seedRealDemo(page, timedCourt(now))
  await open(page)
  await page.getByRole('button', { name: 'Pause match', exact: true }).click()
  await page.clock.fastForward(120_000)
  await page.getByRole('button', { name: 'Stop match', exact: true }).click()
  await page.getByRole('button', { name: 'Stop match', exact: true }).last().click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(async () => (await readSavedData(page)).matches[0].status).toBe('abandoned')
  const saved = (await readSavedData(page)).matches[0]
  expect(saved.endedAt).toBe(now + 120_000)
  expect(saved.timing?.pauses).toEqual([{ from: now }])
  expect(saved.actions).toHaveLength(0)
})
