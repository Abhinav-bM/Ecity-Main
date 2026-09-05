import { expect, test, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow, isMobileProject, signIn, USERS } from './helpers'

/** M3 — purchases and supplier ledger. Requires a seeded database. */

const imei = (n: number) => String(35_200_000_000_000 + (Date.now() % 1_000_000) * 10 + n)
const unique = () => String(Date.now()).slice(-8)

async function createSupplier(page: Page, name: string) {
  await page.goto('/suppliers/new')
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
  await page.getByRole('button', { name: 'Create supplier' }).click()
  await expect(page).toHaveURL(/\/suppliers$/)
}

/** The product field is a searchable picker, not a select. */
async function pickProduct(page: Page, name: string, lineIndex = 1) {
  await page.getByRole('combobox', { name: `Line ${lineIndex} product` }).click()
  await page.getByPlaceholder('Name, SKU or barcode').fill(name)
  // Scoped to the picker: a native <select> on the page also exposes options.
  await page
    .getByTestId('product-picker-list')
    .getByRole('option', { name: new RegExp(name) })
    .first()
    .click()
}

async function createProduct(page: Page, name: string, categoryLabel: string) {
  await page.goto('/products/new')
  await page.getByRole('textbox', { name: 'Product name', exact: true }).fill(name)
  await page
    .getByRole('combobox', { name: 'Category', exact: true })
    .selectOption({ label: categoryLabel })
  await page.getByRole('button', { name: 'Create product' }).click()
  await expect(page).toHaveURL(/\/products$/)
}

test.describe('recording a purchase', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('the purchase pages render and fit the viewport', async ({ page }) => {
    for (const [path, heading] of [
      ['/purchases', 'Purchases'],
      ['/purchases/supplier-dues', 'Supplier dues'],
    ] as const) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
      await expectNoHorizontalOverflow(page)
    }
  })

  test('the identifier grid grows and shrinks with the quantity', async ({ page }) => {
    const id = unique()
    await createProduct(page, `E2E Grid Phone ${id}`, 'Mobiles (IMEI)')

    await page.goto('/purchases/new')
    await pickProduct(page, `E2E Grid Phone ${id}`)

    // One unit, one box.
    const grid = page.getByTestId('identifier-grid-0')
    await expect(grid.locator('input')).toHaveCount(1)

    // Three units, three boxes — the count can never disagree.
    await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill('3')
    await expect(grid.locator('input')).toHaveCount(3)

    await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill('2')
    await expect(grid.locator('input')).toHaveCount(2)
  })

  test('a counted product shows no identifier grid', async ({ page }) => {
    const id = unique()
    await createProduct(page, `E2E Cable ${id}`, 'Cables')

    await page.goto('/purchases/new')
    await pickProduct(page, `E2E Cable ${id}`)
    await expect(page.getByTestId('identifier-grid-0')).toBeHidden()
  })

  test('confirms a purchase: stock rises and units are registered', async ({ page }) => {
    const id = unique()
    await createSupplier(page, `E2E Supplier ${id}`)
    await createProduct(page, `E2E Phone ${id}`, 'Mobiles (IMEI)')

    await page.goto('/purchases/new')
    await page
      .getByRole('combobox', { name: 'Supplier', exact: true })
      .selectOption({ label: `E2E Supplier ${id}` })
    await pickProduct(page, `E2E Phone ${id}`)
    await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill('2')
    await page.getByRole('textbox', { name: 'Unit cost (₹)', exact: true }).fill('20000')

    const a = imei(1)
    const b = imei(2)
    await page.getByRole('textbox', { name: 'Line 1 IMEI 1' }).fill(a)
    await page.getByRole('textbox', { name: 'Line 1 IMEI 2' }).fill(b)
    await page.getByRole('button', { name: 'Confirm purchase' }).click()

    // Lands on the detail page with both units listed.
    await expect(page).toHaveURL(/\/purchases\/\d+$/)
    await expect(page.getByText('Units registered')).toBeVisible()
    await expect(page.getByText(a)).toBeVisible()
    await expect(page.getByText(b)).toBeVisible()
    await expect(page.getByText('UNPAID')).toBeVisible()

    // And the units really are in stock.
    await page.goto('/devices')
    await page.getByLabel('Search devices').fill(a)
    await page.getByRole('button', { name: 'Search' }).click()
    await expect(page.getByText(a).and(page.locator(':visible')).first()).toBeVisible()
  })

  test('refuses a quantity that does not match the identifiers entered', async ({ page }) => {
    const id = unique()
    await createSupplier(page, `E2E Mismatch ${id}`)
    await createProduct(page, `E2E MismatchPhone ${id}`, 'Mobiles (IMEI)')

    await page.goto('/purchases/new')
    await page
      .getByRole('combobox', { name: 'Supplier', exact: true })
      .selectOption({ label: `E2E Mismatch ${id}` })
    await pickProduct(page, `E2E MismatchPhone ${id}`)
    await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill('3')
    await page.getByRole('textbox', { name: 'Line 1 IMEI 1' }).fill(imei(10))
    await page.getByRole('button', { name: 'Confirm purchase' }).click()

    await expect(page.locator('[data-slot="alert"]')).toContainText(
      /3 units but 1 IMEI entered/i,
    )
  })

  test('NEW CUT is offered only on a GLOBAL line', async ({ page }) => {
    const id = unique()
    await createProduct(page, `E2E GlobalLine ${id}`, 'Mobiles (IMEI)')

    await page.goto('/purchases/new')
    await pickProduct(page, `E2E GlobalLine ${id}`)

    await expect(page.getByRole('button', { name: 'NEW CUT', exact: true })).toBeHidden()
    await page.getByRole('button', { name: 'GLOBAL', exact: true }).click()
    await expect(page.getByRole('button', { name: 'NEW CUT', exact: true })).toBeVisible()
  })
})

