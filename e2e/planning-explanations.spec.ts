import { expect, test } from '@playwright/test'
import { createDemo } from '../src/lib/demo'
import { readSavedData, seedRealDemo } from './helpers'

test('explains a generated matchup and previews player participation before applying an edit', async ({
  page,
}) => {
  await seedRealDemo(page, { version: 2, players: createDemo().players, sessions: [], matches: [] })
  await page.getByRole('button', { name: 'New session', exact: true }).click()
  const setup = page.getByRole('dialog')
  await setup.getByLabel('Session name').fill('Clear plans')
  await setup.getByLabel('Total matches').fill('6')
  await setup.getByRole('button', { name: 'Let’s play', exact: true }).click()
  const first = page.locator('.schedule-match').first()
  await expect(first.locator('.schedule-match-reason')).not.toBeVisible()
  await first.getByText('Why this matchup?', { exact: true }).click()
  await expect(first.locator('.schedule-match-reason')).toContainText('Estimated team rating gap:')
  await expect(first.locator('.schedule-match-reason')).toContainText(
    'earlier matches per selected player',
  )
  const before = await readSavedData(page)
  await page.getByRole('button', { name: 'Edit round 1 court 1', exact: true }).click()
  const dialog = page.getByRole('dialog')
  // Swap the two teams: match counts are unchanged; the preview must make this explicit.
  const firstSlot = before.sessions[0].plan!.slots[0]
  await dialog.getByLabel('Planned side A player 1').selectOption(firstSlot.teamB[0])
  await dialog.getByRole('button', { name: 'Preview change', exact: true }).click()
  await expect(page.getByRole('dialog').getByLabel('Participation impact')).toContainText(
    'Scheduled matches per player',
  )
  await expect(page.getByRole('dialog').getByLabel('Participation impact')).toContainText(
    'Longest available rest streak',
  )
  const saved = await readSavedData(page)
  expect(saved.sessions[0].plan!.revision).toBe(before.sessions[0].plan!.revision)
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Keep current plan', exact: true })
    .click()
  expect((await readSavedData(page)).sessions[0].plan!.slots).toEqual(
    before.sessions[0].plan!.slots,
  )
})
