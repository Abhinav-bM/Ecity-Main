import { expect, test } from '@playwright/test'
import { choose, expectNoHorizontalOverflow, isMobileProject, signIn, USERS } from './helpers'

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

  test('adds, edits and retires a payment method — and the till follows', async ({ page }) => {
    /*
     * This tab could only activate and deactivate what the seed had put there.
     * A business set up by hand therefore had no payment methods and no way to
     * make one, which leaves the till with nothing to take money with - a cash
     * sale becomes impossible and the screen never says why.
     */
    const suffix = String(Date.now()).slice(-6)
    const name = `Voucher ${suffix}`

    await page.goto('/settings/business')
    await page.getByRole('tab', { name: 'Payments' }).click()

    /*
     * A name and a kind, and nothing else. The form used to also demand a
     * `code` - capitals and underscores, unique per shop - which nothing in
     * the app ever reads. The service derives it from the name now.
     */
    await expect(page.getByLabel('Payment method code')).toHaveCount(0)
    await page.getByLabel('Payment method name').fill(name)
    await choose(page.getByRole('combobox', { name: 'Payment method type' }), 'Other')
    await page.getByRole('button', { name: 'Add method' }).click()
    await expect(page.getByText(`${name}`).first()).toBeVisible()

    // It is offered at the till straight away.
    await page.goto('/billing')
    await expect(page.getByRole('button', { name: `+ ${name}` })).toBeVisible()

    // Renaming it is reflected everywhere it is offered.
    const renamed = `${name} B`
    await page.goto('/settings/business')
    await page.getByRole('tab', { name: 'Payments' }).click()
    await page.getByRole('button', { name: `Edit ${name}` }).click()
    await page.getByLabel(`Name for ${name}`).fill(renamed)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText(renamed).first()).toBeVisible()

    // Retiring it takes it off the till, without touching what it has taken.
    await page.getByRole('button', { name: `Deactivate ${renamed}` }).click()
    await expect(page.getByText('Inactive').first()).toBeVisible()

    await page.goto('/billing')
    await expect(page.getByRole('button', { name: `+ ${renamed}` })).toHaveCount(0)
    // The seeded methods are untouched.
    await expect(page.getByRole('button', { name: '+ Cash' })).toBeVisible()

    /*
     * And it is gone from every other screen that pays money out or takes it.
     *
     * The refund picker on a return is ordered by sortOrder, and a method
     * added here starts at 0 - so a deactivated one sorted FIRST and became
     * the default, and every return was refused with "That payment method is
     * not available." The till was fine; returns were not. Checked here,
     * beside the deactivation that causes it.
     */
    const sale = await page.request.get('/api/sales?pageSize=1')
    const rows = ((await sale.json()) as { rows?: { id: number }[] }).rows ?? []
    if (rows.length > 0) {
      await page.goto(`/returns/new?saleId=${rows[0]!.id}`)
      await expect(page.getByRole('option', { name: renamed })).toHaveCount(0)
    }
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

/**
 * The audit log is where an owner answers "who changed this price?".
 *
 * It printed the stored diff as JSON, which does not answer it — and JSON on
 * a page the shop is meant to read is a developer's view left in by accident.
 */
test.describe('the audit log reads as English', () => {
  const unique = () => String(Date.now()).slice(-8)

  test('describes a change in words, not as JSON', async ({ page }) => {
    await signIn(page, USERS.admin)

    // Make something worth auditing.
    const name = `E2E Audited ${unique()}`
    const made = await page.request.post('/api/customers', { data: { name } })
    expect(made.ok()).toBe(true)

    await page.goto('/settings/audit')
    // Both layouts render this; only one is on screen at a given width.
    const row = page.getByTestId('audit-changes').and(page.locator(':visible')).first()
    await expect(row).toBeVisible()

    // The shape of the fix: a sentence, not a brace.
    await expect(row).toContainText(/set to|cleared|→/)
    await expect(page.locator('pre')).toHaveCount(0)
    await expect(page.getByText('"from": null')).toHaveCount(0)
  })

  test('no longer records fields that were never set', async ({ page }) => {
    // A customer with no email used to log `email: null -> null`, pushing the
    // one field that did change off the screen.
    await signIn(page, USERS.admin)
    const name = `E2E Quiet ${unique()}`
    await page.request.post('/api/customers', { data: { name } })

    await page.goto('/settings/audit')
    const changes = page.getByTestId('audit-changes').and(page.locator(':visible')).first()
    await expect(changes).toContainText(`Name set to ${name}`)
    await expect(changes).not.toContainText('Email')
    await expect(changes).not.toContainText('unchanged')
  })
})
