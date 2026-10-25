import { test, expect } from '@playwright/test'

test('creates a session, scores deuce with undo, saves results, and persists a finished session', async ({
  page,
}) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'New session', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByLabel('Session name').fill('Friday friends')
  for (const name of ['Anaya', 'Rohan', 'Mira', 'Dev']) {
    await dialog.getByLabel('New player name').fill(name)
    await dialog.getByRole('button', { name: 'Add', exact: true }).click()
  }
  await dialog.getByRole('button', { name: 'Scoring options' }).click()
  await dialog.getByLabel('Points per game').selectOption('11')
  await dialog.getByRole('button', { name: 'Let’s play', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Friday friends' })).toBeVisible()
  await page.getByRole('button', { name: 'Courts', exact: true }).click()
  await page.getByRole('button', { name: 'Start match', exact: true }).click()
  dialog = page.getByRole('dialog')
  for (let i = 0; i < 10; i++) {
    await dialog.getByRole('button', { name: 'Point to side A', exact: true }).click()
    await dialog.getByRole('button', { name: 'Point to side B', exact: true }).click()
  }
  await dialog.getByRole('button', { name: 'Point to side A', exact: true }).click()
  await expect(dialog.getByLabel('Side A score 11')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Confirm result', exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Point to side A', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Confirm result', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Undo last action', exact: true }).click()
  await expect(dialog.getByLabel('Side A score 11')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Confirm result', exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Point to side A', exact: true }).click()
  await dialog.getByRole('button', { name: 'Confirm result', exact: true }).click()
  await expect(page.locator('.recent-match')).toContainText('12–10')
  await page.getByRole('button', { name: 'End session', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'End session', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'The court is calling.' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Saved on this device', exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(page.locator('.recent-match')).toContainText('12–10')
  await page.getByRole('button', { name: 'Rankings', exact: true }).click()
  await expect(page.locator('.rankings-table tbody tr')).toHaveCount(4)
})

test('takes breaks, adds late arrivals, edits teams, and abandons without ranking a result', async ({
  page,
}) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Explore a demo' }).click()
  await page.getByRole('button', { name: 'Manage players', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const alex = dialog.locator('.attendance-row').filter({ hasText: 'Alex Morgan' })
  await alex.getByRole('button', { name: 'Break', exact: true }).click()
  await expect(alex).toContainText('Taking a break')
  await dialog.getByLabel('Add player to session').fill('Late arrival')
  await dialog.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(dialog.locator('.attendance-row').filter({ hasText: 'Late arrival' })).toContainText(
    'Ready for the next rally',
  )
  await dialog.getByRole('button', { name: 'All set', exact: true }).click()
  await page.getByRole('button', { name: 'Edit teams on court 1' }).click()
  const lineup = page.getByRole('dialog')
  await expect(lineup.getByRole('option', { name: 'Alex Morgan', exact: true })).toHaveCount(0)
  await lineup.getByLabel('Side A player 1').selectOption({ label: 'Late arrival' })
  await lineup.getByRole('button', { name: 'Start match', exact: true }).click()
  const score = page.getByRole('dialog')
  await score.getByRole('button', { name: 'Point to side A' }).click()
  await score.getByRole('button', { name: 'Stop match', exact: true }).click()
  await score
    .locator('.notice.warning')
    .getByRole('button', { name: 'Stop match', exact: true })
    .click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByRole('button', { name: /The weekend rally/ }).click()
  await expect(page.locator('.history-match')).toHaveCount(2)
  await expect(page.locator('.history-match').last()).toContainText('Abandoned')
  await page.getByRole('button', { name: 'Rankings', exact: true }).click()
  await expect(page.locator('.rankings-table tbody tr')).toHaveCount(4)
})

test('supports final-score entry and rejects impossible scores', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Explore a demo' }).click()
  await page.getByRole('button', { name: 'Start match', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Edit all scores' }).click()
  await dialog.getByLabel('Game 1 side A').fill('30')
  await dialog.getByLabel('Game 1 side B').fill('0')
  await dialog.getByRole('button', { name: 'Apply scores' }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await dialog.getByLabel('Game 1 side B').fill('29')
  await dialog.getByRole('button', { name: 'Apply scores' }).click()
  await dialog.getByRole('button', { name: 'Confirm result', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.recent-match').first()).toContainText('30–29')
})