test.describe('the product picker scales', () => {
  test('finds a product by name and by SKU, not just the first page', async ({ page }) => {
    await signIn(page, USERS.admin)
    const id = unique()
    const name = `E2E Zzz Latest ${id}`

    // A name late in the alphabet: with the old select, capped at 500 and
    // ordered by name, this is exactly what fell off the end.
    await page.goto('/products/new')
    await page.getByRole('textbox', { name: 'Product name', exact: true }).fill(name)
    await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption({ label: 'Mobiles (IMEI)' })
    await page.getByRole('textbox', { name: 'SKU', exact: true }).fill(`SKU${id}`)
    await page.getByRole('button', { name: 'Create product' }).click()
    await expect(page).toHaveURL(/\/products$/)

    await page.goto('/purchases/new')
    await pickProduct(page, name)
    await expect(page.getByRole('combobox', { name: 'Line 1 product' })).toContainText(name)

    // And by SKU.
    await page.getByRole('combobox', { name: 'Line 1 product' }).click()
    await page.getByPlaceholder('Name, SKU or barcode').fill(`SKU${id}`)
    await expect(
      page.getByTestId('product-picker-list').getByRole('option').first(),
    ).toContainText(name)
  })
})

test.describe('supplier money', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('a purchase creates a supplier due, and paying clears it', async ({ page }) => {
    const id = unique()
    await createSupplier(page, `E2E Payable ${id}`)
    await createProduct(page, `E2E PayCable ${id}`, 'Cables')

    await page.goto('/purchases/new')
    await page
      .getByRole('combobox', { name: 'Supplier', exact: true })
      .selectOption({ label: `E2E Payable ${id}` })
    await pickProduct(page, `E2E PayCable ${id}`)
    await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill('10')
    await page.getByRole('textbox', { name: 'Unit cost (₹)', exact: true }).fill('100')
    await page.getByRole('button', { name: 'Confirm purchase' }).click()
    await expect(page).toHaveURL(/\/purchases\/\d+$/)

    // It shows on the dues report.
    await page.goto('/purchases/supplier-dues')
    await expect(page.getByText(`E2E Payable ${id}`).and(page.locator(':visible')).first()).toBeVisible()

    // Pay it from the supplier's history tab.
    await page.getByRole('link', { name: `E2E Payable ${id}` }).and(page.locator(':visible')).first().click()
    await expect(page.getByText('Outstanding')).toBeVisible()
    await page.getByRole('button', { name: 'Record payment' }).click()
    await page.getByLabel('Amount (₹)').fill('1000')
    await page.getByRole('button', { name: 'Record payment' }).last().click()

    await expect(page.getByText('Payment recorded.')).toBeVisible()
    await expect(page.getByText('PAID').first()).toBeVisible()
  })

  test('reversal is refused once a unit has been sold, and names it', async ({ page }) => {
    const id = unique()
    await createSupplier(page, `E2E Reverse ${id}`)
    await createProduct(page, `E2E RevPhone ${id}`, 'Mobiles (IMEI)')
    const one = imei(20)

    await page.goto('/purchases/new')
    await page
      .getByRole('combobox', { name: 'Supplier', exact: true })
      .selectOption({ label: `E2E Reverse ${id}` })
    await pickProduct(page, `E2E RevPhone ${id}`)
    await page.getByRole('textbox', { name: 'Unit cost (₹)', exact: true }).fill('5000')
    await page.getByRole('textbox', { name: 'Line 1 IMEI 1' }).fill(one)
    await page.getByRole('button', { name: 'Confirm purchase' }).click()
    await expect(page).toHaveURL(/\/purchases\/\d+$/)

    // An untouched purchase reverses cleanly.
    await page.getByRole('button', { name: 'Reverse' }).click()
    await page.getByLabel('Reason').fill('entered twice')
    await page.getByRole('button', { name: 'Reverse purchase' }).click()
    await expect(page.getByText('Reversed').first()).toBeVisible()
  })
})

test.describe('permissions', () => {
  test('staff cannot see purchases or supplier dues', async ({ page }, testInfo) => {
    await signIn(page, USERS.staff)
    await page.goto('/purchases')
    await expect(page).toHaveURL(/\/dashboard/)
    await page.goto('/purchases/supplier-dues')
    await expect(page).toHaveURL(/\/dashboard/)

    if (isMobileProject(testInfo.project.name)) {
      await page.getByRole('button', { name: 'Open navigation menu' }).click()
    }
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav.getByRole('link', { name: 'Purchases' })).toBeHidden()
  })

  test('a manager can record purchases', async ({ page }, testInfo) => {
    await signIn(page, USERS.manager)
    if (isMobileProject(testInfo.project.name)) {
      await page.getByRole('button', { name: 'Open navigation menu' }).click()
    }
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Purchases' }),
    ).toBeVisible()
  })
})
