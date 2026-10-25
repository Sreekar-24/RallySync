import { expect, test, type Page } from '@playwright/test'
import { createDemo } from '../src/lib/demo'
import type { AppData } from '../src/domain/model'
import { readSavedData, seedRealDemo } from './helpers'

test.setTimeout(45000)

function realHistory(): AppData {
  const sample = createDemo()
  const ids = new Map(sample.players.map((player, index) => [player.id, `real-player-${index}`]))
  const current = {
    ...sample.sessions[0],
    id: 'real-current',
    name: 'Friday clubhouse',
    playerIds: sample.sessions[0].playerIds.map((id) => ids.get(id)!),
    availablePlayerIds: sample.sessions[0].availablePlayerIds.map((id) => ids.get(id)!),
  }
  const currentMatch = {
    ...sample.matches[0],
    id: 'real-finished',
    sessionId: current.id,
    teamA: sample.matches[0].teamA.map((id) => ids.get(id)!),
    teamB: sample.matches[0].teamB.map((id) => ids.get(id)!),
  }
  const previous = {
    ...current,
    id: 'real-history',
    name: 'Earlier session',
    status: 'completed' as const,
    startedAt: current.startedAt - 86400000,
    endedAt: current.startedAt - 80000000,
  }
  const previousMatch = {
    ...currentMatch,
    id: 'real-earlier-result',
    sessionId: previous.id,
    startedAt: currentMatch.startedAt - 86400000,
    endedAt: currentMatch.endedAt! - 86400000,
    actions: currentMatch.actions.map((action) => ({ ...action, at: action.at - 86400000 })),
  }
  return {
    version: 2,
    players: sample.players.map((player) => ({
      ...player,
      id: ids.get(player.id)!,
      name: `Real ${player.name}`,
    })),
    sessions: [current, previous],
    matches: [currentMatch, previousMatch],
  }
}

async function enterDemo(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Explore a demo', exact: true }).click()
  await expect(page.locator('.demo-banner')).toContainText('Demo sandbox')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
}

async function changeDemoScore(page: Page) {
  await page.getByRole('button', { name: 'Start match', exact: true }).first().click()
  await page.getByRole('button', { name: 'Point to side A', exact: true }).click()
  await expect(page.getByLabel('Side A score 1', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
}

test('demo edits remain in memory and exiting restores real history exactly', async ({ page }) => {
  const original = await seedRealDemo(page, realHistory())
  await enterDemo(page)
  await changeDemoScore(page)
  expect(await readSavedData(page)).toEqual(original)
  await page.getByRole('button', { name: 'Exit demo', exact: true }).click()
  await expect(page.locator('.demo-banner')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Friday clubhouse', exact: true })).toBeVisible()
  expect(await readSavedData(page)).toEqual(original)
  await page.getByRole('button', { name: 'Players', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Real Alex Morgan', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Alex Morgan', exact: true })).toHaveCount(0)
})

test('reloading an active demo leaves its edits behind and reopens real history', async ({
  page,
}) => {
  const original = await seedRealDemo(page, realHistory())
  await enterDemo(page)
  await changeDemoScore(page)
  await page.reload()
  await expect(page.locator('.demo-banner')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Friday clubhouse', exact: true })).toBeVisible()
  expect(await readSavedData(page)).toEqual(original)
})

test('demo scoring never uploads to an attached shared sheet', async ({ page }) => {
  const original = realHistory()
  let writes = 0
  await page.route('https://script.google.com/macros/s/demo-isolation/exec*', async (route) => {
    if (route.request().method() === 'POST') writes++
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true, data: original, revision: 5, updatedAt: Date.now() }),
    })
  })
  await seedRealDemo(page, original, {
    endpoint: 'https://script.google.com/macros/s/demo-isolation/exec',
    role: 'organizer',
    revision: 5,
    lastSyncAt: Date.now(),
    dirty: false,
    mutationId: null,
  })
  await page.clock.install()
  await enterDemo(page)
  await changeDemoScore(page)
  await page.clock.fastForward(20000)
  expect(writes).toBe(0)
  expect(await readSavedData(page)).toEqual(original)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'You’re in the practice clubhouse.', exact: true }),
  ).toBeVisible()
  await expect(page.getByLabel('Apps Script web-app URL', { exact: true })).toHaveCount(0)
})

test('legacy sample cleanup previews its scope and preserves real and renamed profiles', async ({
  page,
}) => {
  const real = realHistory()
  const legacy = createDemo()
  legacy.players[0].name = 'Renamed real player'
  legacy.sessions[0] = { ...legacy.sessions[0], status: 'completed', endedAt: Date.now() }
  const mixed: AppData = {
    version: 2,
    players: [...real.players, ...legacy.players],
    sessions: [...real.sessions, ...legacy.sessions],
    matches: [...real.matches, ...legacy.matches],
  }
  await seedRealDemo(page, mixed)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Review cleanup', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('1 sample session, 1 matches recorded in it, and 7 unused')
  await dialog.getByRole('button', { name: 'Keep data', exact: true }).click()
  expect(await readSavedData(page)).toEqual(mixed)
  await page.getByRole('button', { name: 'Review cleanup', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Remove sample data', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Saved on this device', exact: true }),
  ).toBeVisible()
  const result = await readSavedData(page)
  expect(result.sessions).toEqual(real.sessions)
  expect(result.matches).toEqual(real.matches)
  expect(result.players).toEqual([...real.players, legacy.players[0]])
})

test('deleting a current session removes only its own matches and keeps player profiles', async ({
  page,
}) => {
  const original = await seedRealDemo(page, realHistory())
  await page
    .getByRole('button', { name: 'Session options for Friday clubhouse', exact: true })
    .click()
  await page.getByRole('button', { name: 'Delete session', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('This removes 1 match')
  await dialog.getByRole('button', { name: 'Delete session', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'The court is calling.', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Saved on this device', exact: true }),
  ).toBeVisible()
  const result = await readSavedData(page)
  expect(result.players).toEqual(original.players)
  expect(result.sessions.map((session) => session.id)).toEqual(['real-history'])
  expect(result.matches.map((match) => match.id)).toEqual(['real-earlier-result'])
})

test('deleting historical results leaves the current session and its results intact', async ({
  page,
}) => {
  const original = await seedRealDemo(page, realHistory())
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByRole('button', { name: /Earlier session/ }).click()
  await page
    .getByRole('button', { name: 'Session options for Earlier session', exact: true })
    .click()
  await page.getByRole('button', { name: 'Delete session', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete session', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Saved on this device', exact: true }),
  ).toBeVisible()
  const result = await readSavedData(page)
  expect(result.players).toEqual(original.players)
  expect(result.sessions.map((session) => session.id)).toEqual(['real-current'])
  expect(result.matches.map((match) => match.id)).toEqual(['real-finished'])
})
