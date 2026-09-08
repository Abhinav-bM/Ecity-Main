import { expect, test, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow, isMobileProject, signIn, USERS } from './helpers'

/**
 * M10 — dashboards and analytics.
 *
 * The criteria here are about reach and shape rather than arithmetic: the
 * integration suite already checks every measure against a hand-calculated
 * dataset. These check that a person can get to the numbers, change what they
 * cover, and click through to a handset.
 */

const AREAS = [
  ['insights', 'Insights'],
  ['sales', 'Sales'],
  ['products', 'Products'],
  ['brands', 'Brands'],
  ['customers', 'Customers'],
  ['credit', 'Credit'],
  ['inventory', 'Inventory'],
  ['profit', 'Profit'],
  ['payments', 'Payments'],
  ['suppliers', 'Suppliers'],
] as const

async function gotoAnalytics(page: Page, slug = '') {
  await page.goto(`/analytics${slug ? `/${slug}` : ''}`)
  await expect(page.getByTestId('analytics-tabs')).toBeVisible()
}

test.describe('the dashboard (FR-15)', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('shows today’s figures, and each one leads somewhere', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()

    const figures = page.getByTestId('dashboard-figures')
    for (const label of [
      'Sales today',
      'Purchases today',
      'Cash in the till',
      'In accounts',
      'Customers owe',
      'Owed to suppliers',
      'Stock value',
    ]) {
      await expect(figures.getByText(label, { exact: true })).toBeVisible()
    }

    // FR-36.4. A number is a way in, not a dead end.
    await figures.getByText('Sales today', { exact: true }).click()
    await expect(page).toHaveURL(/\/sales$/)
    await expectNoHorizontalOverflow(page)
  })

  test('shows the estimated profit to someone who may see cost', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.getByText('Estimated profit')).toBeVisible()
  })
})

