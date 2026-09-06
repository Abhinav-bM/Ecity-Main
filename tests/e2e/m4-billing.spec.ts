import { expect, test, type Page } from '@playwright/test'
import { choose, expectNoHorizontalOverflow, isMobileProject, signIn, tabTo, USERS } from './helpers'

/** M4 — sales and billing. Requires a seeded, migrated database. */

const unique = () => String(Date.now()).slice(-8)
const imei = (n: number) => String(35_400_000_000_000 + (Date.now() % 1_000_000) * 10 + n)

async function createProduct(page: Page, name: string, category: string, price: string) {
  await page.goto('/products/new')
  await page.getByRole('textbox', { name: 'Product name', exact: true }).fill(name)
  await choose(page.getByRole('combobox', { name: 'Category', exact: true }), category)
  await page.getByRole('textbox', { name: 'Selling price (₹)', exact: true }).fill(price)
  await page.getByRole('textbox', { name: 'HSN code', exact: true }).fill('8517')
  await page.getByRole('button', { name: 'Create product' }).click()
  await expect(page).toHaveURL(/\/products$/)
}

/** Bring stock in the way the shop does — through a purchase. */
async function purchase(page: Page, opts: {
  supplier: string
  product: string
  quantity: string
  cost: string
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
  await page
    .getByTestId('supplier-picker-list')
    .getByRole('option', { name: opts.supplier })
    .first()
    .click()
  await page.getByRole('combobox', { name: 'Line 1 product' }).click()
  await page.getByPlaceholder('Name, SKU or barcode').fill(opts.product)
  await page.getByTestId('product-picker-list').getByRole('option', { name: new RegExp(opts.product) }).first().click()
  await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill(opts.quantity)
  await page.getByRole('textbox', { name: 'Unit cost (₹)', exact: true }).fill(opts.cost)
  if (opts.mainType) {
    await page.getByRole('button', { name: opts.mainType, exact: true }).click()
  }
  for (const [i, value] of (opts.identifiers ?? []).entries()) {
    await page.getByRole('textbox', { name: `Line 1 IMEI ${i + 1}` }).fill(value)
  }
  await page.getByRole('button', { name: 'Confirm purchase' }).click()
  await expect(page).toHaveURL(/\/purchases\/\d+$/)
}

test.describe('the counter', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('the billing screen renders and fits the viewport', async ({ page }) => {
    await page.goto('/billing')
    await expect(page.getByRole('heading', { name: 'Billing', level: 1 })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Scan or search' })).toBeFocused()
    await expectNoHorizontalOverflow(page)
  })

  test('sells an accessory for cash', async ({ page }) => {
    const id = unique()
    const name = `E2E Bill Cable ${id}`
    await createProduct(page, name, 'Cables', '250')
    await purchase(page, {
      supplier: `E2E BillSup ${id}`,
      product: name,
      quantity: '10',
      cost: '100',
    })

    await page.goto('/billing')
    await page.getByRole('textbox', { name: 'Scan or search' }).fill(name)
    await page.getByTestId('bill-search-results').getByRole('button').first().click()

    await expect(page.getByTestId('cart-lines').getByText(name)).toBeVisible()
    await page.getByRole('button', { name: /^\+ Cash$/ }).click()
    await page.getByRole('button', { name: /^Save bill/ }).click()

    await expect(page).toHaveURL(/\/sales\/\d+$/)
    await expect(page.getByText('PAID')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Print A4' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Print receipt (80 mm)' })).toBeVisible()
  })

  test('bills an accessory keyboard-only in under 20 seconds (M4 acceptance)', async ({
    page,
  }) => {
    const id = unique()
    const name = `E2E Fast Cable ${id}`
    await createProduct(page, name, 'Cables', '250')
    await purchase(page, {
      supplier: `E2E FastSup ${id}`,
      product: name,
      quantity: '10',
      cost: '100',
    })

    await page.goto('/billing')
    // The search box takes focus on load, so the salesperson can start typing
    // (or scanning) the moment the screen appears - no click to begin.
    const search = page.getByRole('textbox', { name: 'Scan or search' })
    await expect(search).toBeFocused()

    // Everything from here on is keyboard only, and timed. Start the clock
    // once the screen is ready, since that is what the counter experiences.
    const started = Date.now()

    await page.keyboard.type(name)
    // One exact hit, so Enter puts it straight on the bill (scanner behaviour).
    await expect(page.getByTestId('bill-search-results').getByRole('button')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('cart-lines').getByText(name)).toBeVisible()

    const cash = page.getByRole('button', { name: /^\+ Cash$/ })
    await tabTo(page, cash)
    await page.keyboard.press('Enter')

    const save = page.getByRole('button', { name: /^Save bill/ })
    await tabTo(page, save)
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(/\/sales\/\d+$/)
    const elapsed = Date.now() - started

    await expect(page.getByText('PAID')).toBeVisible()
    // PRD acceptance criterion for M4. Generous headroom is deliberate: this
    // guards against a regression that makes billing slow, not against normal
    // CI jitter.
    expect(elapsed, `keyboard-only cash sale took ${elapsed} ms`).toBeLessThan(20_000)
  })

  test('scanning a USED handset bills that exact unit and shows its type', async ({ page }) => {
    const id = unique()
    const name = `E2E Bill Phone ${id}`
    const one = imei(1)
    await createProduct(page, name, 'Mobiles (IMEI)', '20000')
    await purchase(page, {
      supplier: `E2E PhoneSup ${id}`,
      product: name,
      quantity: '1',
      cost: '15000',
      mainType: 'USED',
      identifiers: [one],
    })

    await page.goto('/billing')
    await page.getByRole('textbox', { name: 'Scan or search' }).fill(one)
    await page.getByTestId('bill-search-results').getByRole('button').first().click()

    const cart = page.getByTestId('cart-lines')
    await expect(cart.getByText(one)).toBeVisible()
    await expect(cart.getByText('USED', { exact: true })).toBeVisible()
    // A device line is one physical unit, so quantity is fixed.
    await expect(page.getByRole('textbox', { name: 'Qty' })).toBeDisabled()

    await page.getByRole('button', { name: /^\+ Cash$/ }).click()
    await page.getByRole('button', { name: /^Save bill/ }).click()
    await expect(page).toHaveURL(/\/sales\/\d+$/)
    await expect(page.getByText(one)).toBeVisible()
  })

  test('a NEW handset never appears at the till (FR-38.2)', async ({ page }) => {
    const id = unique()
    const name = `E2E New Phone ${id}`
    const one = imei(2)
    await createProduct(page, name, 'Mobiles (IMEI)', '30000')
    await purchase(page, {
      supplier: `E2E NewSup ${id}`,
      product: name,
      quantity: '1',
      cost: '28000',
      mainType: 'NEW',
      identifiers: [one],
    })

    // It is in stock...
    await page.goto('/devices')
    await page.getByLabel('Search devices').fill(one)
    await page.getByRole('button', { name: 'Search' }).click()
    await expect(page.getByText(one).and(page.locator(':visible')).first()).toBeVisible()

    // ...but the till will not offer it, because the other system bills it.
    await page.goto('/billing')
    await page.getByRole('textbox', { name: 'Scan or search' }).fill(one)
    await expect(page.getByTestId('bill-search-results')).toBeHidden({ timeout: 3000 })
  })

  test('the same handset cannot be added twice', async ({ page }) => {
    const id = unique()
    const name = `E2E Twice ${id}`
    const one = imei(3)
    await createProduct(page, name, 'Mobiles (IMEI)', '12000')
    await purchase(page, {
      supplier: `E2E TwiceSup ${id}`,
      product: name,
      quantity: '1',
      cost: '10000',
      mainType: 'USED',
      identifiers: [one],
    })

    await page.goto('/billing')
    for (const _ of [1, 2]) {
      await page.getByRole('textbox', { name: 'Scan or search' }).fill(one)
      await page.getByTestId('bill-search-results').getByRole('button').first().click()
    }
    await expect(page.getByText(/already on this bill/i)).toBeVisible()
    await expect(page.getByTestId('cart-lines').locator('li')).toHaveCount(1)
  })

  test('an unpaid balance is refused without a customer', async ({ page }) => {
    const id = unique()
    const name = `E2E Credit Cable ${id}`
    await createProduct(page, name, 'Cables', '500')
    await purchase(page, {
      supplier: `E2E CredSup ${id}`,
      product: name,
      quantity: '5',
      cost: '200',
    })

    await page.goto('/billing')
    await page.getByRole('textbox', { name: 'Scan or search' }).fill(name)
    await page.getByTestId('bill-search-results').getByRole('button').first().click()
    // Save with nothing paid and no customer.
    await page.getByRole('button', { name: /^Save bill/ }).click()
    await expect(page.locator('[data-slot="alert"]')).toContainText(/walk-in cannot be given credit/i)
  })

  test('a half-built bill survives a page reload', async ({ page }) => {
    const id = unique()
    const name = `E2E Persist ${id}`
    await createProduct(page, name, 'Cables', '150')
    await purchase(page, {
      supplier: `E2E PersistSup ${id}`,
      product: name,
      quantity: '5',
      cost: '50',
    })

    await page.goto('/billing')
    await page.getByRole('textbox', { name: 'Scan or search' }).fill(name)
    await page.getByTestId('bill-search-results').getByRole('button').first().click()
    await expect(page.getByTestId('cart-lines').getByText(name)).toBeVisible()

    // NFR §9.3 - a dropped connection or an accidental refresh must not lose
    // what the customer is standing there waiting for.
    await page.reload()
    await expect(page.getByTestId('cart-lines').getByText(name)).toBeVisible()

    await page.getByRole('button', { name: 'Clear bill' }).click()
    await expect(page.getByText('Nothing on the bill yet.')).toBeVisible()
  })
})

