import { expect, test, type Page } from '@playwright/test'
import { choose, expectNoHorizontalOverflow, isMobileProject, signIn, USERS } from './helpers'

/** M6 — returns, inspection, trade-in and correcting a device. */

const unique = () => String(Date.now()).slice(-8)
const imei = (n: number) => String(35_700_000_000_000 + (Date.now() % 1_000_000) * 10 + n)

async function createProduct(page: Page, name: string, category: string, price: string) {
  await page.goto('/products/new')
  await page.getByRole('textbox', { name: 'Product name', exact: true }).fill(name)
  await choose(page.getByRole('combobox', { name: 'Category', exact: true }), category)
  await page.getByRole('textbox', { name: 'Selling price (₹)', exact: true }).fill(price)
  await page.getByRole('textbox', { name: 'HSN code', exact: true }).fill('8517')
  await page.getByRole('button', { name: 'Create product' }).click()
  await expect(page).toHaveURL(/\/products$/)
}

async function purchase(page: Page, opts: {
  supplier: string
  product: string
  quantity: string
  identifiers?: string[]
  mainType?: string
}) {
  await page.goto('/suppliers/new')
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(opts.supplier)
  await page.getByRole('button', { name: 'Create supplier' }).click()
  await expect(page).toHaveURL(/\/suppliers$/)

  await page.goto('/purchases/new')
  await page.getByRole('combobox', { name: 'Supplier', exact: true }).click()
  await page.getByPlaceholder('Name, phone, email or GST').fill(opts.supplier)
  await page.getByTestId('supplier-picker-list').getByRole('option', { name: opts.supplier }).first().click()
  await page.getByRole('combobox', { name: 'Line 1 product' }).click()
  await page.getByPlaceholder('Name, SKU or barcode').fill(opts.product)
  await page.getByTestId('product-picker-list').getByRole('option', { name: new RegExp(opts.product) }).first().click()
  await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill(opts.quantity)
  await page.getByRole('textbox', { name: 'Unit cost (₹)', exact: true }).fill('1000')
  if (opts.mainType) await page.getByRole('button', { name: opts.mainType, exact: true }).click()
  for (const [i, value] of (opts.identifiers ?? []).entries()) {
    await page.getByRole('textbox', { name: `Line 1 IMEI ${i + 1}` }).fill(value)
  }
  await page.getByRole('button', { name: 'Confirm purchase' }).click()
  await expect(page).toHaveURL(/\/purchases\/\d+$/)
}

/** Bill one item and return the sale's URL. */
async function sell(page: Page, product: string) {
  await page.goto('/billing')
  await page.getByRole('textbox', { name: 'Scan or search' }).fill(product)
  await page.getByTestId('bill-search-results').getByRole('button').first().click()
  await page.getByRole('button', { name: /^\+ Cash$/ }).click()
  /*
   * Saved from the keyboard rather than with a click. On a 320px viewport
   * Playwright's hit-testing puts the payment card at the button's click
   * point, even though the button renders clear and enabled and the page has
   * no measurable horizontal overflow. Focus-and-Enter is a real user path -
   * M4 tests the whole till keyboard-only - and it exercises the same handler.
   */
  const saveBill = page.getByRole('button', { name: /^Save bill/ })
  await saveBill.scrollIntoViewIfNeeded()
  await saveBill.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/sales\/\d+$/)
  return page.url()
}