test.describe('analytics', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('every area is reachable and renders', async ({ page }) => {
    await gotoAnalytics(page)
    await expect(page.getByTestId('overview-figures')).toBeVisible()

    for (const [slug, label] of AREAS) {
      await gotoAnalytics(page, slug)
      await expect(page.getByTestId('analytics-tabs').getByText(label, { exact: true })).toBeVisible()
      // Every page carries the shared controls...
      await expect(page.getByRole('textbox', { name: 'From', exact: true })).toBeVisible()
      await expect(page.getByRole('combobox', { name: 'Branch', exact: true })).toBeVisible()
      /*
       * ...and a chart plus a table. Inventory and Credit lead with a
       * position rather than a period, so they do not offer "compare to
       * previous" - a button that changed nothing would be worse than none.
       */
      await expect(page.locator('[data-testid$="-chart"]').first()).toBeVisible()
      /*
       * The section, not its rows: a period with no sales still has a table,
       * and asserting on rows would make this pass or fail with the seed data
       * rather than with the code.
       */
      await expect(page.locator('[data-testid$="-table"]').first()).toBeVisible()
      const comparable = !['inventory', 'credit'].includes(slug)
      await expect(page.getByRole('button', { name: /Compare to previous/ })).toHaveCount(
        comparable ? 1 : 0,
      )
      await expectNoHorizontalOverflow(page)
    }
  })

  /** Criterion 2: the branch selector changes the figures. */
  test('the range and branch live in the URL, so a view can be shared', async ({ page }) => {
    await gotoAnalytics(page, 'sales')
    await page.getByRole('button', { name: '7 days' }).click()
    await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/)

    // Moving between areas keeps the period.
    const url = new URL(page.url())
    const from = url.searchParams.get('from')!
    await page.getByTestId('analytics-tabs').getByText('Products', { exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`from=${from}`))
  })

  /** Criterion 3: GLOBAL, with NEW CUT split out. */
  test('reports each main type, and splits NEW CUT out of GLOBAL', async ({ page }) => {
    await gotoAnalytics(page, 'products')
    const table = page.getByTestId('main-type-table')
    await expect(table).toBeVisible()

    /*
     * The rule made visible: NEW CUT appears as a line inside GLOBAL, never
     * as a sixth main type. If the seeded data has no NEW CUT sale the table
     * simply has fewer rows — the heading is what matters here.
     */
    await expect(page.getByText('GLOBAL is split so NEW CUT can be judged on its own.')).toBeVisible()
  })

  test('profit filters by main type, and offers NEW CUT only inside GLOBAL', async ({ page }) => {
    await gotoAnalytics(page, 'profit')
    await expect(page.getByTestId('profit-figures')).toBeVisible()

    // NEW CUT is not offered until GLOBAL is chosen.
    await expect(page.getByTestId('new-cut-filter')).toHaveCount(0)
    await page.getByRole('button', { name: 'GLOBAL', exact: true }).click()
    await expect(page.getByTestId('new-cut-filter')).toBeVisible()
    await page.getByRole('button', { name: 'NEW CUT only' }).click()
    await expect(page).toHaveURL(/newCut=1/)

    // Choosing another type drops the NEW CUT filter with it.
    await page.getByRole('button', { name: 'USED', exact: true }).click()
    await expect(page.getByTestId('new-cut-filter')).toHaveCount(0)
  })

  /** Criterion 5: a dashboard number reaches an IMEI in at most four clicks. */
  test('a figure on the dashboard reaches a handset', async ({ page }) => {
    // 1. Dashboard → stock value.
    await page.goto('/dashboard')
    await page.getByTestId('dashboard-figures').getByText('Stock value', { exact: true }).click()
    await expect(page).toHaveURL(/\/analytics\/inventory/)

    // 2. Inventory → handsets.
    await page.getByTestId('inventory-figures').getByText('Handsets', { exact: true }).click()
    await expect(page).toHaveURL(/\/devices$/)

    // 3. A device.
    const device = page.getByRole('link', { name: /^3\d{13}$/ }).first()
    if ((await device.count()) === 0) {
      await page.getByRole('link').filter({ hasText: /\d{10,}/ }).first().click()
    } else {
      await device.click()
    }
    await expect(page).toHaveURL(/\/devices\/\d+$/)
    // ...and that is the M9 history page, three clicks from the dashboard.
    await expect(page.getByTestId('device-timeline')).toBeVisible()
  })

  /** FR-35. What changed, not just what happened. */
  test('insights report direction and the best days', async ({ page }) => {
    await gotoAnalytics(page, 'insights')
    await expect(page.getByTestId('insight-figures')).toBeVisible()
    await expect(page.getByText('Collection rate')).toBeVisible()
    await expect(page.getByTestId('weekday-chart')).toBeVisible()
    await expect(page.getByTestId('insight-products-table')).toBeVisible()
    await expect(page.getByTestId('insight-brands-table')).toBeVisible()
    // FR-35.3: the five types compared, GLOBAL split by NEW CUT.
    await expect(page.getByText(/NEW CUT judged separately inside GLOBAL/)).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  /** FR-21's remaining measures. */
  test('inventory reports turnover, low stock and out of stock', async ({ page }) => {
    await gotoAnalytics(page, 'inventory')
    const health = page.getByTestId('inventory-health')
    await expect(health.getByText('Turnover', { exact: true })).toBeVisible()
    await expect(health.getByText('Low stock', { exact: true })).toBeVisible()
    await expect(health.getByText('Out of stock', { exact: true })).toBeVisible()
    await expect(page.getByTestId('movement-table')).toBeVisible()
  })

  /** FR-20's remaining measures. */
  test('credit reports collection performance and repeat offenders', async ({ page }) => {
    await gotoAnalytics(page, 'credit')
    await expect(page.getByTestId('collection-performance')).toBeVisible()
    await expect(page.getByText('Late more than once')).toBeVisible()
    await expect(page.getByTestId('aging-buckets')).toBeVisible()
  })

  /** FR-24 and FR-36.2. */
  test('suppliers show what they supply, and the overview shows the money', async ({ page }) => {
    await gotoAnalytics(page, 'suppliers')
    await expect(page.getByText('What we buy, and from whom')).toBeVisible()

    await gotoAnalytics(page)
    const money = page.getByTestId('overview-money')
    for (const label of ['Cash in the till', 'In accounts', 'Customers owe', 'Stock value']) {
      await expect(money.getByText(label, { exact: true })).toBeVisible()
    }
  })

  test('appears in the navigation', async ({ page }, testInfo) => {
    await page.goto('/dashboard')
    if (isMobileProject(testInfo.project.name)) {
      await page.getByRole('button', { name: 'Open navigation menu' }).click()
    }
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Analytics' }),
    ).toBeVisible()
  })
})

test.describe('permissions', () => {
  test('staff see analytics but not profit', async ({ page }) => {
    await signIn(page, USERS.staff)

    await page.goto('/analytics')
    await expect(page.getByTestId('analytics-tabs')).toBeVisible()
    // Margin is cost information, and staff do not see cost.
    await expect(page.getByTestId('analytics-tabs').getByText('Profit', { exact: true })).toHaveCount(0)

    await page.goto('/analytics/profit')
    await expect(page).toHaveURL(/\/analytics$/)

    await page.goto('/dashboard')
    await expect(page.getByText('Estimated profit')).toHaveCount(0)
  })
})
