import { expect, test } from '@playwright/test'
import { createDemo } from '../src/lib/demo'
import { readSavedData, seedRealDemo } from './helpers'

function personalSession() {
  const data = createDemo()
  const session = data.sessions[0]
  const now = Date.now()
  session.planning = {
    basis: 'matches',
    matchCount: 2,
    durationMinutes: 60,
    matchMinutes: 12,
    changeoverMinutes: 2,
  }
  session.plan = {
    revision: 1,
    generatedAt: now,
    warnings: [],
    slots: [
      {
        id: 'personal-live-slot',
        court: 1,
        round: 1,
        startsAt: now - 60_000,
        teamA: ['demo-player-0', 'demo-player-1'],
        teamB: ['demo-player-4', 'demo-player-5'],
        locked: false,
        matchId: 'personal-live',
        reason: 'Balanced teams',
      },
      {
        id: 'personal-next-slot',
        court: 1,
        round: 2,
        startsAt: now + 15 * 60_000,
        teamA: ['demo-player-0', 'demo-player-2'],
        teamB: ['demo-player-1', 'demo-player-3'],
        locked: false,
        reason: 'Different partners',
      },
    ],
  }
  data.matches.push({
    id: 'personal-live',
    sessionId: session.id,
    court: 1,
    teamA: ['demo-player-0', 'demo-player-1'],
    teamB: ['demo-player-4', 'demo-player-5'],
    startedAt: now - 60_000,
    status: 'playing',
    revision: 0,
    actions: [],
    planSlotId: 'personal-live-slot',
  })
  return data
}

test('personal court check follows live play, remembers the player, and leaves shared data alone', async ({
  page,
}) => {
  await seedRealDemo(page, personalSession())
  const before = await readSavedData(page)
  const panel = page.getByRole('region', { name: 'What’s next for you?' })
  await panel
    .getByRole('combobox', { name: 'Choose your name for next match' })
    .selectOption('demo-player-0')
  await expect(panel).toContainText('Playing · Court 1')
  await expect(panel).toContainText('Next · Court 1')
  await expect(panel).toContainText('With Jamie Chen')
  await expect(panel).toContainText('Against Priya Shah & Sam Rivera')
  await expect(panel).toContainText('After games in progress')
  await panel.getByRole('button', { name: 'Open your scoreboard' }).click()
  await expect(page.getByRole('dialog')).toContainText('Court 1 · Scoreboard')
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  expect(await readSavedData(page)).toEqual(before)
  await page.reload()
  await expect(panel.getByRole('combobox')).toHaveValue('demo-player-0')
  await expect(panel).toContainText('Playing · Court 1')
  await panel.getByRole('combobox').selectOption('demo-player-6')
  await expect(panel).toContainText('Resting now')
  await expect(panel).toContainText('No eligible upcoming match')
  expect(await readSavedData(page)).toEqual(before)
})

test('personal court check fits a narrow screen with a labelled touch-sized selector', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 780 })
  await seedRealDemo(page, personalSession())
  const panel = page.getByRole('region', { name: 'What’s next for you?' })
  const select = panel.getByRole('combobox', { name: 'Choose your name for next match' })
  await select.selectOption('demo-player-2')
  await expect(panel).toContainText('Resting now')
  await expect(panel).toContainText('Next · Court 1')
  expect((await select.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})
