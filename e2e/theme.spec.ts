import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function openAppearance(page: import('@playwright/test').Page) {
  await page.locator('.theme-picker > summary').click()
  await expect(page.locator('.theme-popover')).toBeVisible()
}

test('persists appearance independently of demo data and follows system changes', async ({
  page,
}) => {
  await page.goto('./')
  await expect(page.locator('main h1')).toBeVisible()
  await openAppearance(page)
  await page.locator('.theme-popover').getByRole('radio', { name: /Dark/ }).check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('heading', { name: 'The court is calling.' })).toBeVisible()
  await page.getByRole('button', { name: 'Explore a demo', exact: true }).click()
  await openAppearance(page)
  await page
    .locator('.theme-popover')
    .getByRole('radio', { name: /High contrast/ })
    .check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'contrast')
  await page.locator('.theme-picker > summary').press('Escape')
  await expect(page.locator('.theme-popover')).toBeHidden()
  await page.getByRole('button', { name: 'Exit demo', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'contrast')
  await openAppearance(page)
  await page
    .locator('.theme-popover')
    .getByRole('radio', { name: /System/ })
    .check()
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.goto('./#/settings')
  await expect(
    page.getByRole('group', { name: 'Appearance theme' }).getByRole('radio', { name: /System/ }),
  ).toBeChecked()
})

for (const theme of ['dark', 'contrast'] as const) {
  test(`${theme} retains readable responsive screens and live controls`, async ({ page }) => {
    test.setTimeout(120000)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.addInitScript((value) => localStorage.setItem('rallysync-appearance', value), theme)
    const violations: unknown[] = []
    const check = async (view: string) => {
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
      violations.push(
        ...result.violations.map((v) => ({
          view,
          id: v.id,
          nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
        })),
      )
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
    }
    for (const route of ['play', 'players', 'rules', 'settings']) {
      await page.goto(`./#/${route}`)
      await expect(page.locator('main h1')).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await check(route)
    }
    await page.goto('./')
    await page.getByRole('button', { name: 'Explore a demo', exact: true }).click()
    await page.getByRole('button', { name: 'Start match', exact: true }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await check('scoring')
    await page.getByRole('button', { name: 'Set first serve', exact: true }).click()
    await page.getByRole('button', { name: 'Start tracking', exact: true }).click()
    await expect(page.locator('.service-player.is-serving')).toBeVisible()
    await check('serve tracking')
    await page.getByRole('button', { name: 'Point to side A', exact: true }).click()
    await check('serve after rally')
    expect(violations).toEqual([])
  })
}
