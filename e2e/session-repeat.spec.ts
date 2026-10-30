import { expect, test } from '@playwright/test'
import { createDemo } from '../src/lib/demo'
import { readSavedData, seedRealDemo } from './helpers'

test('ending a session opens a recap and repeating creates a clean plan for today’s attendance', async ({
  page,
}) => {
  const data = createDemo()
  data.sessions[0].planning = {
    basis: 'matches',
    matchCount: 4,
    durationMinutes: 90,
    matchMinutes: 15,
    changeoverMinutes: 2,
  }
  data.sessions[0].scoringMode = 'individual'
  await seedRealDemo(page, data)
  await page.getByRole('button', { name: 'End session', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'End session', exact: true }).click()
  const recap = page.getByRole('dialog')
  await expect(
    recap.getByRole('region', { name: `Summary of ${data.sessions[0].name}` }),
  ).toBeVisible()
  await recap.getByRole('button', { name: 'Play again', exact: true }).click()
  const setup = page.getByRole('dialog')
  await expect(setup).toContainText('Confirm who is playing today')
  await expect(setup.getByRole('spinbutton', { name: 'Total matches' })).toHaveValue('4')
  await setup.getByRole('button', { name: 'Casey Patel', exact: false }).click()
  await setup.getByRole('button', { name: 'Let’s play', exact: false }).click()
  await expect(setup).toHaveCount(0)
  await expect.poll(async () => (await readSavedData(page)).sessions.length).toBe(2)
  const saved = await readSavedData(page)
  const next = saved.sessions[1]
  expect(saved.matches).toEqual(data.matches)
  expect(next.id).not.toBe(data.sessions[0].id)
  expect(next.playerIds).toHaveLength(7)
  expect(next.availablePlayerIds).toEqual(next.playerIds)
  expect(next.availability).toBeUndefined()
  expect(next.plan?.slots).toHaveLength(4)
  expect(next.plan?.slots.every((slot) => !slot.matchId)).toBe(true)
  expect(next.scoringMode).toBe('individual')
})

test('historical score corrections survive close until applied or explicitly discarded', async ({
  page,
}) => {
  const data = createDemo()
  data.sessions[0].status = 'completed'
  data.sessions[0].endedAt = Date.now()
  await seedRealDemo(page, data)
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByRole('button', { name: /The weekend rally/ }).click()
  await page.getByRole('button', { name: 'Correct result', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Game 1 side B', exact: true }).fill('18')
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Keep your score correction')
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: 'Game 1 side B', exact: true })).toHaveValue(
    '18',
  )
  expect((await readSavedData(page)).matches[0].actions).toHaveLength(
    data.matches[0].actions.length,
  )
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.getByRole('button', { name: 'Apply correction', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.history-match-score')).toContainText('21–18')
})
