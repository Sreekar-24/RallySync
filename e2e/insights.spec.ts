import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-25T12:00:00'))
  await page.goto('./')
  await page.getByRole('button', { name: 'Explore a demo', exact: true }).click()
  await page.getByRole('button', { name: 'Rankings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Find your form.' })).toBeVisible()
})

test('compares partnerships, opponents, and actual participation with format and player filters', async ({
  page,
}) => {
  const views = page.getByRole('group', { name: 'Results view' })
  await views.getByRole('button', { name: 'Partnerships', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Better as a pair?' })).toBeVisible()
  await expect(page.locator('.insights-table tbody tr')).toHaveCount(2)
  await page.getByLabel('Sort partnerships').selectOption('matches')
  await page.getByLabel('Leaderboard format').selectOption('singles')
  await expect(
    page.getByRole('heading', { name: 'Partnerships start with doubles.' }),
  ).toBeVisible()
  await page.getByLabel('Leaderboard format').selectOption('doubles')
  await views.getByRole('button', { name: 'Opponents', exact: true }).click()
  await expect(page.locator('.insights-table tbody tr')).toHaveCount(4)
  await expect(page.locator('.insights-section')).toContainText('team-result encounters')
  await page.locator('.insights-player-filter summary').click()
  await page.getByRole('checkbox', { name: 'Alex Morgan', exact: true }).check()
  await expect(page.locator('.insights-table tbody tr')).toHaveCount(2)
  await views.getByRole('button', { name: 'Participation', exact: true }).click()
  await expect(page.locator('.insights-table tbody tr')).toHaveCount(1)
  await expect(page.locator('.insights-table tbody tr')).toContainText('Alex Morgan')
  await expect(page.locator('.insights-table tbody tr')).toContainText('15 min')
  await views.getByRole('button', { name: 'Standings', exact: true }).click()
  await expect(page.locator('.rankings-table tbody tr')).toHaveCount(1)
  await page.getByLabel('Rank players by').selectOption('performance')
  await page.getByText('The weighted performance formula', { exact: true }).click()
  await expect(page.locator('.insights-explanation')).toContainText('50% smoothed win rate')
})

test('downloads analysis JSON and CSV for the visible scope without unrelated records', async ({
  page,
}) => {
  await page.getByLabel('Leaderboard time span').selectOption('today')
  await page.getByLabel('Leaderboard format').selectOption('doubles')
  await page.getByLabel('Rank players by').selectOption('rating')
  await page.locator('.insights-player-filter summary').click()
  await page.getByRole('checkbox', { name: 'Alex Morgan', exact: true }).check()
  let downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'JSON', exact: true }).click()
  const jsonDownload = await downloading
  const report = JSON.parse(await readFile((await jsonDownload.path())!, 'utf8'))
  expect(report.reportType).toBe('leaderboard')
  expect(report.scope).toMatchObject({
    label: 'Today',
    format: 'doubles',
    playerIds: ['demo-player-0'],
  })
  expect(report.ranking.by).toBe('rating')
  expect(report.standings.map((row: { name: string }) => row.name)).toEqual(['Alex Morgan'])
  expect(report.matches).toHaveLength(1)
  expect(report.players.map((row: { name: string }) => row.name)).not.toContain('Riley Park')
  expect(report.definitions.report).toContain('not an application backup')
  downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'CSV', exact: true }).click()
  const csv = await readFile((await (await downloading).path())!, 'utf8')
  expect(csv).toContain('Alex Morgan')
  expect(csv).not.toContain('Priya Shah')
  await page.getByLabel('Leaderboard format').selectOption('singles')
  downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'JSON', exact: true }).click()
  const emptyReport = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'))
  expect(emptyReport.matches).toEqual([])
  expect(emptyReport.standings).toEqual([])
  expect(emptyReport.players).toEqual([])
})

test('keeps insight tables and date controls usable on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 820 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByLabel('Leaderboard time span').selectOption('range')
  await page.getByLabel('Results from date').fill('2026-10-25')
  await page.getByLabel('Results through date').fill('2026-10-25')
  const views = page.getByRole('group', { name: 'Results view' })
  for (const view of ['Standings', 'Partnerships', 'Opponents', 'Participation']) {
    await views.getByRole('button', { name: view, exact: true }).click()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `${view} should fit a narrow phone`,
    ).toBe(true)
  }
  await views.getByRole('button', { name: 'Standings', exact: true }).click()
  await page.getByLabel('Rank players by').selectOption('credit')
  await expect(page.locator('.rankings-table tbody tr').first()).toContainText('Unknown')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
