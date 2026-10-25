import { seedRealDemo } from './helpers'
import { expect, test } from '@playwright/test'
import { createDemo } from '../src/lib/demo'

test('exports, resets, and restores a complete history without accepting malformed backups', async ({
  page,
}, testInfo) => {
  await page.goto('./')
  await seedRealDemo(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByLabel('Choose RallySync backup').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{bad'),
  })
  await expect(page.getByRole('alert')).toContainText('not a valid RallySync backup')
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download full backup', exact: true }).click()
  const downloaded = await downloading
  const backup = testInfo.outputPath('backup.json')
  await downloaded.saveAs(backup)
  await page.getByRole('button', { name: 'Reset local data', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Download backup', exact: true }).click()
  await dialog.getByLabel('Type RESET to confirm').fill('RESET')
  await dialog.getByRole('button', { name: 'Reset local data', exact: true }).click()
  await expect(page.locator('.settings-records')).toContainText('Players0')
  await page.getByLabel('Choose RallySync backup').setInputFiles(backup)
  dialog = page.getByRole('dialog')
  await expect(dialog.locator('.settings-preview')).toContainText('Players8')
  await expect(dialog.getByRole('button', { name: 'Restore backup', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Download backup', exact: true }).click()
  await dialog.getByRole('button', { name: 'Restore backup', exact: true }).click()
  await expect(page.locator('.settings-records')).toContainText('Players8')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'The weekend rally' })).toBeVisible()
  await expect(page.locator('.recent-match')).toContainText('21–17')
})

test('uploads local history to a simulated Sheets endpoint and protects conflicting copies', async ({
  page,
}) => {
  let remote = {
    data: null as ReturnType<typeof createDemo> | null,
    revision: 0,
    updatedAt: 0,
    mutationId: undefined as string | undefined,
  }
  let writes = 0
  await page.route('https://script.google.com/macros/s/test-sync/exec*', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      expect(body.expectedRevision).toBe(remote.revision)
      remote = {
        data: body.data,
        revision: remote.revision + 1,
        updatedAt: Date.now(),
        mutationId: body.mutationId,
      }
      writes++
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true, ...remote }),
    })
  })
  await page.goto('./')
  await seedRealDemo(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page
    .getByLabel('Apps Script web-app URL', { exact: true })
    .fill('https://script.google.com/macros/s/test-sync/exec')
  await page.getByRole('button', { name: 'Connect & check', exact: true }).click()
  await expect(page.locator('.settings-sync-state')).toContainText('Revision 1')
  expect(writes).toBe(1)
  expect(remote.data?.players).toHaveLength(8)
  await page.getByRole('button', { name: 'Players', exact: true }).click()
  await page.getByRole('button', { name: 'Add player', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Player name').fill('Local newcomer')
  await dialog.getByRole('button', { name: 'Add player', exact: true }).click()
  remote = { ...remote, revision: 2, mutationId: 'other-device' }
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Sync now', exact: true }).click()
  await expect(page.locator('.settings-sync-state')).toContainText(
    'Both this device and the sheet have changes',
  )
  expect(writes).toBe(1)
  await expect(page.locator('.settings-records')).toContainText('Players9')
  await page.getByText('Resolve different local and shared copies', { exact: true }).click()
  await page.getByRole('button', { name: 'Use this device’s copy', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Download backup', exact: true })
    .click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Replace shared copy', exact: true })
    .click()
  await expect(page.locator('.settings-sync-state')).toContainText('Revision 3')
  expect(remote.data?.players).toHaveLength(9)
})

test('viewer mode pulls shared history while preventing local scoring', async ({ page }) => {
  const remote = { ok: true, data: createDemo(), revision: 3, updatedAt: Date.now() }
  await page.route('https://script.google.com/macros/s/viewer-test/exec*', async (route) => {
    expect(route.request().method()).toBe('GET')
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(remote),
    })
  })
  await page.goto('./#/settings')
  await page
    .getByLabel('Apps Script web-app URL', { exact: true })
    .fill('https://script.google.com/macros/s/viewer-test/exec')
  await page.getByRole('radio', { name: /Viewer/ }).check()
  await page.getByRole('button', { name: 'Connect & check' }).click()
  await expect(page.locator('.settings-sync-state')).toContainText('Revision 3')
  await expect(page.locator('.settings-records')).toContainText('Players8')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Start match', exact: true }).first(),
  ).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Manage players', exact: true })).toBeDisabled()
  await expect(page.locator('.app-notice')).toContainText('Viewer mode')
})
