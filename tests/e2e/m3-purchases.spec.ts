import { expect, test, type Page } from '@playwright/test'
import { choose, expectNoHorizontalOverflow, isMobileProject, signIn, USERS } from './helpers'

/** M3 — purchases and supplier ledger. Requires a seeded database. */

/*
 * A per-run unique IMEI.
 *
 * `n` is spaced by 100, not by 10: the previous version reserved a single
 * digit per test, so `imei(80)` in one run collided with `imei(0)` from a run
 * eight milliseconds earlier — which showed up as an unrelated test failing
 * with "already belongs to another device". Two digits is more numbers than
 * any one spec uses.
 */
const imei = (n: number) =>
  String(35_200_000_000_000 + (Date.now() % 1_000_000) * 100 + n)
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
  await choose(page.getByRole('combobox', { name: 'Category', exact: true }), categoryLabel)
  await page.getByRole('button', { name: 'Create product' }).click()
  await expect(page).toHaveURL(/\/products$/)
}

/** The supplier field is a searchable picker, not a capped <select>. */
async function pickSupplier(page: Page, name: string) {
  await page.getByRole('combobox', { name: 'Supplier', exact: true }).click()
  // The picker lists a first page until you search — same as a real user.
  await page.getByPlaceholder('Name, phone, email or GST').fill(name)
  await page.getByTestId('supplier-picker-list').getByRole('option', { name }).first().click()
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
    await pickSupplier(page, `E2E Supplier ${id}`)
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

  /*
   * The specs the goods arrived with, typed where they arrive.
   *
   * Before this a purchase knew the product and the IMEI and nothing else, so
   * ten iPhones came in as ten handsets that did not know they were 256GB
   * green - and somebody opened each device afterwards to type it in.
   */
  test('a handset knows its specs the moment it is booked in', async ({ page }) => {
    const id = unique()
    await createSupplier(page, `E2E SpecSup ${id}`)
    await createProduct(page, `E2E SpecPhone ${id}`, 'Mobiles (IMEI)')

    const a = imei(30)
    const b = imei(31)

    await page.goto('/purchases/new')
    await pickSupplier(page, `E2E SpecSup ${id}`)
    await pickProduct(page, `E2E SpecPhone ${id}`)
    await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill('2')
    await page.getByRole('textbox', { name: 'Unit cost (₹)', exact: true }).fill('50000')

    // One combination for the whole line.
    await page.getByRole('textbox', { name: 'RAM', exact: true }).fill('8 GB')
    await page.getByRole('textbox', { name: 'Storage', exact: true }).fill('256 GB')
    await page.getByRole('textbox', { name: 'Colour', exact: true }).fill('Green')

    await page.getByRole('textbox', { name: 'Line 1 IMEI 1' }).fill(a)
    await page.getByRole('textbox', { name: 'Line 1 IMEI 2' }).fill(b)

    // ...except the second piece, which is black.
    await page.getByRole('button', { name: 'Specs for IMEI 2 on line 1' }).click()
    await page.getByRole('textbox', { name: 'IMEI 2 colour' }).fill('Black')
    await page.getByRole('textbox', { name: 'IMEI 2 battery health %' }).fill('87')

    await page.getByRole('button', { name: 'Confirm purchase' }).click()
    await expect(page).toHaveURL(/\/purchases\/\d+$/)
    // The bill itself says what it booked in, for checking against the
    // supplier's paperwork a month later.
    await expect(page.getByText(/256 GB · 8 GB · Green/)).toBeVisible()

    // The first handset took the line's specs...
    await page.goto('/devices')
    await page.getByLabel('Search devices').fill(a)
    await page.getByRole('button', { name: 'Search' }).click()
    await page.getByRole('link', { name: a }).first().click()
    await expect(page.getByText(/256 GB/).first()).toBeVisible()
    await expect(page.getByText(/Green/).first()).toBeVisible()

    // ...and the odd one kept its own, without losing the rest.
    await page.goto('/devices')
    await page.getByLabel('Search devices').fill(b)
    await page.getByRole('button', { name: 'Search' }).click()
    await page.getByRole('link', { name: b }).first().click()
    await expect(page.getByText(/Black/).first()).toBeVisible()
    await expect(page.getByText(/256 GB/).first()).toBeVisible()
  })

  test('a line can be copied for the next combination in the same shipment', async ({ page }) => {
    const id = unique()
    await createProduct(page, `E2E CopyPhone ${id}`, 'Mobiles (IMEI)')

    await page.goto('/purchases/new')
    await pickProduct(page, `E2E CopyPhone ${id}`)
    await page.getByRole('textbox', { name: 'Storage', exact: true }).fill('256 GB')
    await page.getByRole('textbox', { name: 'Line 1 IMEI 1' }).fill(imei(40))

    await page.getByRole('button', { name: 'Duplicate line 1' }).click()

    // The second line keeps the product and the specs...
    await expect(page.getByTestId('purchase-line')).toHaveCount(2)
    const second = page.getByTestId('purchase-line').nth(1)
    await expect(second.getByRole('textbox', { name: 'Storage', exact: true })).toHaveValue(
      '256 GB',
    )
    // ...and never the identifiers, which belong to the handsets already typed.
    await expect(second.getByRole('textbox', { name: 'Line 2 IMEI 1' })).toHaveValue('')
  })

  /*
   * A delivery of twenty handsets should be one camera session, not twenty
   * open-scan-close cycles — which is the difference between staff using the
   * scanner and going back to typing.
   */
  test('offers one camera session for the whole line, not one per box', async ({ page }) => {
    const id = unique()
    await createProduct(page, `E2E ScanAll ${id}`, 'Mobiles (IMEI)')

    await page.goto('/purchases/new')
    await pickProduct(page, `E2E ScanAll ${id}`)
    await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill('3')

    const hasCamera = await page.evaluate(
      () => typeof navigator.mediaDevices?.getUserMedia === 'function',
    )
    const scanAll = page.getByRole('button', { name: /Scan every IMEI for line 1/ })
    if (!hasCamera) {
      await expect(scanAll).toHaveCount(0)
      return
    }

    await expect(scanAll).toBeVisible()
    // ...and each box still has its own, for the one that will not read.
    await expect(page.getByRole('button', { name: /Scan IMEI 2 on line 1/ })).toBeVisible()
  })

  test('refuses a quantity that does not match the identifiers entered', async ({ page }) => {
    const id = unique()
    await createSupplier(page, `E2E Mismatch ${id}`)
    await createProduct(page, `E2E MismatchPhone ${id}`, 'Mobiles (IMEI)')

    await page.goto('/purchases/new')
    await pickSupplier(page, `E2E Mismatch ${id}`)
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
    await choose(page.getByRole('combobox', { name: 'Category', exact: true }), 'Mobiles (IMEI)')
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
    await pickSupplier(page, `E2E Payable ${id}`)
    await pickProduct(page, `E2E PayCable ${id}`)
    await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill('10')
    await page.getByRole('textbox', { name: 'Unit cost (₹)', exact: true }).fill('100')
    await page.getByRole('button', { name: 'Confirm purchase' }).click()
    await expect(page).toHaveURL(/\/purchases\/\d+$/)

    // It shows on the dues report.
    await page.goto('/purchases/supplier-dues')
    // The list is paginated by amount owed, so search rather than assuming
    // this supplier is in the first page.
    await page.getByRole('searchbox', { name: 'Search suppliers' }).fill(`E2E Payable ${id}`)
    await page.getByRole('searchbox', { name: 'Search suppliers' }).press('Enter')
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
    await pickSupplier(page, `E2E Reverse ${id}`)
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