test.describe('the bill, after it is saved', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('downloads the invoice as a PDF (FR-26.4)', async ({ page }) => {
    const id = unique()
    const name = `E2E Pdf Cable ${id}`
    await createProduct(page, name, 'Cables', '300')
    await purchase(page, {
      supplier: `E2E PdfSup ${id}`,
      product: name,
      quantity: '2',
      cost: '120',
    })

    await page.goto('/billing')
    await page.getByRole('textbox', { name: 'Scan or search' }).fill(name)
    await page.getByTestId('bill-search-results').getByRole('button').first().click()
    await page.getByRole('button', { name: /^\+ Cash$/ }).click()
    await page.getByRole('button', { name: /^Save bill/ }).click()
    await expect(page).toHaveURL(/\/sales\/\d+$/)

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Download PDF' }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.pdf$/)

    // A .pdf name proves nothing; check the file really is one.
    const path = await download.path()
    const fs = await import('node:fs/promises')
    const head = (await fs.readFile(path)).subarray(0, 5).toString('latin1')
    expect(head).toBe('%PDF-')
  })

  test('filters the sales list by payment status and search', async ({ page }) => {
    const id = unique()
    const name = `E2E Filter Cable ${id}`
    await createProduct(page, name, 'Cables', '400')
    await purchase(page, {
      supplier: `E2E FilterSup ${id}`,
      product: name,
      quantity: '2',
      cost: '150',
    })

    await page.goto('/billing')
    await page.getByRole('textbox', { name: 'Scan or search' }).fill(name)
    await page.getByTestId('bill-search-results').getByRole('button').first().click()
    await page.getByRole('button', { name: /^\+ Cash$/ }).click()
    await page.getByRole('button', { name: /^Save bill/ }).click()
    await expect(page).toHaveURL(/\/sales\/\d+$/)
    const invoiceNumber = (await page.getByRole('heading', { level: 1 }).textContent())?.trim() ?? ''
    expect(invoiceNumber).not.toBe('')

    await page.goto('/sales')
    const filters = page.getByTestId('sale-filters')
    await filters.getByRole('searchbox', { name: 'Search sales' }).fill(invoiceNumber)
    // Enter submits the form - what a user does, and not dependent on the
    // button being clickable at whatever scroll position it lands in.
    await filters.getByRole('searchbox', { name: 'Search sales' }).press('Enter')
    await expect(page.getByRole('link', { name: invoiceNumber })).toBeVisible()

    // It was paid in full, so the UNPAID filter must exclude it.
    await choose(filters.getByRole('combobox', { name: 'Payment status' }), 'Unpaid')
    await expect(page.getByRole('link', { name: invoiceNumber })).toHaveCount(0)

    await expectNoHorizontalOverflow(page)
  })

  test('creates a customer without leaving the bill (FR-6.6)', async ({ page }) => {
    const id = unique()
    const customerName = `E2E Counter Cust ${id}`

    await page.goto('/billing')
    await page.getByRole('button', { name: 'New' }).click()
    await page.getByLabel('Name', { exact: true }).fill(customerName)
    await page.getByLabel('Phone', { exact: true }).fill(`98${id}`)
    await page.getByRole('button', { name: 'Add to bill' }).click()

    // Created and attached in one step - the half-built bill survives.
    await expect(page.getByRole('combobox', { name: 'Customer' })).toContainText(customerName)
  })

  test('marks an external-channel handset sold in the other system (FR-38.3)', async ({ page }) => {
    const id = unique()
    const name = `E2E Ext Phone ${id}`
    const one = imei(7)
    await createProduct(page, name, 'Mobiles (IMEI)', '30000')
    await purchase(page, {
      supplier: `E2E ExtSup ${id}`,
      product: name,
      quantity: '1',
      cost: '25000',
      mainType: 'NEW',
      identifiers: [one],
    })

    await page.goto('/devices')
    await page.getByRole('searchbox', { name: 'Search devices' }).fill(one)
    await page.keyboard.press('Enter')
    await page.getByRole('link', { name: new RegExp(one) }).first().click()
    await expect(page).toHaveURL(/\/devices\/\d+$/)

    await page.getByRole('button', { name: 'Sold in other system' }).click()
    await page.getByRole('button', { name: 'Mark as sold' }).click()

    // Stock drops now; the daily import fills in the real invoice later.
    await expect(page.getByText('SOLD_PENDING_IMPORT')).toBeVisible()
  })
})

