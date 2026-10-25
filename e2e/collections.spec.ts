import { seedRealDemo } from './helpers'
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  // Keep the demo's recently completed match inside Today even around midnight.
  await page.clock.setFixedTime(new Date('2026-10-25T12:00:00'))
})

test('adds, edits, validates, and removes unused player profiles', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Players', exact: true }).click()
  await page.getByRole('button', { name: 'Add player', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByLabel('Player name').fill('Mira Patel')
  await dialog.getByRole('radio', { name: /Strong club player/ }).check()
  await dialog.getByRole('button', { name: 'Add player', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Mira Patel', exact: true })).toBeVisible()
  await expect(page.locator('.people-card')).toHaveCount(1)

  await page.getByRole('button', { name: 'Add player', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Player name').fill('  mira   patel  ')
  await dialog.getByRole('button', { name: 'Add player', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('already in your group')
  await expect(page.locator('.people-card')).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()

  await page.getByRole('button', { name: 'Edit Mira Patel', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Player name').fill('Mira P.')
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Mira P.', exact: true })).toBeVisible()
  await expect(page.locator('.people-card')).toContainText('Strong club player')

  await page.reload()
  await page.getByRole('button', { name: 'Players', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Mira P.', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Remove Mira P.', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove player', exact: true }).click()
  await expect(page.locator('.people-card')).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: 'Every great session starts with your people.' }),
  ).toBeVisible()
})

test('shows real demo standings and scoped match history', async ({ page }) => {
  await page.goto('./')
  await seedRealDemo(page)
  await page.getByRole('button', { name: 'Rankings', exact: true }).click()
  await expect(page.locator('.rankings-table tbody tr')).toHaveCount(4)
  const alex = page.locator('.rankings-table tbody tr').filter({ hasText: 'Alex Morgan' })
  const priya = page.locator('.rankings-table tbody tr').filter({ hasText: 'Priya Shah' })
  await expect(alex.locator('.rankings-wins')).toHaveText('1')
  await expect(priya.locator('.rankings-wins')).toHaveText('0')
  await page.getByLabel('Leaderboard time span').selectOption('today')
  await expect(page.locator('.rankings-table tbody tr')).toHaveCount(4)
  await page.getByLabel('Leaderboard time span').selectOption('demo-session')
  await expect(alex).toContainText('100%')
  await page.getByLabel('Rank players by').selectOption('rate')
  await expect(page.locator('.rankings-table tbody tr').first()).toContainText('Alex Morgan')

  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByRole('button', { name: /The weekend rally/ }).click()
  await expect(page.locator('.history-match')).toHaveCount(1)
  await expect(page.locator('.history-match')).toContainText('21–17')
  await expect(page.locator('.history-match')).toContainText('Final')
  await expect(page.getByRole('button', { name: 'Correct result', exact: true })).toBeVisible()
  await page.getByLabel('Filter sessions').selectOption('completed')
  await expect(page.getByRole('heading', { name: 'No sessions in this view.' })).toBeVisible()
  await page.getByLabel('Filter sessions').selectOption('active')
  await expect(
    page.locator('.history-session-toggle').filter({ hasText: 'The weekend rally' }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Players', exact: true }).click()
  await page.getByRole('button', { name: 'Remove Alex Morgan', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Alex Morgan', exact: true })).toBeVisible()
  await expect(page.locator('.people-card')).toHaveCount(8)
})

test('keeps collection screens within a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 })
  await page.goto('./')
  await seedRealDemo(page)
  for (const name of ['Players', 'History', 'Rankings']) {
    if (name === 'History') await page.getByRole('button', { name: 'More navigation' }).click()
    await page.getByRole('button', { name, exact: true }).click()
    await expect(page.locator('.collection-page')).toBeVisible()
    const overflow = await page
      .locator('.collection-page')
      .evaluate((element) => element.scrollWidth > document.documentElement.clientWidth)
    expect(overflow, `${name} should fit a narrow phone`).toBe(false)
  }
})

test('correcting a historical result updates the leaderboard', async ({ page }) => {
  await page.goto('./')
  await seedRealDemo(page)
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByRole('button', { name: /The weekend rally/ }).click()
  await page.getByRole('button', { name: 'Correct result', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Game 1 side A', { exact: true }).fill('18')
  await dialog.getByLabel('Game 1 side B', { exact: true }).fill('21')
  await dialog.getByRole('button', { name: 'Save corrected result', exact: true }).click()
  await expect(page.locator('.history-match')).toContainText('18–21')
  await page.getByRole('button', { name: 'Rankings', exact: true }).click()
  const alex = page.locator('.rankings-table tbody tr').filter({ hasText: 'Alex Morgan' })
  const priya = page.locator('.rankings-table tbody tr').filter({ hasText: 'Priya Shah' })
  await expect(alex.locator('.rankings-wins')).toHaveText('0')
  await expect(priya.locator('.rankings-wins')).toHaveText('1')
})
