import { expect, test, type Page } from '@playwright/test'
import { choose, expectNoHorizontalOverflow, isMobileProject, signIn, USERS } from './helpers'

/** M6 — returns, inspection, trade-in and correcting a device. */

const unique = () => String(Date.now()).slice(-8)
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
  String(35_700_000_000_000 + (Date.now() % 1_000_000) * 100 + n)

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
    await page.getByRole('button', { name: 'Find', exact: true }).click()
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

test.describe('taking a phone in part-exchange', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  /*
   * FR-9.2, the whole exchange in one bill. The regression this guards: the
   * till showed the trade-in coming off the total but never sent it to the
   * server, so the bill saved with a balance the customer had already settled
   * with the handset - a receivable that would then be chased.
   */
  test('the old phone settles the bill and both ends are linked', async ({ page }) => {
    const id = unique()
    const selling = `E2E Swap New ${id}`
    const taking = `E2E Swap Old ${id}`
    const oldImei = imei(7)

    await createProduct(page, selling, 'Mobiles (IMEI)', '20000')
    await createProduct(page, taking, 'Mobiles (IMEI)', '8000')
    await purchase(page, {
      supplier: `E2E SwapSup ${id}`,
      product: selling,
      quantity: '1',
      mainType: 'GLOBAL',
      identifiers: [imei(6)],
    })

    await page.goto('/billing')
    await page.getByRole('textbox', { name: 'Scan or search' }).fill(selling)
    await page.getByTestId('bill-search-results').getByRole('button').first().click()
    // Priced at the till, as the counter does when the device carries no price.
    await page.getByRole('textbox', { name: 'Price (₹)', exact: true }).fill('20000')

    // Take the old handset in for the full 20,000, so cash never enters it.
    await page.getByRole('button', { name: 'Add' }).first().click()
    await page.getByRole('combobox', { name: 'Trade-in product' }).click()
    await page.getByPlaceholder('Name, SKU or barcode').fill(taking)
    await page
      .getByTestId('product-picker-list')
      .getByRole('option', { name: new RegExp(taking) })
      .first()
      .click()
    await page.getByRole('textbox', { name: 'IMEI / serial', exact: true }).fill(oldImei)
    await page.getByRole('textbox', { name: 'Agreed value (₹)', exact: true }).fill('20000')
    await page.getByRole('button', { name: 'Accept trade-in' }).click()
    await expect(page.getByText('20,000.00 allowed')).toBeVisible()

    const saveBill = page.getByRole('button', { name: /^Save bill/ })
    await saveBill.scrollIntoViewIfNeeded()
    await saveBill.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/sales\/\d+$/)

    // Nothing owing, and no credit terms on a bill that was settled in full.
    await expect(page.getByText('PAID')).toBeVisible()
    await expect(page.getByText('Outstanding')).toHaveCount(0)
    // The invoice shows it as settlement, under the full total.
    await expect(page.getByText(new RegExp(`Trade-in.*${oldImei}`))).toBeVisible()

    // And the old handset is stock at this branch with its own history.
    await page.goto('/devices')
    await page.getByRole('searchbox', { name: 'Search devices' }).fill(oldImei)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('link', { name: new RegExp(oldImei) }).first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
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
    /*
     * The correction has to be on the record, not just applied. M2's
     * placeholder timeline dumped the raw payload, so the new colour appeared
     * twice; M9 replaced that with a sentence naming the field that moved,
     * which is the same fact told better. The point of the test is unchanged:
     * the history shows it was corrected.
     */
    await expect(page.getByText('Midnight Blue').first()).toBeVisible()
    await expect(page.getByTestId('device-timeline')).toContainText('Reclassified: colour')
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