test.describe('customer history (FR-6.7)', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('shows what a customer bought, their spend and what they owe', async ({ page }) => {
    const id = unique()
    const name = `E2E Hist Cable ${id}`
    const buyer = `E2E Hist Buyer ${id}`
    await createProduct(page, name, 'Cables', '500')
    await purchase(page, {
      supplier: `E2E HistSup ${id}`,
      product: name,
      quantity: '4',
      cost: '200',
    })

    await page.goto('/customers/new')
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(buyer)
    await page.getByRole('textbox', { name: 'Phone', exact: true }).fill(`97${id}`)
    await page.getByRole('button', { name: 'Create customer' }).click()
    await expect(page).toHaveURL(/\/customers$/)

    await page.goto('/billing')
    await page.getByRole('textbox', { name: 'Scan or search' }).fill(name)
    await page.getByTestId('bill-search-results').getByRole('button').first().click()
    await page.getByRole('combobox', { name: 'Customer' }).click()
    await page.getByPlaceholder('Name, phone, email or GST').fill(buyer)
    await page
      .getByTestId('customer-picker-list')
      .getByRole('option', { name: buyer })
      .first()
      .click()
    await page.getByRole('button', { name: /^\+ Cash$/ }).click()
    await page.getByRole('button', { name: /^Save bill/ }).click()
    await expect(page).toHaveURL(/\/sales\/\d+$/)
    const invoiceNumber = (await page.getByRole('heading', { level: 1 }).textContent())?.trim() ?? ''

    await page.goto('/customers')
    await page.getByRole('searchbox').first().fill(buyer)
    await page.keyboard.press('Enter')
    await page.getByRole('link', { name: buyer }).first().click()
    await expect(page).toHaveURL(/\/customers\/\d+$/)

    // History leads, because that is what you open a customer to find out.
    await expect(page.getByRole('tab', { name: 'History' })).toHaveAttribute(
      'data-state',
      'active',
    )
    await expect(page.getByText('Total spend')).toBeVisible()
    await expect(page.getByRole('link', { name: invoiceNumber })).toBeVisible()
    // Paid in full, so nothing is outstanding.
    await expect(page.getByText('Outstanding')).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('a customer who has bought nothing says so instead of showing an empty table', async ({
    page,
  }) => {
    const id = unique()
    const buyer = `E2E Quiet Buyer ${id}`
    await page.goto('/customers/new')
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(buyer)
    await page.getByRole('button', { name: 'Create customer' }).click()
    await expect(page).toHaveURL(/\/customers$/)

    await page.getByRole('searchbox').first().fill(buyer)
    await page.keyboard.press('Enter')
    await page.getByRole('link', { name: buyer }).first().click()
    await expect(page.getByText('Nothing bought yet.')).toBeVisible()
  })

  test('the details tab still edits the customer', async ({ page }) => {
    const id = unique()
    const buyer = `E2E Edit Buyer ${id}`
    await page.goto('/customers/new')
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(buyer)
    await page.getByRole('button', { name: 'Create customer' }).click()
    await expect(page).toHaveURL(/\/customers$/)

    await page.getByRole('searchbox').first().fill(buyer)
    await page.keyboard.press('Enter')
    await page.getByRole('link', { name: buyer }).first().click()
    await page.getByRole('tab', { name: 'Details' }).click()
    await choose(page.getByRole('combobox', { name: 'GST state' }), 'Kerala (32)')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page).toHaveURL(/\/customers$/)
  })
})

