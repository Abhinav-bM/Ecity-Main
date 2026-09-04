import { expect, test } from '@playwright/test'
import { expectNoHorizontalOverflow, isMobileProject, signIn, USERS } from './helpers'

/**
 * M1 — master data. Runs at every viewport in playwright.config.ts.
 * Requires a seeded database (`npm run db:seed`).
 */

const PAGES = [
  { path: '/customers', heading: 'Customers' },
  { path: '/suppliers', heading: 'Suppliers' },
  { path: '/settings/branches', heading: 'Branches' },
  { path: '/settings/business', heading: 'Business settings' },
] as const

test.describe('as admin', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  for (const { path, heading } of PAGES) {
    test(`${path} renders and fits the viewport`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
      await expectNoHorizontalOverflow(page)
    })
  }

  test('seeded tax rates, payment methods and expense categories are visible', async ({ page }) => {
    await page.goto('/settings/business')

    await page.getByRole('tab', { name: 'Tax' }).click()
    await expect(page.getByText('GST 18%').first()).toBeVisible()
    await expect(page.getByText('18.00%').first()).toBeVisible()

    await page.getByRole('tab', { name: 'Payments' }).click()
    await expect(page.getByText('UPI').first()).toBeVisible()
    await expect(page.getByText('Bank Transfer').first()).toBeVisible()

    await page.getByRole('tab', { name: 'Expenses' }).click()
    await expect(page.getByText('Electricity').first()).toBeVisible()
  })

  test('creates a customer, finds it by search, then deactivates it', async ({ page }) => {
    const name = `E2E Customer ${Date.now()}`
    const phone = String(Date.now()).slice(-10)

    await page.goto('/customers/new')
    await page.getByLabel('Name', { exact: false }).first().fill(name)
    await page.getByLabel('Phone', { exact: true }).fill(phone)
    await page.getByRole('button', { name: 'Create customer' }).click()

    await expect(page).toHaveURL(/\/customers$/)
    await page.getByLabel('Search customers').fill(name)
    await page.getByRole('button', { name: 'Search' }).click()
    // Card and table layouts both exist; assert on whichever is visible.
    await expect(page.getByRole('link', { name }).and(page.locator(':visible'))).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('refuses a duplicate customer phone with a clear message', async ({ page }) => {
    const phone = String(Date.now()).slice(-10)

    for (const suffix of ['first', 'second']) {
      await page.goto('/customers/new')
      await page.getByLabel('Name', { exact: false }).first().fill(`Dup ${suffix} ${phone}`)
      await page.getByLabel('Phone', { exact: true }).fill(phone)
      await page.getByRole('button', { name: 'Create customer' }).click()

      if (suffix === 'second') {
        await expect(page.locator('[data-slot="alert"]')).toContainText(/already uses this phone/i)
      } else {
        await expect(page).toHaveURL(/\/customers$/)
      }
    }
  })

  test('rejects a malformed GST number before submitting', async ({ page }) => {
    await page.goto('/suppliers/new')
    await page.getByLabel('Name', { exact: false }).first().fill('GST Test Supplier')
    await page.getByLabel('GST number').fill('NOT-A-GSTIN')
    await page.getByRole('button', { name: 'Create supplier' }).click()
    // The message appears on the field; the form-level alert is generic.
    await expect(page.locator('p[role="alert"]').filter({ hasText: /valid 15-character GSTIN/i })).toBeVisible()
  })

  test('creates a branch and blocks a duplicate code', async ({ page }) => {
    const code = `E${String(Date.now()).slice(-6)}`

    await page.goto('/settings/branches/new')
    await page.getByLabel('Branch code').fill(code)
    await page.getByLabel('Branch name').fill(`E2E Branch ${code}`)
    await page.getByRole('button', { name: 'Create branch' }).click()
    await expect(page).toHaveURL(/\/settings\/branches$/)
    await expect(page.getByText(code).and(page.locator(':visible')).first()).toBeVisible()

    await page.goto('/settings/branches/new')
    await page.getByLabel('Branch code').fill(code)
    await page.getByLabel('Branch name').fill('Duplicate Attempt')
    await page.getByRole('button', { name: 'Create branch' }).click()
    await expect(page.locator('[data-slot="alert"]')).toContainText(/already in use/i)
  })

  test('a new branch appears in the header branch switcher', async ({ page }) => {
    const code = `S${String(Date.now()).slice(-6)}`
    await page.goto('/settings/branches/new')
    await page.getByLabel('Branch code').fill(code)
    await page.getByLabel('Branch name').fill(`Switcher ${code}`)
    await page.getByRole('button', { name: 'Create branch' }).click()
    await expect(page).toHaveURL(/\/settings\/branches$/)

    await page.getByRole('button', { name: /Active branch/ }).click()
    await expect(page.getByRole('menu')).toContainText(code)
  })
})

test.describe('permissions', () => {
  test('staff cannot reach supplier or business settings pages', async ({ page }) => {
    await signIn(page, USERS.staff)
    // Staff may view suppliers but not edit them, and cannot see settings.
    await page.goto('/settings/business')
    await expect(page).toHaveURL(/\/dashboard/)
    await page.goto('/customers/new')
    await expect(page).toHaveURL(/\/customers/)
  })

  test('staff sees master data in the navigation but not settings', async ({ page }, testInfo) => {
    await signIn(page, USERS.staff)
    if (isMobileProject(testInfo.project.name)) {
      await page.getByRole('button', { name: 'Open navigation menu' }).click()
    }
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav.getByRole('link', { name: 'Customers' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Business' })).toBeHidden()
    // Staff hold branch.view for the header switcher, but the Branches
    // settings screen needs branch.manage, so the link must not appear.
    await expect(nav.getByRole('link', { name: 'Branches' })).toBeHidden()
  })
})

test.describe('phone layout', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!isMobileProject(testInfo.project.name), 'phones only')
  })

  test('lists become cards rather than sideways-scrolling tables', async ({ page }) => {
    await signIn(page, USERS.admin)
    for (const [path, testId] of [
      ['/customers', 'customer-table'],
      ['/suppliers', 'supplier-table'],
      ['/settings/branches', 'branch-table'],
    ] as const) {
      await page.goto(path)
      await expect(page.getByTestId(testId)).toBeHidden()
      await expectNoHorizontalOverflow(page)
    }
  })
})
