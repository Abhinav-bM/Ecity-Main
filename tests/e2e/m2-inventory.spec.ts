import { expect, test, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow, isMobileProject, signIn, USERS } from './helpers'

/** M2 — inventory core. Runs at every viewport. Requires a seeded database. */

/** 14–17 digits, unique per run. */
const imei = (suffix: number) => String(35_000_000_000_000 + (Date.now() % 1_000_000) * 10 + suffix)

async function createMobileProduct(page: Page, name: string) {
  await page.goto('/products/new')
  await page.getByRole('textbox', { name: 'Product name', exact: true }).fill(name)
  await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption({ label: 'Mobiles (IMEI)' })
  await page.getByRole('button', { name: 'Create product' }).click()
  await expect(page).toHaveURL(/\/products$/)
}

test.describe('as admin', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  for (const [path, heading] of [
    ['/products', 'Products'],
    ['/devices', 'Devices'],
  ] as const) {
    test(`${path} renders and fits the viewport`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
      await expectNoHorizontalOverflow(page)
    })
  }

  test('the device page shows the five main types with GLOBAL split by NEW CUT', async ({
    page,
  }) => {
    await page.goto('/devices')
    for (const label of ['NEW', 'USED', 'ER', 'ACT', 'GLOBAL', 'GLOBAL · NEW CUT']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
    }
  })

  test('creates a product and finds it by search', async ({ page }) => {
    const name = `E2E Phone ${Date.now()}`
    await createMobileProduct(page, name)
    await page.getByLabel('Search products').fill(name)
    await page.getByRole('button', { name: 'Search' }).click()
    await expect(page.getByRole('link', { name }).and(page.locator(':visible'))).toBeVisible()
  })

  test('registers a device and shows it with its classification', async ({ page }) => {
    const name = `E2E Device Model ${Date.now()}`
    await createMobileProduct(page, name)

    const one = imei(1)
    await page.goto('/devices/new')
    await page.getByRole('textbox', { name: 'IMEI', exact: true }).fill(one)
    await page.getByRole('combobox', { name: 'Product', exact: true }).selectOption({ label: name })
    await page.getByRole('button', { name: 'USED', exact: true }).click()
    await page.getByRole('button', { name: 'Register device' }).click()

    await expect(page).toHaveURL(/\/devices$/)
    await page.getByLabel('Search devices').fill(one)
    await page.getByRole('button', { name: 'Search' }).click()
    await expect(page.getByText(one).and(page.locator(':visible')).first()).toBeVisible()
  })

  test('NEW CUT is offered only for GLOBAL — the rule made visible', async ({ page }) => {
    await page.goto('/devices/new')

    // Not offered for the other four types.
    for (const type of ['NEW', 'USED', 'ER', 'ACT']) {
      await page.getByRole('button', { name: type, exact: true }).click()
      await expect(page.getByText('NEW CUT applies only to GLOBAL devices.')).toBeVisible()
      await expect(page.getByRole('checkbox', { name: 'NEW CUT' })).toBeHidden()
    }

    // Offered for GLOBAL.
    await page.getByRole('button', { name: 'GLOBAL', exact: true }).click()
    await expect(page.getByRole('checkbox', { name: 'NEW CUT' })).toBeVisible()
    await page.getByRole('checkbox', { name: 'NEW CUT' }).click()
    await expect(page.getByRole('textbox', { name: 'NEW CUT details', exact: true })).toBeVisible()
  })

  test('a GLOBAL + NEW CUT device shows both badges, not a sixth type', async ({ page }) => {
    const name = `E2E Global ${Date.now()}`
    await createMobileProduct(page, name)

    const one = imei(2)
    await page.goto('/devices/new')
    await page.getByRole('textbox', { name: 'IMEI', exact: true }).fill(one)
    await page.getByRole('combobox', { name: 'Product', exact: true }).selectOption({ label: name })
    await page.getByRole('button', { name: 'GLOBAL', exact: true }).click()
    await page.getByRole('checkbox', { name: 'NEW CUT' }).click()
    await page.getByRole('button', { name: 'Register device' }).click()
    await expect(page).toHaveURL(/\/devices$/)

    await page.getByLabel('Search devices').fill(one)
    await page.getByRole('button', { name: 'Search' }).click()
    await page.getByText(one).and(page.locator(':visible')).first().click()

    await expect(page.getByText('GLOBAL', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('NEW CUT', { exact: true }).first()).toBeVisible()
  })

  test('refuses a duplicate IMEI and names the conflicting device', async ({ page }) => {
    const name = `E2E Dup ${Date.now()}`
    await createMobileProduct(page, name)
    const dup = imei(3)

    for (const attempt of [1, 2]) {
      await page.goto('/devices/new')
      await page.getByRole('textbox', { name: 'IMEI', exact: true }).fill(dup)
      await page.getByRole('combobox', { name: 'Product', exact: true }).selectOption({ label: name })
      await page.getByRole('button', { name: 'Register device' }).click()

      if (attempt === 2) {
        await expect(page.locator('[data-slot="alert"]')).toContainText(/already belongs to/i)
      } else {
        await expect(page).toHaveURL(/\/devices$/)
      }
    }
  })

  test('rejects an IMEI that is not 14-17 digits', async ({ page }) => {
    const name = `E2E BadImei ${Date.now()}`
    await createMobileProduct(page, name)

    await page.goto('/devices/new')
    await page.getByRole('textbox', { name: 'IMEI', exact: true }).fill('12345')
    await page.getByRole('combobox', { name: 'Product', exact: true }).selectOption({ label: name })
    await page.getByRole('button', { name: 'Register device' }).click()
    await expect(page.locator('[data-slot="alert"]')).toContainText(/not a valid IMEI/i)
  })

  test('the device page opens its append-only history', async ({ page }) => {
    const name = `E2E History ${Date.now()}`
    await createMobileProduct(page, name)
    const one = imei(4)

    await page.goto('/devices/new')
    await page.getByRole('textbox', { name: 'IMEI', exact: true }).fill(one)
    await page.getByRole('combobox', { name: 'Product', exact: true }).selectOption({ label: name })
    await page.getByRole('button', { name: 'Register device' }).click()
    await expect(page).toHaveURL(/\/devices$/)

    await page.getByLabel('Search devices').fill(one)
    await page.getByRole('button', { name: 'Search' }).click()
    await page.getByText(one).and(page.locator(':visible')).first().click()

    // shadcn's CardTitle is a div, not a heading element, so assert on text.
    await expect(page.getByText('History', { exact: true })).toBeVisible()
    // "Purchased" is also a detail label, so scope to the timeline entry.
    await expect(page.locator('ol').getByText('Purchased', { exact: true })).toBeVisible()
    await expect(page.getByText('Identifiers', { exact: true })).toBeVisible()
    await expect(page.getByText('Primary', { exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})

test.describe('permissions', () => {
  test('staff can see stock but not what it cost', async ({ page }) => {
    await signIn(page, USERS.staff)
    await page.goto('/devices')
    await expect(page.getByRole('heading', { name: 'Devices', level: 1 })).toBeVisible()
    // The Cost column belongs to inventory.view_cost, which staff lack.
    await expect(page.getByRole('columnheader', { name: 'Cost' })).toBeHidden()
  })

  test('staff cannot register a device or add a product', async ({ page }) => {
    await signIn(page, USERS.staff)
    await page.goto('/devices/new')
    await expect(page).toHaveURL(/\/devices$/)
    await page.goto('/products/new')
    await expect(page).toHaveURL(/\/products$/)
  })

  test('inventory appears in the navigation for every role', async ({ page }, testInfo) => {
    await signIn(page, USERS.staff)
    if (isMobileProject(testInfo.project.name)) {
      await page.getByRole('button', { name: 'Open navigation menu' }).click()
    }
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav.getByRole('link', { name: 'Devices' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Products' })).toBeVisible()
  })
})

test.describe('phone layout', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!isMobileProject(testInfo.project.name), 'phones only')
  })

  test('device and product lists become cards', async ({ page }) => {
    await signIn(page, USERS.admin)
    for (const [path, testId] of [
      ['/devices', 'device-table'],
      ['/products', 'product-table'],
    ] as const) {
      await page.goto(path)
      await expect(page.getByTestId(testId)).toBeHidden()
      await expectNoHorizontalOverflow(page)
    }
  })
})
