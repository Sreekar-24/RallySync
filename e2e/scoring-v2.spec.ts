import { expect, test, type Page } from '@playwright/test'

async function openDemoScore(page: Page) {
  await page.goto('./')
  await page.getByRole('button', { name: 'Explore a demo', exact: true }).click()
  await page.getByRole('button', { name: 'Courts', exact: true }).click()
  await page.getByRole('button', { name: 'Start match', exact: true }).first().click()
  await expect(page.getByRole('dialog').getByRole('heading', { name: /Scoreboard/ })).toBeVisible()
}

async function enterTotals(page: Page, a: string, b: string) {
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('spinbutton', { name: /^Side A score/ }).fill(a)
  await dialog.getByRole('spinbutton', { name: /^Side B score/ }).fill(b)
  await dialog.getByRole('button', { name: 'Apply score', exact: true }).click()
}

test('direct edits remain provisional until confirmation, including corrections after game point', async ({
  page,
}) => {
  await openDemoScore(page)
  await enterTotals(page, '21', '19')
  let dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Winning score reached', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Confirm result', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(page.locator('.recent-match')).toHaveCount(1)
  await page.getByRole('button', { name: 'Open scoreboard', exact: true }).click()
  await enterTotals(page, '20', '19')
  dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Confirm result', exact: true })).toHaveCount(0)
  await enterTotals(page, '20', '22')
  await dialog.getByRole('button', { name: 'Confirm result', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.recent-match')).toHaveCount(2)
  await expect(page.locator('.recent-match').first()).toContainText('20–22')
})

test('player credits tally into doubles totals and direct corrections are undoable as one action', async ({
  page,
}) => {
  await openDemoScore(page)
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Doubles point entry mode').selectOption('combined')
  const first = dialog.locator('.score-side-a .individual-point').first()
  const second = dialog.locator('.score-side-a .individual-point').last()
  await first.click()
  await dialog.getByRole('button', { name: 'Point to side A', exact: true }).click()
  await second.click()
  await expect(dialog.getByRole('spinbutton', { name: /^Side A score/ })).toHaveValue('3')
  await expect(first.locator('strong')).toHaveText('1')
  await expect(second.locator('strong')).toHaveText('1')
  await expect(dialog.locator('.score-side-a .unassigned-score')).toContainText('1 unassigned')
  await enterTotals(page, '0', '0')
  await expect(dialog.getByRole('alert')).toContainText('credits exceed')
  await dialog
    .getByRole('button', { name: 'Edit all scores and player allocation', exact: true })
    .click()
  await dialog.getByLabel('Game 1 side A', { exact: true }).fill('0')
  await dialog
    .getByRole('button', { name: 'Mark all entered points unassigned', exact: true })
    .click()
  await dialog.getByRole('button', { name: 'Apply scores', exact: true }).click()
  await expect(dialog.getByRole('spinbutton', { name: /^Side A score/ })).toHaveValue('0')
  await expect(dialog.getByRole('button', { name: 'Undo last action', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Undo last action', exact: true }).click()
  await expect(dialog.getByRole('spinbutton', { name: /^Side A score/ })).toHaveValue('3')
  await expect(first.locator('strong')).toHaveText('1')
  await expect(second.locator('strong')).toHaveText('1')
  await dialog.getByRole('button', { name: 'Undo last action', exact: true }).click()
  await expect(dialog.getByRole('spinbutton', { name: /^Side A score/ })).toHaveValue('2')
})

test('a corrected completed result replaces its winner without adding a duplicate match', async ({
  page,
}) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Explore a demo', exact: true }).click()
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByRole('button', { name: /The weekend rally/ }).click()
  await page.getByRole('button', { name: 'Correct result', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Game 1 side A', { exact: true }).fill('18')
  await dialog.getByLabel('Game 1 side B', { exact: true }).fill('21')
  await dialog.getByRole('button', { name: 'Save corrected result', exact: true }).click()
  await expect(page.locator('.history-match')).toHaveCount(1)
  await expect(page.locator('.history-match')).toContainText('18–21')
  await page.getByRole('button', { name: 'Rankings', exact: true }).click()
  await expect(
    page
      .locator('.rankings-table tbody tr')
      .filter({ hasText: 'Priya Shah' })
      .locator('.rankings-wins'),
  ).toHaveText('1')
  await expect(
    page
      .locator('.rankings-table tbody tr')
      .filter({ hasText: 'Alex Morgan' })
      .locator('.rankings-wins'),
  ).toHaveText('0')
})

test('best-of-three score editing validates game order and requires an overall match winner', async ({
  page,
}) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'New session', exact: true }).click()
  const setup = page.getByRole('dialog')
  for (const name of ['Anaya', 'Rohan', 'Mira', 'Dev']) {
    await setup.getByLabel('New player name').fill(name)
    await setup.getByRole('button', { name: 'Add', exact: true }).click()
  }
  await setup.getByRole('button', { name: 'Scoring options', exact: true }).click()
  await setup.getByLabel('Match length', { exact: true }).selectOption('3')
  await setup.getByRole('button', { name: 'Let’s play', exact: true }).click()
  await page.getByRole('button', { name: 'Courts', exact: true }).click()
  await page.getByRole('button', { name: 'Start match', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Edit all scores', exact: true }).click()
  await dialog.getByLabel('Game 1 side A', { exact: true }).fill('21')
  await dialog.getByLabel('Game 1 side B', { exact: true }).fill('10')
  await dialog.getByRole('button', { name: 'Apply scores', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Confirm result', exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Edit all scores', exact: true }).click()
  await dialog.getByLabel('Game 2 side A', { exact: true }).fill('19')
  await dialog.getByLabel('Game 2 side B', { exact: true }).fill('21')
  await dialog.getByLabel('Game 3 side A', { exact: true }).fill('21')
  await dialog.getByLabel('Game 3 side B', { exact: true }).fill('19')
  await dialog.getByRole('button', { name: 'Apply scores', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Confirm result', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Confirm result', exact: true }).click()
  await expect(page.locator('.recent-match').first()).toContainText('21–10 / 19–21 / 21–19')
})
