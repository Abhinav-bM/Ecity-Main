import { expect, test, type Page } from '@playwright/test'
import { choose, expectNoHorizontalOverflow, isMobileProject, signIn, USERS } from './helpers'

/** M2 — inventory core. Runs at every viewport. Requires a seeded database. */

/** 14–17 digits, unique per run. */
/*
 * A per-run unique IMEI.
 *
 * `n` is spaced by 100, not by 10: the previous version reserved a single
 * digit per test, so `imei(80)` in one run collided with `imei(0)` from a run
 * eight milliseconds earlier — which showed up as an unrelated test failing
 * with "already belongs to another device". Two digits is more numbers than
 * any one spec uses.
 */
const imei = (suffix: number) =>
  String(35_000_000_000_000 + (Date.now() % 1_000_000) * 100 + suffix)

async function createProductIn(page: Page, name: string, categoryLabel: string) {
  await page.goto('/products/new')
  await page.getByRole('textbox', { name: 'Product name', exact: true }).fill(name)
  await choose(page.getByRole('combobox', { name: 'Category', exact: true }), categoryLabel)
  await page.getByRole('button', { name: 'Create product' }).click()
  await expect(page).toHaveURL(/\/products$/)
}

const createMobileProduct = (page: Page, name: string) =>
  createProductIn(page, name, 'Mobiles (IMEI)')

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
    await page.getByRole('combobox', { name: 'Product', exact: true }).click()
    await page.getByPlaceholder('Name, SKU or barcode').fill(name)
    await page.getByTestId('product-picker-list').getByRole('option', { name: new RegExp(name) }).first().click()
    await page.getByRole('button', { name: 'USED', exact: true }).click()
    await page.getByRole('button', { name: 'Add device' }).click()

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
    await page.getByRole('combobox', { name: 'Product', exact: true }).click()
    await page.getByPlaceholder('Name, SKU or barcode').fill(name)
    await page.getByTestId('product-picker-list').getByRole('option', { name: new RegExp(name) }).first().click()
    await page.getByRole('button', { name: 'GLOBAL', exact: true }).click()
    await page.getByRole('checkbox', { name: 'NEW CUT' }).click()
    await page.getByRole('button', { name: 'Add device' }).click()
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
      await page.getByRole('combobox', { name: 'Product', exact: true }).click()
    await page.getByPlaceholder('Name, SKU or barcode').fill(name)
    await page.getByTestId('product-picker-list').getByRole('option', { name: new RegExp(name) }).first().click()
      await page.getByRole('button', { name: 'Add device' }).click()

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
    await page.getByRole('combobox', { name: 'Product', exact: true }).click()
    await page.getByPlaceholder('Name, SKU or barcode').fill(name)
    await page.getByTestId('product-picker-list').getByRole('option', { name: new RegExp(name) }).first().click()
    await page.getByRole('button', { name: 'Add device' }).click()
    await expect(page.locator('[data-slot="alert"]')).toContainText(/not a valid IMEI/i)
  })

  test('the device page opens its append-only history', async ({ page }) => {
    const name = `E2E History ${Date.now()}`
    await createMobileProduct(page, name)
    const one = imei(4)

    await page.goto('/devices/new')
    await page.getByRole('textbox', { name: 'IMEI', exact: true }).fill(one)
    await page.getByRole('combobox', { name: 'Product', exact: true }).click()
    await page.getByPlaceholder('Name, SKU or barcode').fill(name)
    await page.getByTestId('product-picker-list').getByRole('option', { name: new RegExp(name) }).first().click()
    await page.getByRole('button', { name: 'Add device' }).click()
    await expect(page).toHaveURL(/\/devices$/)

    await page.getByLabel('Search devices').fill(one)
    await page.getByRole('button', { name: 'Search' }).click()
    await page.getByText(one).and(page.locator(':visible')).first().click()

    /*
     * M2 built a placeholder timeline; M9 replaced it with the real lifecycle
     * view, so the card is now "Its whole life" and each entry is a sentence
     * rather than a bare event name. What M2 cares about is unchanged: the
     * append-only history is on the page and starts with the purchase.
     */
    await expect(page.getByText('Its whole life', { exact: true })).toBeVisible()
    await expect(page.getByTestId('device-timeline')).toContainText('Purchased')
    await expect(page.getByText('Identifiers', { exact: true })).toBeVisible()
    await expect(page.getByText('Primary', { exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})

test.describe('completing FR-4.6 — every specified filter', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('the device list offers all six filters', async ({ page }) => {
    await page.goto('/devices')
    for (const label of ['Main type', 'Branch', 'Brand', 'Category', 'Status', 'Supplier']) {
      await expect(page.getByRole('combobox', { name: label, exact: true })).toBeVisible()
    }
  })

  test('filtering by status narrows the list', async ({ page }, testInfo) => {
    await page.goto('/devices')
    await choose(page.getByRole('combobox', { name: 'Status', exact: true }), 'Sold')
    await expect(page).toHaveURL(/status=SOLD/)

    // The table is the desktop layout; phones show cards instead.
    const container = isMobileProject(testInfo.project.name)
      ? page.getByTestId('device-cards')
      : page.getByTestId('device-table')
    const badges = container.getByText('Sold', { exact: true })
    const n = await badges.count()
    for (let i = 0; i < n; i++) await expect(badges.nth(i)).toBeVisible()
  })
})

test.describe('low stock (FR-4.7)', () => {
  test('the screen is reachable and explains itself when empty', async ({ page }) => {
    await signIn(page, USERS.admin)
    await page.goto('/inventory/low-stock')
    await expect(page.getByRole('heading', { name: 'Low stock', level: 1 })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('appears in the navigation', async ({ page }, testInfo) => {
    await signIn(page, USERS.admin)
    if (isMobileProject(testInfo.project.name)) {
      await page.getByRole('button', { name: 'Open navigation menu' }).click()
    }
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Low stock' }),
    ).toBeVisible()
  })
})

test.describe('product image (FR-4.2)', () => {
  test('is offered once the product exists, not before', async ({ page }) => {
    await signIn(page, USERS.admin)

    // Not on the create form - an attachment needs something to attach to.
    await page.goto('/products/new')
    await expect(page.getByText('Save it first, then add an image.')).toBeVisible()
    await expect(page.getByRole('button', { name: /Upload image/ })).toBeHidden()

    const name = `E2E Image ${Date.now()}`
    await createMobileProduct(page, name)
    await page.getByLabel('Search products').fill(name)
    await page.getByRole('button', { name: 'Search' }).click()
    await page.getByRole('link', { name }).and(page.locator(':visible')).first().click()

    await expect(page.getByRole('button', { name: 'Upload image' })).toBeVisible()
  })

  test('uploads an image and shows it back', async ({ page }) => {
    await signIn(page, USERS.admin)
    const name = `E2E Upload ${Date.now()}`
    await createMobileProduct(page, name)
    await page.getByLabel('Search products').fill(name)
    await page.getByRole('button', { name: 'Search' }).click()
    await page.getByRole('link', { name }).and(page.locator(':visible')).first().click()

    // A minimal valid PNG.
    await page.getByLabel('Product image file').setInputFiles({
      name: 'product.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    })

    await expect(page.getByText('Image updated.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Replace image' })).toBeVisible()
    await expect(page.locator('img[alt=""]')).toBeVisible()
  })

  test('refuses a file that is not an image', async ({ page }) => {
    await signIn(page, USERS.admin)
    const name = `E2E NotImage ${Date.now()}`
    await createMobileProduct(page, name)
    await page.getByLabel('Search products').fill(name)
    await page.getByRole('button', { name: 'Search' }).click()
    await page.getByRole('link', { name }).and(page.locator(':visible')).first().click()

    await page.getByLabel('Product image file').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not a picture'),
    })
    await expect(page.getByText(/must be a picture|Only JPEG/i)).toBeVisible()
  })
})

test.describe('battery health', () => {
  test('can be recorded on a used handset and shown back', async ({ page }) => {
    await signIn(page, USERS.admin)
    const name = `E2E Battery ${Date.now()}`
    await createMobileProduct(page, name)
    const one = imei(7)

    await page.goto('/devices/new')
    await page.getByRole('textbox', { name: 'IMEI', exact: true }).fill(one)
    await page.getByRole('combobox', { name: 'Product', exact: true }).click()
    await page.getByPlaceholder('Name, SKU or barcode').fill(name)
    await page.getByTestId('product-picker-list').getByRole('option', { name: new RegExp(name) }).first().click()
    await page.getByRole('button', { name: 'USED', exact: true }).click()
    await page.getByRole('textbox', { name: 'Battery health (%)', exact: true }).fill('87')
    await page.getByRole('button', { name: 'Add device' }).click()
    await expect(page).toHaveURL(/\/devices$/)

    await page.getByLabel('Search devices').fill(one)
    await page.getByRole('button', { name: 'Search' }).click()
    await page.getByText(one).and(page.locator(':visible')).first().click()
    await expect(page.getByText('87%').first()).toBeVisible()
  })

  test('is optional, so sealed new stock saves without it', async ({ page }) => {
    await signIn(page, USERS.admin)
    const name = `E2E NoBattery ${Date.now()}`
    await createMobileProduct(page, name)
    const one = imei(8)

    await page.goto('/devices/new')
    await page.getByRole('textbox', { name: 'IMEI', exact: true }).fill(one)
    await page.getByRole('combobox', { name: 'Product', exact: true }).click()
    await page.getByPlaceholder('Name, SKU or barcode').fill(name)
    await page.getByTestId('product-picker-list').getByRole('option', { name: new RegExp(name) }).first().click()
    await page.getByRole('button', { name: 'Add device' }).click()
    await expect(page).toHaveURL(/\/devices$/)
  })

  test('rejects an impossible percentage', async ({ page }) => {
    await signIn(page, USERS.admin)
    const name = `E2E BadBattery ${Date.now()}`
    await createMobileProduct(page, name)

    await page.goto('/devices/new')
    await page.getByRole('textbox', { name: 'IMEI', exact: true }).fill(imei(9))
    await page.getByRole('combobox', { name: 'Product', exact: true }).click()
    await page.getByPlaceholder('Name, SKU or barcode').fill(name)
    await page.getByTestId('product-picker-list').getByRole('option', { name: new RegExp(name) }).first().click()
    await page.getByRole('textbox', { name: 'Battery health (%)', exact: true }).fill('150')
    await page.getByRole('button', { name: 'Add device' }).click()
    await expect(page.getByText('Between 1 and 100.')).toBeVisible()
  })
})

test.describe('imei_slots — a setting, not a release', () => {
  async function setSlots(page: Page, value: string) {
    await page.goto('/settings/business')
    await page.getByRole('textbox', { name: 'IMEI fields per device' }).fill(value)
    await page.getByRole('button', { name: 'Save profile' }).click()
    await expect(page.getByText('Business profile saved.')).toBeVisible()
  }

  test('raising it adds IMEI fields with no deployment', async ({ page }) => {
    await signIn(page, USERS.admin)
    const name = `E2E DualSim ${Date.now()}`
    await createMobileProduct(page, name)

    // Do not assume the starting value - a previous run may have changed it.
    await setSlots(page, '1')

    await page.goto('/devices/new')
    await page.getByRole('combobox', { name: 'Product', exact: true }).click()
    await page.getByPlaceholder('Name, SKU or barcode').fill(name)
    await page.getByTestId('product-picker-list').getByRole('option', { name: new RegExp(name) }).first().click()
    await expect(page.getByRole('textbox', { name: 'IMEI', exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'IMEI 2', exact: true })).toBeHidden()

    await setSlots(page, '2')

    // Two fields now, no rebuild involved.
    await page.goto('/devices/new')
    await page.getByRole('combobox', { name: 'Product', exact: true }).click()
    await page.getByPlaceholder('Name, SKU or barcode').fill(name)
    await page.getByTestId('product-picker-list').getByRole('option', { name: new RegExp(name) }).first().click()
    await expect(page.getByRole('textbox', { name: 'IMEI 1', exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'IMEI 2', exact: true })).toBeVisible()

    // Leave the default in place for every other test.
    await setSlots(page, '1')
  })
})

test.describe('the manual path is secondary', () => {
  test('the devices page offers it as a secondary action, not the main one', async ({ page }) => {
    await signIn(page, USERS.admin)
    await page.goto('/devices')
    // Labelled "Add manually" — stock normally arrives through a purchase.
    await expect(page.getByRole('link', { name: 'Add manually' })).toBeVisible()
    await page.getByRole('link', { name: 'Add manually' }).click()
    await expect(page.getByText(/should be entered as a purchase/i)).toBeVisible()
  })
})

test.describe('non-phone electronics', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('a laptop asks for a serial number, not an IMEI', async ({ page }) => {
    const name = `E2E MacBook ${Date.now()}`
    await createProductIn(page, name, 'MacBooks (SERIAL)')

    await page.goto('/devices/new')
    await page.getByRole('combobox', { name: 'Product', exact: true }).click()
    await page.getByPlaceholder('Name, SKU or barcode').fill(name)
    await page.getByTestId('product-picker-list').getByRole('option', { name: new RegExp(name) }).first().click()
    await expect(page.getByRole('textbox', { name: 'Serial number', exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'IMEI', exact: true })).toBeHidden()
  })

  test('a laptop takes the same classification as a phone', async ({ page }) => {
    const name = `E2E Laptop ${Date.now()}`
    await createProductIn(page, name, 'Laptops (SERIAL)')
    const serial = `C02E2E${String(Date.now()).slice(-6)}`

    await page.goto('/devices/new')
    await page.getByRole('combobox', { name: 'Product', exact: true }).click()
    await page.getByPlaceholder('Name, SKU or barcode').fill(name)
    await page.getByTestId('product-picker-list').getByRole('option', { name: new RegExp(name) }).first().click()
    await page.getByRole('textbox', { name: 'Serial number', exact: true }).fill(serial)
    // ER applies to laptops too - the types are not mobile-only.
    await page.getByRole('button', { name: 'ER', exact: true }).click()
    await page.getByRole('button', { name: 'Add device' }).click()
    await expect(page).toHaveURL(/\/devices$/)

    await page.getByLabel('Search devices').fill(serial)
    await page.getByRole('button', { name: 'Search' }).click()
    await expect(page.getByText(serial).and(page.locator(':visible')).first()).toBeVisible()
  })

  test('a phone still refuses a letter-bearing identifier', async ({ page }) => {
    const name = `E2E StrictPhone ${Date.now()}`
    await createMobileProduct(page, name)

    await page.goto('/devices/new')
    await page.getByRole('combobox', { name: 'Product', exact: true }).click()
    await page.getByPlaceholder('Name, SKU or barcode').fill(name)
    await page.getByTestId('product-picker-list').getByRole('option', { name: new RegExp(name) }).first().click()
    await page.getByRole('textbox', { name: 'IMEI', exact: true }).fill('C02XY1234ABC')
    await page.getByRole('button', { name: 'Add device' }).click()
    await expect(page.locator('[data-slot="alert"]')).toContainText(/not a valid IMEI/i)
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
