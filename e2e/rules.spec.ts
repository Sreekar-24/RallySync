import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Learn & rules', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Serving, made simple.' })).toBeVisible()
})

test('searches rules and recovers from an empty search result', async ({ page }) => {
  const search = page.getByRole('searchbox', { name: 'Search badminton rules' })
  await search.fill('Even right')
  await expect(page.locator('.rules-card')).toHaveCount(1)
  const rule = page.getByRole('button', { name: /Even right\. Odd left\./ })
  await rule.click()
  await expect(rule).toHaveAttribute('aria-expanded', 'true')
  await expect(
    page.getByText(
      'The server and receiver stand in diagonally opposite service courts without touching the boundary lines.',
    ),
  ).toBeVisible()
  await search.fill('no-such-badminton-rule')
  await expect(page.getByRole('heading', { name: 'No rules found' })).toBeVisible()
  await expect(page.locator('.rules-card')).toHaveCount(0)
  await page.getByRole('button', { name: 'Show all rules' }).click()
  await expect(search).toHaveValue('')
  await expect(page.locator('.rules-card')).toHaveCount(12)
})

test('filters official reference topics separately from recreational formats', async ({ page }) => {
  const topics = page.getByRole('group', { name: 'Filter rules by topic' })
  await topics.getByRole('button', { name: 'Serving', exact: true }).click()
  await expect(topics.getByRole('button', { name: 'Serving', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.locator('.rules-card')).toHaveCount(2)
  await expect(page.getByRole('heading', { name: 'Make a legal serve.' })).toBeVisible()
  await topics.getByRole('button', { name: 'Social formats' }).click()
  await expect(page.locator('.rules-card')).toHaveCount(2)
  await page.getByRole('button', { name: /Short on time\? Agree first\./ }).click()
  await expect(
    page.getByText('Recreational variation—not standard competition law.').first(),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'BWF laws & regulations' })).toHaveAttribute(
    'href',
    'https://corporate.bwfbadminton.com/statutes/',
  )
})

test('updates the accessible service diagram and resets the demonstration', async ({ page }) => {
  const score = page.getByLabel('Serving score', { exact: true })
  const format = page.getByRole('group', { name: 'Court format' })
  await expect(score).toHaveText('0')
  await expect(page.getByRole('button', { name: 'Decrease serving score' })).toBeDisabled()
  await expect(page.getByText('Even score → right court')).toBeVisible()
  await page.getByRole('button', { name: 'Increase serving score' }).click()
  await expect(score).toHaveText('1')
  await expect(page.getByText('Odd score → left court')).toBeVisible()
  await format.getByRole('button', { name: 'Singles', exact: true }).click()
  await expect(format.getByRole('button', { name: 'Singles', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(
    page.getByRole('img', { name: 'singles service court at a score of 1' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Point to serving side' }).click()
  await expect(score).toHaveText('2')
  await format.getByRole('button', { name: 'Doubles', exact: true }).click()
  await expect(
    page.getByRole('img', { name: 'doubles service court at a score of 2' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Reset service demonstration' }).click()
  await expect(score).toHaveText('0')
})

test('keeps the rules usable at a small mobile width and with reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.getByRole('button', { name: 'Point to serving side' })).toBeVisible()
  await page.getByRole('button', { name: 'Point to serving side' }).click()
  await expect(page.getByLabel('Serving score', { exact: true })).toHaveText('1')
  const overflow = await page
    .locator('.rules-page')
    .evaluate((element) => element.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBe(false)
  await expect(page.getByRole('group', { name: 'Filter rules by topic' })).toBeVisible()
})