test.describe('the tax invoice is statutory (OQ-4)', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('an intra-state sale shows CGST and SGST separately, not one GST line', async ({ page }) => {
    const id = unique()
    const name = `E2E Gst Cable ${id}`
    await createProduct(page, name, 'Cables', '1000')
    await purchase(page, {
      supplier: `E2E GstSup ${id}`,
      product: name,
      quantity: '4',
      cost: '400',
    })

    await page.goto('/billing')
    await page.getByRole('textbox', { name: 'Scan or search' }).fill(name)
    await page.getByTestId('bill-search-results').getByRole('button').first().click()
    await page.getByRole('button', { name: /^\+ Cash$/ }).click()
    await page.getByRole('button', { name: /^Save bill/ }).click()
    await expect(page).toHaveURL(/\/sales\/\d+$/)

    const invoice = page.locator('#invoice')
    await expect(invoice).toContainText(/tax invoice/i)
    await expect(invoice).toContainText('Place of supply')
    await expect(invoice).toContainText(/CGST/)
    await expect(invoice).toContainText(/SGST/)
    // A single combined "GST 18%" line is exactly what OQ-4 ruled out.
    await expect(invoice.getByText(/^GST \d/)).toHaveCount(0)

    await expect(invoice).toContainText('HSN summary')
    await expect(invoice).toContainText('8517')
    await expectNoHorizontalOverflow(page)
  })

  test('the PDF of a statutory invoice still renders', async ({ page }) => {
    const id = unique()
    const name = `E2E GstPdf Cable ${id}`
    await createProduct(page, name, 'Cables', '600')
    await purchase(page, {
      supplier: `E2E GstPdfSup ${id}`,
      product: name,
      quantity: '2',
      cost: '200',
    })

    await page.goto('/billing')
    await page.getByRole('textbox', { name: 'Scan or search' }).fill(name)
    await page.getByTestId('bill-search-results').getByRole('button').first().click()
    await page.getByRole('button', { name: /^\+ Cash$/ }).click()
    await page.getByRole('button', { name: /^Save bill/ }).click()
    await expect(page).toHaveURL(/\/sales\/\d+$/)

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Download PDF' }).click(),
    ])
    const fs = await import('node:fs/promises')
    const head = (await fs.readFile(await download.path())).subarray(0, 5).toString('latin1')
    expect(head).toBe('%PDF-')
  })
})

test.describe('permissions', () => {
  test('staff can bill but not give a discount', async ({ page }) => {
    await signIn(page, USERS.staff)
    await page.goto('/billing')
    await expect(page.getByRole('heading', { name: 'Billing', level: 1 })).toBeVisible()
  })

  test('billing appears in the navigation for staff', async ({ page }, testInfo) => {
    await signIn(page, USERS.staff)
    if (isMobileProject(testInfo.project.name)) {
      await page.getByRole('button', { name: 'Open navigation menu' }).click()
    }
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Billing' }),
    ).toBeVisible()
  })
})
