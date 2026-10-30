import { expect, test } from '@playwright/test'
import { createDemo } from '../src/lib/demo'
import { readSavedData, seedRealDemo } from './helpers'

test('completed recap separates accepted results from participation and exports a recovery backup', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 })
  const data = createDemo()
  data.sessions[0] = { ...data.sessions[0], status: 'completed', endedAt: Date.now() }
  data.matches.push({
    id: 'stopped-summary',
    sessionId: data.sessions[0].id,
    court: 2,
    teamA: data.players.slice(4, 6).map((p) => p.id),
    teamB: data.players.slice(6, 8).map((p) => p.id),
    startedAt: data.sessions[0].startedAt + 60000,
    endedAt: data.sessions[0].startedAt + 6 * 60000,
    status: 'abandoned',
    revision: 0,
    actions: [],
  })
  await seedRealDemo(page, data)
  await page.getByRole('button', { name: 'More navigation' }).click()
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByRole('button', { name: /The weekend rally/ }).click()
  const summary = page.getByRole('region', { name: 'Summary of The weekend rally', exact: true })
  await expect(summary).toBeVisible()
  await expect(
    summary
      .locator('.session-summary-facts > div')
      .filter({ hasText: 'Confirmed matches' })
      .locator('strong'),
  ).toHaveText('1')
  await expect(summary.locator('.session-summary-leaders')).toContainText('Alex Morgan, Jamie Chen')
  await summary.getByText('Results and playing time', { exact: true }).click()
  await expect(summary.locator('tbody tr')).toHaveCount(8)
  await expect(summary.locator('tbody tr').filter({ hasText: 'Priya Shah' })).toContainText('0–1')
  const stoppedPlayer = summary.locator('tbody tr').filter({ hasText: 'Riley Park' })
  await expect(stoppedPlayer).toContainText('0–0')
  await expect(stoppedPlayer.locator('td').nth(1)).toHaveText('1')
  await expect(summary.locator('.session-summary-pairs')).toContainText('in 1 match')
  const overflow = await summary.evaluate(
    (element) => element.getBoundingClientRect().right > innerWidth,
  )
  expect(overflow).toBe(false)
  const download = page.waitForEvent('download')
  await summary.getByRole('button', { name: 'Back up all history' }).click()
  await expect((await download).suggestedFilename()).toMatch(/^rallysync-backup-.*\.json$/)
  expect((await readSavedData(page)).matches).toHaveLength(2)
})

test('play again copies preferences but confirms fresh attendance without changing the original', async ({
  page,
}) => {
  const data = createDemo()
  const old = data.sessions[0]
  old.status = 'completed'
  old.endedAt = Date.now() - 60000
  old.availablePlayerIds = old.playerIds.slice(0, 5)
  old.availability = { [old.playerIds[0]]: { until: old.endedAt } }
  old.attendance = old.playerIds.map((playerId) => ({
    playerId,
    at: old.startedAt,
    available: true,
  }))
  await seedRealDemo(page, data)
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByRole('button', { name: /The weekend rally/ }).click()
  await page.getByRole('button', { name: 'Play again', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Confirm who is playing today')
  await expect(dialog.getByLabel(/Session name/)).toHaveValue(old.name)
  await expect(dialog.getByLabel('Play style')).toHaveValue('doubles')
  await expect(dialog.getByLabel('Courts', { exact: true })).toHaveValue('2')
  await dialog.getByRole('button', { name: 'Casey Patel', exact: true }).click()
  await dialog.getByRole('button', { name: 'Let’s play' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(async () => (await readSavedData(page)).sessions.length).toBe(2)
  const saved = await readSavedData(page)
  const fresh = saved.sessions.find((session) => session.id !== old.id)!
  expect(fresh.playerIds).toHaveLength(7)
  expect(fresh.playerIds).not.toContain(data.players[7].id)
  expect(fresh.availablePlayerIds).toEqual(fresh.playerIds)
  expect(fresh.availability).toBeUndefined()
  expect(fresh.attendance?.every((event) => event.available && event.at === fresh.startedAt)).toBe(
    true,
  )
  expect(saved.sessions.find((session) => session.id === old.id)).toEqual(old)
  expect(saved.matches).toHaveLength(1)
})