test.describe('taking a return', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('a returned accessory goes straight back into stock', async ({ page }) => {
    const id = unique()
    const name = `E2E Ret Cable ${id}`
    await createProduct(page, name, 'Cables', '500')
    await purchase(page, { supplier: `E2E RetSup ${id}`, product: name, quantity: '10' })
    const saleUrl = await sell(page, name)

    await page.goto(saleUrl)
    await page.getByRole('link', { name: 'Take a return' }).click()
    await expect(page).toHaveURL(/\/returns\/new\?saleId=\d+/)

    await page.getByRole('textbox', { name: /Return quantity/ }).first().fill('1')
    await page.getByRole('button', { name: 'Record return' }).click()
    await expect(page).toHaveURL(/\/returns\/\d+$/)
    await expect(page.getByText('What came back')).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('finds the bill by invoice number', async ({ page }) => {
    const id = unique()
    const name = `E2E Find Cable ${id}`
    await createProduct(page, name, 'Cables', '400')
    await purchase(page, { supplier: `E2E FindSup ${id}`, product: name, quantity: '5' })
    const saleUrl = await sell(page, name)
    await page.goto(saleUrl)
    const invoiceNumber = (await page.getByRole('heading', { level: 1 }).textContent())?.trim() ?? ''

    await page.goto('/returns/new')
    await page.getByRole('searchbox', { name: 'Find the bill' }).fill(invoiceNumber)
    await page.getByRole('button', { name: 'Find' }).click()
    await page.getByTestId('sale-hits').getByRole('button').first().click()
    await expect(page).toHaveURL(/saleId=\d+/)
    await expect(page.getByTestId('returnable-lines')).toBeVisible()
  })

  test('refuses to return more than remains', async ({ page }) => {
    const id = unique()
    const name = `E2E Over Cable ${id}`
    await createProduct(page, name, 'Cables', '300')
    await purchase(page, { supplier: `E2E OverSup ${id}`, product: name, quantity: '5' })
    const saleUrl = await sell(page, name)

    await page.goto(saleUrl)
    await page.getByRole('link', { name: 'Take a return' }).click()
    await page.getByRole('textbox', { name: /Return quantity/ }).first().fill('5')
    await page.getByRole('button', { name: 'Record return' }).click()
    await expect(page.locator('[data-slot="alert"]')).toContainText(/left to return/i)
  })
})

test.describe('a returned handset is not sellable until graded (FR-8.2)', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('lands in the inspection queue, and grading releases it', async ({ page }) => {
    const id = unique()
    const name = `E2E Insp Phone ${id}`
    const one = imei(1)
    await createProduct(page, name, 'Mobiles (IMEI)', '20000')
    await purchase(page, {
      supplier: `E2E InspSup ${id}`,
      product: name,
      quantity: '1',
      mainType: 'USED',
      identifiers: [one],
    })
    const saleUrl = await sell(page, name)

    await page.goto(saleUrl)
    await page.getByRole('link', { name: 'Take a return' }).click()
    await page.getByRole('textbox', { name: /Return quantity/ }).first().fill('1')
    await page.getByRole('button', { name: 'Record return' }).click()
    await expect(page).toHaveURL(/\/returns\/\d+$/)

    // It is waiting, and the till cannot see it.
    await page.goto('/returns/inspection')
    await expect(page.locator('[data-testid="inspection-row"]:visible').filter({ hasText: one })).toBeVisible()

    await page.goto('/billing')
    await page.getByRole('textbox', { name: 'Scan or search' }).fill(one)
    await expect(page.getByTestId('bill-search-results')).toHaveCount(0)

    // Grade it, and it comes back.
    await page.goto('/returns/inspection')
    await page.locator('[data-testid="inspection-row"]:visible').filter({ hasText: one }).getByRole('button', { name: 'Inspect' }).click()
    await page.getByRole('button', { name: 'Record inspection' }).click()
    await expect(page.locator('[data-testid="inspection-row"]:visible').filter({ hasText: one })).toHaveCount(0)

    await page.goto('/billing')
    await page.getByRole('textbox', { name: 'Scan or search' }).fill(one)
    await expect(page.getByTestId('bill-search-results')).toBeVisible()
  })

  test('a GLOBAL NEW CUT handset keeps its type through return and grading (FR-8.4)', async ({ page }) => {
    const id = unique()
    const name = `E2E Global Phone ${id}`
    const one = imei(2)
    await createProduct(page, name, 'Mobiles (IMEI)', '30000')

    await page.goto('/suppliers/new')
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(`E2E GlobalSup ${id}`)
    await page.getByRole('button', { name: 'Create supplier' }).click()
    await page.goto('/purchases/new')
    await page.getByRole('combobox', { name: 'Supplier', exact: true }).click()
    await page.getByPlaceholder('Name, phone, email or GST').fill(`E2E GlobalSup ${id}`)
    await page.getByTestId('supplier-picker-list').getByRole('option', { name: `E2E GlobalSup ${id}` }).first().click()
    await page.getByRole('combobox', { name: 'Line 1 product' }).click()
    await page.getByPlaceholder('Name, SKU or barcode').fill(name)
    await page.getByTestId('product-picker-list').getByRole('option', { name: new RegExp(name) }).first().click()
    await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill('1')
    await page.getByRole('textbox', { name: 'Unit cost (₹)', exact: true }).fill('20000')
    await page.getByRole('button', { name: 'GLOBAL', exact: true }).click()
    await page.getByRole('button', { name: 'NEW CUT', exact: true }).click()
    await page.getByRole('textbox', { name: 'Line 1 IMEI 1' }).fill(one)
    await page.getByRole('button', { name: 'Confirm purchase' }).click()
    await expect(page).toHaveURL(/\/purchases\/\d+$/)

    const saleUrl = await sell(page, name)
    await page.goto(saleUrl)
    await page.getByRole('link', { name: 'Take a return' }).click()
    await page.getByRole('textbox', { name: /Return quantity/ }).first().fill('1')
    await page.getByRole('button', { name: 'Record return' }).click()
    await expect(page).toHaveURL(/\/returns\/\d+$/)

    // Grade it USED — a condition, not a reclassification.
    await page.goto('/returns/inspection')
    const row = page.locator('[data-testid="inspection-row"]:visible').filter({ hasText: one })
    await expect(row).toContainText('GLOBAL')
    await row.getByRole('button', { name: 'Inspect' }).click()
    await choose(page.getByRole('combobox', { name: 'Condition' }), /Used/)
    await page.getByRole('button', { name: 'Record inspection' }).click()

    // Still GLOBAL, still NEW CUT.
    await page.goto('/devices')
    await page.getByRole('searchbox', { name: 'Search devices' }).fill(one)
    await page.keyboard.press('Enter')
    await page.getByRole('link', { name: new RegExp(one) }).first().click()
    await expect(page).toHaveURL(/\/devices\/\d+$/)
    // Scoped to the identity header: "GLOBAL" also appears in list rows and
    // summaries elsewhere on the page.
    const header = page.getByRole('main')
    await expect(header.getByText('GLOBAL', { exact: false }).first()).toBeVisible()
    await expect(header.getByText('NEW CUT', { exact: false }).first()).toBeVisible()
  })
})

