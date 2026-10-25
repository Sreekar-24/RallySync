import { test, expect } from '@playwright/test'

test('installs its service worker and reloads cached screens offline without losing scores', async ({
  page,
  context,
}) => {
  await page.goto('./')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.getByRole('button', { name: 'Explore a demo' }).click()
  await page.getByRole('button', { name: 'Start match', exact: true }).first().click()
  await page.getByRole('button', { name: 'Point to side A' }).click()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Saved on this device', exact: true }),
  ).toBeVisible()
  await page.reload()
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Let’s keep the rally going.' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Offline · saved locally', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Open scoreboard' }).click()
  await expect(page.getByLabel('Side A score 1')).toBeVisible()
  await page.getByRole('button', { name: 'Point to side B' }).click()
  await expect(page.getByLabel('Side B score 1')).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.getByRole('button', { name: 'Learn & rules', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Serving, made simple.' })).toBeVisible()
})

test('serves valid install assets at the repository base path', async ({ request }) => {
  const response = await request.get('manifest.webmanifest')
  expect(response.ok()).toBe(true)
  const manifest = await response.json()
  expect(manifest.display).toBe('standalone')
  expect(manifest.name).toContain('RallySync')
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true)
  expect((await request.get('sw.js')).ok()).toBe(true)
})

test('prevents two tabs from editing the same local clubhouse', async ({ page, context }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Explore a demo' }).click()
  const second = await context.newPage()
  await second.goto('./')
  await expect(second.locator('.app-notice')).toContainText('Another tab is editing')
  await expect(second.getByRole('button', { name: 'Manage players', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Manage players', exact: true })).toBeEnabled()
  await page.close()
  await second.reload()
  await expect(second.getByRole('button', { name: 'Manage players', exact: true })).toBeEnabled()
  await expect(second.getByRole('heading', { name: 'The weekend rally' })).toBeVisible()
})
