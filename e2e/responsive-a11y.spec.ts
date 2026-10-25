import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

for (const width of [320, 390, 768, 1024, 1440, 1920]) {
  test(`keeps the dashboard, scoring, and rules usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('./')
    await expect(page.getByRole('heading', { name: 'The court is calling.' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Explore a demo' }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Start match', exact: true }).first().click()
    const point = page.getByRole('button', { name: 'Point to side A', exact: true })
    await point.click()
    await expect(page.getByLabel('Side A score 1')).toBeVisible()
    const bounds = await point.boundingBox()
    expect(bounds?.height).toBeGreaterThanOrEqual(44)
    expect(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    )
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await page.getByRole('button', { name: 'Learn & rules', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Serving, made simple.' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('passes automated accessibility checks on primary screens and live scoring', async ({
  page,
}) => {
  test.setTimeout(90000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const violations: unknown[] = []
  for (const route of ['play', 'players', 'rules', 'settings']) {
    await page.goto(`./#/${route}`)
    await expect(page.locator('main h1')).toBeVisible()
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()
    violations.push(
      ...results.violations.map((v) => ({
        route,
        id: v.id,
        nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
      })),
    )
  }
  await page.goto('./')
  await page.getByRole('button', { name: 'Explore a demo' }).click()
  await page.getByRole('button', { name: 'Start match', exact: true }).first().click()
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  violations.push(
    ...results.violations.map((v) => ({
      route: 'scoring',
      id: v.id,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
    })),
  )
  expect(violations).toEqual([])
})