test.describe('correcting a device', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('a NEW handset hidden from the till can be corrected and sold', async ({ page }) => {
    const id = unique()
    const name = `E2E Fix Phone ${id}`
    const one = imei(3)
    await createProduct(page, name, 'Mobiles (IMEI)', '25000')
    await purchase(page, {
      supplier: `E2E FixSup ${id}`,
      product: name,
      quantity: '1',
      mainType: 'NEW',
      identifiers: [one],
    })

    // NEW stock is billed elsewhere, so the till cannot see it.
    await page.goto('/billing')
    await page.getByRole('textbox', { name: 'Scan or search' }).fill(one)
    await expect(page.getByTestId('bill-search-results')).toHaveCount(0)

    await page.goto('/devices')
    await page.getByRole('searchbox', { name: 'Search devices' }).fill(one)
    await page.keyboard.press('Enter')
    await page.getByRole('link', { name: new RegExp(one) }).first().click()
    await page.getByRole('link', { name: 'Edit' }).click()
    await expect(page).toHaveURL(/\/devices\/\d+\/edit$/)

    await choose(page.getByRole('combobox', { name: 'Billed in' }), /ECITY/)
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page).toHaveURL(/\/devices\/\d+$/)

    // Now it reaches the counter.
    await page.goto('/billing')
    await page.getByRole('textbox', { name: 'Scan or search' }).fill(one)
    await expect(page.getByTestId('bill-search-results')).toBeVisible()
  })

  test('the correction shows in the device history, not silently', async ({ page }) => {
    const id = unique()
    const name = `E2E Hist Phone ${id}`
    const one = imei(4)
    await createProduct(page, name, 'Mobiles (IMEI)', '15000')
    await purchase(page, {
      supplier: `E2E HistSup ${id}`,
      product: name,
      quantity: '1',
      mainType: 'USED',
      identifiers: [one],
    })

    await page.goto('/devices')
    await page.getByRole('searchbox', { name: 'Search devices' }).fill(one)
    await page.keyboard.press('Enter')
    await page.getByRole('link', { name: new RegExp(one) }).first().click()
    await page.getByRole('link', { name: 'Edit' }).click()
    await page.getByRole('textbox', { name: 'Colour', exact: true }).fill('Midnight Blue')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page).toHaveURL(/\/devices\/\d+$/)
    // Twice, and that is the point: once as the device's colour, and once in
    // the recorded history showing it was corrected.
    await expect(page.getByText('Midnight Blue').first()).toBeVisible()
    await expect(page.getByText('Midnight Blue')).toHaveCount(2)
  })
})

test.describe('permissions', () => {
  test('staff can take a return but cannot grade one', async ({ page }) => {
    await signIn(page, USERS.staff)
    await page.goto('/returns/inspection')
    // They can see the queue...
    await expect(page.getByRole('heading', { name: 'Inspection queue' })).toBeVisible()
    // ...but releasing a handset back to sale is not theirs.
    await expect(page.getByRole('button', { name: 'Inspect' })).toHaveCount(0)
  })

  test('staff cannot correct a device', async ({ page }) => {
    await signIn(page, USERS.staff)
    await page.goto('/devices')
    await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0)
  })

  test('returns appear in the navigation', async ({ page }, testInfo) => {
    await signIn(page, USERS.admin)
    if (isMobileProject(testInfo.project.name)) {
      await page.getByRole('button', { name: 'Open navigation menu' }).click()
    }
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Returns' }),
    ).toBeVisible()
  })
})
