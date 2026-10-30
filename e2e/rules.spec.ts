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

test('moves only serving partners and keeps player identities through a service change', async ({
  page,
}) => {
  const a1 = page.locator('.rules-court-player[data-player="A1"]')
  const a2 = page.locator('.rules-court-player[data-player="A2"]')
  const b1 = page.locator('.rules-court-player[data-player="B1"]')
  const b2 = page.locator('.rules-court-player[data-player="B2"]')
  const beforeB1 = await b1.getAttribute('style')
  const beforeB2 = await b2.getAttribute('style')
  await page.getByRole('button', { name: 'Point to serving side' }).click()
  await expect(a1).toHaveAttribute('data-position', 'left')
  await expect(a1).toHaveAttribute('data-role', 'server')
  await expect(a2).toHaveAttribute('data-position', 'right')
  expect(await b1.getAttribute('style')).toBe(beforeB1)
  expect(await b2.getAttribute('style')).toBe(beforeB2)
  const beforeA1 = await a1.getAttribute('style')
  const beforeA2 = await a2.getAttribute('style')

  await page.getByRole('button', { name: 'Point to receiving side' }).click()
  await expect(b2).toHaveAttribute('data-role', 'server')
  await expect(b2).toHaveAttribute('data-position', 'left')
  expect(await b1.getAttribute('style')).toBe(beforeB1)
  expect(await b2.getAttribute('style')).toBe(beforeB2)
  expect(await a1.getAttribute('style')).toBe(beforeA1)
  expect(await a2.getAttribute('style')).toBe(beforeA2)
  await expect(page.locator('.rules-service-answer')).toContainText('Nobody swaps.')

  await page.getByRole('button', { name: 'Point to serving side' }).click()
  await expect(b2).toHaveAttribute('data-position', 'right')
  await expect(b2).toHaveAttribute('data-role', 'server')
  expect(await a1.getAttribute('style')).toBe(beforeA1)
  expect(await a2.getAttribute('style')).toBe(beforeA2)
  await page.getByRole('button', { name: 'Point to receiving side' }).click()
  await expect(a2).toHaveAttribute('data-role', 'server')
  await expect(a2).toHaveAttribute('data-position', 'right')
  await expect(page.getByLabel('Demonstration score: Side A 2, Side B 2')).toBeVisible()
})

test('steps or pauses the rally lesson and compares service with rally boundaries', async ({
  page,
}) => {
  await page.clock.install()
  await page.getByText('Watch a four-rally example', { exact: true }).click()
  await page.getByRole('button', { name: 'Play rally example' }).click()
  await page.clock.fastForward(2700)
  await expect(page.locator('.rules-example-controls')).toContainText('1 / 4')
  await page.getByRole('button', { name: 'Pause rally example' }).click()
  await page.clock.fastForward(10000)
  await expect(page.locator('.rules-example-controls')).toContainText('1 / 4')
  await page.getByRole('button', { name: 'Next rally', exact: true }).click()
  await expect(page.locator('[data-player="B2"]')).toHaveAttribute('data-role', 'server')
  await expect(page.locator('.rules-example-controls')).toContainText('2 / 4')

  const boundaries = page.getByRole('group', { name: 'Court boundary demonstration' })
  await boundaries.getByRole('button', { name: 'Rally lines' }).click()
  await expect(page.locator('.rules-rally-area')).toHaveAttribute('height', '220')
  await expect(
    page.getByText('After the return: the full wide, long court is in play.'),
  ).toBeVisible()
  await page
    .getByRole('group', { name: 'Court format' })
    .getByRole('button', { name: 'Singles' })
    .click()
  await expect(page.locator('.rules-rally-area')).toHaveAttribute('height', '180')
  await boundaries.getByRole('button', { name: 'Serve lines' }).click()
  await expect(page.locator('.rules-rally-area')).toHaveCount(0)
  await expect(page.locator('.rules-highlight')).toHaveCount(2)
})
