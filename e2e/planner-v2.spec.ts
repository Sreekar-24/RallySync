import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { createDemo } from '../src/lib/demo'
import { readSavedData, seedRealDemo } from './helpers'

async function startPlannedSession(page: Page, basis: 'matches' | 'duration' = 'matches') {
  await seedRealDemo(page, { version: 2, players: createDemo().players, sessions: [], matches: [] })
  await page.getByRole('button', { name: 'New session', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Session name').fill('Planned evening')
  await dialog.getByRole('button', { name: /^Fair/ }).click()
  if (basis === 'matches') await dialog.getByLabel('Total matches').fill('6')
  else {
    await dialog.getByRole('button', { name: /Time budget/ }).click()
    await dialog.getByLabel('Session length (hours)').fill('1')
  }
  await dialog.getByRole('button', { name: 'Let’s play', exact: true }).click()
  await expect(page.locator('.schedule-match')).toHaveCount(basis === 'matches' ? 6 : 4)
}

test('publishes a complete count-based session plan and retains it after reload', async ({
  page,
}) => {
  await startPlannedSession(page)
  await expect(page.getByRole('button', { name: /Full schedule/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByText('See the playing-time picture', { exact: true }).click()
  await expect(page.locator('.schedule-table-scroll tbody tr')).toHaveCount(8)
  for (const row of await page.locator('.schedule-table-scroll tbody tr').all())
    await expect(row.locator('td').nth(1)).toHaveText('3')
  await expect(
    page.getByRole('button', { name: 'Saved on this device', exact: true }),
  ).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: /Full schedule/ }).click()
  await expect(page.locator('.schedule-match')).toHaveCount(6)
  await page.getByRole('button', { name: 'Start match', exact: true }).first().click()
  await page.getByRole('button', { name: 'Point to side A', exact: true }).click()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(page.locator('.schedule-match.is-playing')).toHaveCount(1)
  await expect(
    page.getByRole('button', { name: 'Saved on this device', exact: true }),
  ).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: /Full schedule/ }).click()
  await page.getByRole('button', { name: 'Open scoreboard', exact: true }).click()
  await expect(page.getByLabel('Side A score 1', { exact: true })).toBeVisible()
})

test('estimates a whole time-budget plan instead of treating hours as match counts', async ({
  page,
}) => {
  await startPlannedSession(page, 'duration')
  await expect(page.locator('.session-schedule')).toContainText('Times are estimates')
  const data = await readSavedData(page)
  expect(data.sessions[0].planning?.durationMinutes).toBe(60)
  expect(data.sessions[0].plan?.slots).toHaveLength(4)
})

test('locks a lineup and repairs future matches when a player takes a break', async ({ page }) => {
  await startPlannedSession(page)
  await page.getByRole('button', { name: 'Lock round 2 court 1', exact: true }).click()
  const before = await readSavedData(page)
  const locked = before.sessions[0].plan!.slots.find((s) => s.round === 2)!
  const absent = before.sessions[0].playerIds.find(
    (id) => ![...locked.teamA, ...locked.teamB].includes(id),
  )!
  const name = before.players.find((p) => p.id === absent)!.name
  await page.getByRole('button', { name: 'Manage players', exact: true }).click()
  await page
    .getByRole('dialog')
    .locator('.attendance-row')
    .filter({ hasText: name })
    .getByRole('button', { name: 'Break', exact: true })
    .click()
  await page.getByRole('button', { name: 'All set', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Saved on this device', exact: true }),
  ).toBeVisible()
  const after = await readSavedData(page)
  const slots = after.sessions[0].plan!.slots
  expect(slots.every((s) => ![...s.teamA, ...s.teamB].includes(absent))).toBe(true)
  const retained = slots.find((s) => s.id === locked.id)!
  expect(retained.locked).toBe(true)
  expect(retained.teamA).toEqual(locked.teamA)
  expect(retained.teamB).toEqual(locked.teamB)
})

test('previews LLM schedules, rejects stale imports, and leaves results untouched', async ({
  page,
}) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Explore a demo', exact: true }).click()
  await page.getByRole('button', { name: /Full schedule/ }).click()
  await page.locator('.schedule-llm summary').click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download context JSON', exact: true }).click()
  const context = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'))
  expect(context.players).toHaveLength(8)
  expect(context.expectedOutput.assignments.length).toBeGreaterThan(0)
  const beforeMatches = await page.locator('.schedule-match.is-completed').count()
  await page.getByLabel('Upload recommended schedule JSON').setInputFiles({
    name: 'lineup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(context.expectedOutput)),
  })
  await expect(page.getByRole('dialog')).toContainText('Recorded matches stay unchanged')
  await page.getByRole('dialog').getByRole('button', { name: 'Apply lineup', exact: true }).click()
  await expect(page.locator('.schedule-match.is-completed')).toHaveCount(beforeMatches)
  await page.getByLabel('Upload recommended schedule JSON').setInputFiles({
    name: 'old-lineup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(context.expectedOutput)),
  })
  await expect(page.locator('.schedule-alert')).toContainText('older plan revision')
})

test('availability window inputs keep future pairings inside the selected player’s time', async ({
  page,
}) => {
  await startPlannedSession(page)
  const before = await readSavedData(page)
  const player = before.players[0]
  const from = await page.evaluate(() => Date.now() + 60 * 60000)
  const until = from + 30 * 60000
  const local = (time: number) => new Date(time).toISOString().slice(0, 16)
  await page.getByRole('button', { name: 'Manage players', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog
    .getByRole('button', { name: `Availability window for ${player.name}`, exact: true })
    .click()
  await dialog.getByLabel(`Available from for ${player.name}`, { exact: true }).fill(local(from))
  await dialog.getByLabel(`Available until for ${player.name}`, { exact: true }).fill(local(until))
  await dialog.getByRole('button', { name: 'Apply availability', exact: true }).click()
  await dialog.getByRole('button', { name: 'All set', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Saved on this device', exact: true }),
  ).toBeVisible()
  const after = await readSavedData(page)
  const session = after.sessions[0]
  const window = session.availability![player.id]
  expect(window.from).toBe(Math.floor(from / 60000) * 60000)
  for (const slot of session.plan!.slots.filter((s) =>
    [...s.teamA, ...s.teamB].includes(player.id),
  )) {
    expect(slot.startsAt).toBeGreaterThanOrEqual(window.from!)
    expect(slot.startsAt + session.planning!.matchMinutes * 60000).toBeLessThanOrEqual(
      window.until!,
    )
  }
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Planned evening', exact: true })).toBeVisible()
})

test('opens a scoped printable report and can correct a result from its schedule card', async ({
  page,
}) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Explore a demo', exact: true }).click()
  await page.getByRole('button', { name: /Full schedule/ }).click()
  await page.getByRole('button', { name: 'View result', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Result confirmed', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Correct result', exact: true }).click()
  await dialog.getByLabel('Game 1 side A', { exact: true }).fill('18')
  await dialog.getByLabel('Game 1 side B', { exact: true }).fill('21')
  await dialog.getByRole('button', { name: 'Save corrected result', exact: true }).click()
  await expect(dialog).toContainText('18–21')
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.locator('.history-session-toggle').click()
  const opened = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Save PDF', exact: true }).click()
  const report = await opened
  await expect(report.locator('body')).toContainText('The weekend rally')
  await expect(report.locator('body')).toContainText('18')
  await report.close()
})
