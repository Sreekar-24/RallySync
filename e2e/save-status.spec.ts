import { expect, test } from '@playwright/test'
import { seedRealDemo } from './helpers'

test('an offline storage failure never claims the new history was saved locally', async ({
  page,
  context,
}) => {
  await seedRealDemo(page)
  await page.getByRole('button', { name: 'Players', exact: true }).click()
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'snapshots')
        throw new DOMException('Device storage full', 'QuotaExceededError')
      return original.apply(this, args)
    }
  })
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Add player', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Player name').fill('Offline newcomer')
  await dialog.getByRole('button', { name: 'Add player', exact: true }).click()
  await expect(page.locator('.save-status')).toHaveAccessibleName('Backup needed')
  await expect(page.locator('.save-status')).not.toContainText('saved locally')
  await expect(page.locator('.app-notice')).toContainText('could not be saved')
})
