import { expect, test, type Page } from '@playwright/test'
import type { AppData } from '../src/domain/model'
import { readSavedData, seedRealDemo } from './helpers'

function courtData(): AppData {
  const now = Date.now() - 60_000
  const players = ['Alice', 'Anaya', 'Ben', 'Brooke', 'Cara', 'Chad', 'Dee', 'Dan'].map((name) => ({
    id: name.toLowerCase(),
    name,
    level: 3,
    createdAt: now - 86_400_000,
  }))
  return {
    version: 2,
    players,
    sessions: [
      {
        id: 'scoring-session',
        name: 'Scoring usability',
        startedAt: now,
        format: 'doubles',
        courtCount: 2,
        target: 21,
        winBy: 2,
        cap: 30,
        bestOf: 1,
        mode: 'balanced',
        scoringMode: 'team',
        playerIds: players.map((p) => p.id),
        availablePlayerIds: players.map((p) => p.id),
        status: 'active',
      },
    ],
    matches: [0, 1].map((index) => ({
      id: `scoring-match-${index}`,
      sessionId: 'scoring-session',
      court: index + 1,
      teamA: players.slice(index * 4, index * 4 + 2).map((p) => p.id),
      teamB: players.slice(index * 4 + 2, index * 4 + 4).map((p) => p.id),
      startedAt: now,
      status: 'playing',
      actions: [],
      revision: 0,
    })),
  }
}
async function open(page: Page, court = 0) {
  await page.getByRole('button', { name: 'Open scoreboard', exact: true }).nth(court).click()
}

test('protects typed totals on close and applies only after an explicit choice', async ({
  page,
}) => {
  await seedRealDemo(page, courtData())
  await open(page)
  await page.getByRole('spinbutton', { name: /^Side A score/ }).fill('7')
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  const guard = page.getByRole('alertdialog', { name: 'Unapplied changes' })
  await expect(guard).toBeVisible()
  await guard.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: /^Side A score/ })).toHaveValue('7')
  expect((await readSavedData(page)).matches[0].actions).toHaveLength(0)
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await guard.getByRole('button', { name: 'Apply & continue', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await open(page)
  await expect(page.getByRole('spinbutton', { name: /^Side A score/ })).toHaveValue('7')
  await page.getByRole('spinbutton', { name: /^Side A score/ }).fill('9')
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await guard.getByRole('button', { name: 'Discard & continue', exact: true }).click()
  await open(page)
  await expect(page.getByRole('spinbutton', { name: /^Side A score/ })).toHaveValue('7')
})

test('protects allocation edits and service setup when navigating to rules', async ({ page }) => {
  await seedRealDemo(page, courtData())
  await open(page)
  await page.getByRole('button', { name: 'Edit all scores', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Game 1 side A', exact: true }).fill('4')
  await page.getByRole('button', { name: 'Close score editor', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: 'Game 1 side A', exact: true })).toHaveValue(
    '4',
  )
  await page.getByRole('button', { name: 'Quick rules', exact: true }).click()
  await page.getByRole('button', { name: 'Apply & continue', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await open(page)
  await expect(page.getByRole('spinbutton', { name: /^Side A score/ })).toHaveValue('4')
  await page.getByRole('button', { name: 'Set first serve', exact: true }).click()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toContainText('court positions')
  await page.getByRole('button', { name: 'Apply & continue', exact: true }).click()
  await open(page)
  await expect(page.locator('.service-player.is-serving')).toHaveCount(1)
})

test('keeps point-entry preferences local to a match and focus mode leaves scoring accessible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await seedRealDemo(page, courtData())
  await open(page)
  await page.getByLabel('Doubles point entry mode').selectOption('individual')
  await page.getByRole('button', { name: 'Point to Alice', exact: true }).click()
  await page.getByRole('button', { name: 'Remove point from Alice', exact: true }).click()
  await page.getByRole('button', { name: 'Undo last action', exact: true }).click()
  const recent = page.getByRole('list', { name: 'Recent scoring actions', exact: true })
  await expect(recent).toContainText('Side A +1 · Alice')
  await expect(recent).toContainText('Side A −1 · Alice')
  await expect(recent).toContainText('Undo previous action')
  await page.locator('.service-player[title="Alice"]').click()
  await page.getByRole('button', { name: 'Start tracking', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Focus scoring', exact: true }).click()
  await page.getByRole('dialog').evaluate((element) => {
    element.scrollTop = 0
  })
  await expect(page.getByRole('button', { name: 'Point to Alice', exact: true })).toBeHidden()
  for (const control of [
    page.getByRole('button', { name: 'Point to side A', exact: true }),
    page.getByRole('button', { name: 'Remove point from side A', exact: true }),
    page.getByRole('button', { name: 'Undo last action', exact: true }),
  ]) {
    const bounds = await control.boundingBox()
    expect(bounds?.height).toBeGreaterThanOrEqual(44)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844)
  }

  await expect(page.getByLabel('Doubles point entry mode')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Edit all scores', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Point to side A', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Undo last action', exact: true })).toBeVisible()
  expect(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  )
  await page.getByRole('button', { name: 'More scoring tools', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Point to Alice', exact: true })).toBeVisible()
  await expect(page.getByLabel('Doubles point entry mode')).toHaveValue('individual')
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await open(page, 1)
  await expect(page.getByLabel('Doubles point entry mode')).toHaveValue('team')
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.reload()
  await open(page)
  await expect(page.getByLabel('Doubles point entry mode')).toHaveValue('individual')
  await page.getByRole('button', { name: 'Use as session default', exact: true }).click()
  await expect
    .poll(async () => (await readSavedData(page)).sessions[0].scoringMode)
    .toBe('individual')
})

test('releases the optional screen lock while hidden or closed and reacquires when visible', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = { requested: 0, released: 0, visible: true }
    Object.assign(window, { screenLockTest: state })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (state.visible ? 'visible' : 'hidden'),
    })
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          state.requested += 1
          const sentinel = Object.assign(new EventTarget(), {
            released: false,
            release: async () => {
              if (!sentinel.released) {
                sentinel.released = true
                state.released += 1
                sentinel.dispatchEvent(new Event('release'))
              }
            },
          })
          return sentinel
        },
      },
    })
  })
  await seedRealDemo(page, courtData())
  await open(page)
  await page.getByRole('button', { name: 'Keep screen awake', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Screen stays awake', exact: true })).toBeVisible()
  await page.evaluate(() => {
    const state = (window as unknown as { screenLockTest: { visible: boolean } }).screenLockTest
    state.visible = false
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { screenLockTest: { released: number } }).screenLockTest.released,
      ),
    )
    .toBe(1)
  await page.evaluate(() => {
    const state = (window as unknown as { screenLockTest: { visible: boolean } }).screenLockTest
    state.visible = true
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { screenLockTest: { requested: number } }).screenLockTest.requested,
      ),
    )
    .toBe(2)
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { screenLockTest: { released: number } }).screenLockTest.released,
      ),
    )
    .toBe(2)
})
