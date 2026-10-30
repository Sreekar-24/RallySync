import { expect, test, type Locator, type Page } from '@playwright/test'
import type { AppData } from '../src/domain/model'
import { readSavedData, seedRealDemo } from './helpers'

function activeCourt(format: 'singles' | 'doubles' = 'doubles'): AppData {
  const now = Date.now() - 60_000
  const players = ['Alice', 'Anaya', 'Ben', 'Brooke'].map((name) => ({
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
        id: 'service-session',
        name: 'Service regression',
        startedAt: now,
        format,
        courtCount: 1,
        target: 21,
        winBy: 2,
        cap: 30,
        bestOf: 1,
        mode: 'balanced',
        scoringMode: 'combined',
        playerIds: players.map((player) => player.id),
        availablePlayerIds: players.map((player) => player.id),
        status: 'active',
      },
    ],
    matches: [
      {
        id: 'service-match',
        sessionId: 'service-session',
        court: 1,
        teamA: format === 'doubles' ? ['alice', 'anaya'] : ['alice'],
        teamB: format === 'doubles' ? ['ben', 'brooke'] : ['ben'],
        startedAt: now,
        status: 'playing',
        actions: [],
        revision: 0,
      },
    ],
  }
}

async function openCourt(page: Page, format: 'singles' | 'doubles' = 'doubles') {
  await seedRealDemo(page, activeCourt(format))
  await page.getByRole('button', { name: 'Open scoreboard', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

function player(page: Page, name: string) {
  return page.locator(`.service-player[title="${name}"]`)
}

async function startTracking(page: Page, name = 'Alice') {
  await player(page, name).click()
  await page.getByRole('button', { name: 'Start tracking', exact: true }).click()
  await expect(player(page, name)).toHaveClass(/is-serving/)
}

async function scores(page: Page, a: string, b: string) {
  await expect(page.getByRole('spinbutton', { name: /^Side A score/ })).toHaveValue(a)
  await expect(page.getByRole('spinbutton', { name: /^Side B score/ })).toHaveValue(b)
}

async function ownCourt(token: Locator, side: 'right' | 'left') {
  await expect(token).toHaveAttribute('aria-label', new RegExp(`${side} court$`))
}

test('replays doubles serve order and side minus without moving the receiving partners', async ({
  page,
}) => {
  await openCourt(page)
  await startTracking(page)
  const alice = player(page, 'Alice')
  const anaya = player(page, 'Anaya')
  const ben = player(page, 'Ben')
  const brooke = player(page, 'Brooke')
  const benStart = await ben.getAttribute('style')
  const brookeStart = await brooke.getAttribute('style')
  const addA = page.getByRole('button', { name: 'Point to side A', exact: true })
  const addB = page.getByRole('button', { name: 'Point to side B', exact: true })

  await addA.click()
  await expect(alice).toHaveClass(/is-serving/)
  await ownCourt(alice, 'left')
  expect(await ben.getAttribute('style')).toBe(benStart)
  expect(await brooke.getAttribute('style')).toBe(brookeStart)
  const aliceAfter = await alice.getAttribute('style')
  const anayaAfter = await anaya.getAttribute('style')

  await addB.click()
  await expect(brooke).toHaveClass(/is-serving/)
  await ownCourt(brooke, 'left')
  expect(await ben.getAttribute('style')).toBe(benStart)
  expect(await brooke.getAttribute('style')).toBe(brookeStart)
  expect(await alice.getAttribute('style')).toBe(aliceAfter)
  expect(await anaya.getAttribute('style')).toBe(anayaAfter)

  await addB.click()
  await expect(brooke).toHaveClass(/is-serving/)
  await ownCourt(brooke, 'right')
  expect(await alice.getAttribute('style')).toBe(aliceAfter)
  expect(await anaya.getAttribute('style')).toBe(anayaAfter)
  await addA.click()
  await expect(anaya).toHaveClass(/is-serving/)
  await ownCourt(anaya, 'right')
  await scores(page, '2', '2')

  await page.getByRole('button', { name: 'Remove point from side B', exact: true }).click()
  await scores(page, '2', '1')
  await expect(anaya).toHaveClass(/is-serving/)
  await ownCourt(brooke, 'left')
  await page.getByRole('button', { name: 'Undo last action', exact: true }).click()
  await scores(page, '2', '2')
  await ownCourt(brooke, 'right')

  await page.getByRole('button', { name: 'Remove point from side A', exact: true }).click()
  await scores(page, '1', '2')
  await expect(brooke).toHaveClass(/is-serving/)
  await page.getByRole('button', { name: 'Undo last action', exact: true }).click()
  await scores(page, '2', '2')
  await expect(anaya).toHaveClass(/is-serving/)

  await page.getByRole('button', { name: 'Point to Alice', exact: true }).click()
  await scores(page, '3', '2')
  await expect(
    page.locator('.score-side-a .individual-point').first().locator('strong'),
  ).toHaveText('1')
  await page.getByRole('button', { name: 'Remove point from Alice', exact: true }).click()
  await scores(page, '2', '2')
  await expect(
    page.locator('.score-side-a .individual-point').first().locator('strong'),
  ).toHaveText('0')
  await expect(anaya).toHaveClass(/is-serving/)
})

test('flags typed totals for a position check and lets the organizer realign the court', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openCourt(page)
  await startTracking(page)
  await page.getByRole('button', { name: 'Point to side A', exact: true }).click()
  const positionBeforeEdit = await player(page, 'Alice').boundingBox()
  await page.getByRole('spinbutton', { name: /^Side A score/ }).fill('4')
  await page.getByRole('spinbutton', { name: /^Side B score/ }).fill('2')
  const positionWhileDisabled = await player(page, 'Alice').boundingBox()
  expect(positionWhileDisabled?.x).toBeCloseTo(positionBeforeEdit!.x, 0)
  expect(positionWhileDisabled?.y).toBeCloseTo(positionBeforeEdit!.y, 0)
  await expect(page.getByRole('button', { name: 'Point to side A', exact: true })).toBeDisabled()
  await expect(
    page.getByRole('button', { name: 'Remove point from side A', exact: true }),
  ).toBeDisabled()
  await page.getByRole('button', { name: 'Apply score', exact: true }).click()
  await expect(page.locator('.service-status')).toHaveText('Check positions')
  await expect(page.locator('.service-player.is-serving')).toHaveCount(0)

  await page.getByRole('button', { name: 'Reset positions', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Point to side B', exact: true })).toBeDisabled()
  await player(page, 'Ben').click()
  await page.getByRole('button', { name: 'Swap side A positions', exact: true }).click()
  await page.getByRole('button', { name: 'Flip view', exact: true }).click()
  await page.getByRole('button', { name: 'Save positions', exact: true }).click()
  await scores(page, '4', '2')
  await expect(player(page, 'Ben')).toHaveClass(/is-serving/)
  await expect(player(page, 'Ben')).toHaveAttribute('style', /top: 75%/)
  await ownCourt(player(page, 'Anaya'), 'right')
  await page.getByRole('button', { name: 'Point to side B', exact: true }).click()
  await scores(page, '4', '3')
  await expect(player(page, 'Ben')).toHaveClass(/is-serving/)
  await ownCourt(player(page, 'Ben'), 'left')
})

test('persists a real court checkpoint and point retraction across reloads', async ({ page }) => {
  await openCourt(page)
  await startTracking(page)
  await page.getByRole('button', { name: 'Point to side A', exact: true }).click()
  await page.getByRole('button', { name: 'Point to side B', exact: true }).click()
  await page.getByRole('button', { name: 'Remove point from side A', exact: true }).click()
  await scores(page, '0', '1')
  await expect(player(page, 'Brooke')).toHaveClass(/is-serving/)
  await expect
    .poll(async () => (await readSavedData(page)).matches[0].actions.at(-1)?.kind)
    .toBe('remove')
  const saved = await readSavedData(page)
  expect(saved.matches[0].serviceSetup?.servingSide).toBe('A')
  expect(saved.matches[0].serviceSetup?.positions).toEqual({
    A: ['alice', 'anaya'],
    B: ['ben', 'brooke'],
  })
  await page.reload()
  await page.getByRole('button', { name: 'Open scoreboard', exact: true }).click()
  await scores(page, '0', '1')
  await expect(player(page, 'Brooke')).toHaveClass(/is-serving/)
  await ownCourt(player(page, 'Brooke'), 'left')
  await page.getByRole('button', { name: 'Undo last action', exact: true }).click()
  await scores(page, '1', '1')
  await expect(player(page, 'Brooke')).toHaveClass(/is-serving/)
  await ownCourt(player(page, 'Alice'), 'left')
})

test('keeps setup and score correction touch targets usable at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openCourt(page)
  await player(page, 'Alice').click()
  const dialog = page.getByRole('dialog')
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  for (const control of [
    player(page, 'Alice'),
    player(page, 'Brooke'),
    page.getByRole('button', { name: 'Swap side A positions', exact: true }),
    page.getByRole('button', { name: 'Flip view', exact: true }),
    page.getByRole('button', { name: 'Start tracking', exact: true }),
  ]) {
    const bounds = await control.boundingBox()
    expect(bounds?.height).toBeGreaterThanOrEqual(44)
    expect(bounds?.width).toBeGreaterThanOrEqual(44)
  }
  await page.getByRole('button', { name: 'Start tracking', exact: true }).click()
  const add = page.getByRole('button', { name: 'Point to side A', exact: true })
  await add.click()
  const minus = page.getByRole('button', { name: 'Remove point from side A', exact: true })
  const bounds = await minus.boundingBox()
  expect(bounds?.height).toBeGreaterThanOrEqual(44)
  expect(bounds?.width).toBeGreaterThanOrEqual(44)
  await minus.click()
  await scores(page, '0', '0')
  await expect(minus).toBeDisabled()
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.getByLabel('Doubles point entry mode').selectOption('individual')
  await expect(add).toHaveText('Team')
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('requires an explicit choice before lower typed totals clear player credits', async ({
  page,
}) => {
  await openCourt(page)
  await page.getByRole('button', { name: 'Point to Alice', exact: true }).click()
  await page.getByRole('button', { name: 'Point to Alice', exact: true }).click()
  await page.getByRole('button', { name: 'Point to Ben', exact: true }).click()
  await scores(page, '2', '1')
  await page.getByRole('spinbutton', { name: /^Side A score/ }).fill('1')
  await page.getByRole('button', { name: 'Apply score', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('credits exceed')
  await expect(
    page.locator('.score-side-a .individual-point').first().locator('strong'),
  ).toHaveText('2')
  await page
    .getByRole('button', {
      name: 'Apply totals with this game’s player credits unassigned',
      exact: true,
    })
    .click()
  await scores(page, '1', '1')
  await expect(
    page.locator('.score-side-a .individual-point').first().locator('strong'),
  ).toHaveText('0')
  await expect(
    page.locator('.score-side-b .individual-point').first().locator('strong'),
  ).toHaveText('0')
  await page.getByRole('button', { name: 'Remove point from side A', exact: true }).click()
  await scores(page, '0', '1')
  await page.getByRole('button', { name: 'Undo last action', exact: true }).click()
  await scores(page, '1', '1')
  await page.getByRole('button', { name: 'Undo last action', exact: true }).click()
  await scores(page, '2', '1')
  await expect(
    page.locator('.score-side-a .individual-point').first().locator('strong'),
  ).toHaveText('2')
  await expect(
    page.locator('.score-side-b .individual-point').first().locator('strong'),
  ).toHaveText('1')
})

test('places singles receivers diagonally by the serving score even when their own score differs', async ({
  page,
}) => {
  await openCourt(page, 'singles')
  await startTracking(page)
  await page.getByRole('button', { name: 'Point to side A', exact: true }).click()
  await scores(page, '1', '0')
  await ownCourt(player(page, 'Alice'), 'left')
  await ownCourt(player(page, 'Ben'), 'left')
  await expect(player(page, 'Alice')).toHaveAttribute('style', /left: 27%/)
  await expect(player(page, 'Ben')).toHaveAttribute('style', /left: 73%/)
  await expect(player(page, 'Ben')).toHaveClass(/is-receiving/)
  await page.getByRole('button', { name: 'Remove point from side A', exact: true }).click()
  await scores(page, '0', '0')
  await ownCourt(player(page, 'Alice'), 'right')
  await ownCourt(player(page, 'Ben'), 'right')
})

test('allows a new partner to serve next game while retaining the previous winning side', async ({
  page,
}) => {
  const data = activeCourt()
  data.sessions[0] = { ...data.sessions[0], bestOf: 3, target: 1, cap: 1, winBy: 1 }
  await seedRealDemo(page, data)
  await page.getByRole('button', { name: 'Open scoreboard', exact: true }).click()
  await startTracking(page)
  await page.getByRole('button', { name: 'Point to side A', exact: true }).click()
  await scores(page, '0', '0')
  await expect(page.locator('.service-player.is-serving')).toHaveCount(0)
  await player(page, 'Ben').click()
  await expect(page.getByRole('alert')).toContainText('Side A won the last game and serves first')
  await player(page, 'Anaya').click()
  await page.getByRole('button', { name: 'Save positions', exact: true }).click()
  await expect(player(page, 'Anaya')).toHaveClass(/is-serving/)
  await ownCourt(player(page, 'Anaya'), 'right')
  await expect(player(page, 'Anaya')).toHaveAttribute('style', /top: 25%/)
  await page.getByRole('button', { name: 'Point to side B', exact: true }).click()
  await scores(page, '0', '0')
  await expect(page.locator('.service-player.is-serving')).toHaveCount(0)
  await player(page, 'Brooke').click()
  await page.getByRole('button', { name: 'Save positions', exact: true }).click()
  await expect(player(page, 'Brooke')).toHaveClass(/is-serving/)
  await ownCourt(player(page, 'Brooke'), 'right')
  await expect(player(page, 'Brooke')).toHaveAttribute('style', /top: 25%/)
})
