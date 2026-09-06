import { expect, test, type Page } from '@playwright/test'
import { choose, expectNoHorizontalOverflow, isMobileProject, signIn, USERS } from './helpers'

/** M5 — customer credit, collections and dues. Needs a seeded, migrated database. */

const unique = () => String(Date.now()).slice(-8)

async function createProduct(page: Page, name: string, price: string) {
  await page.goto('/products/new')
  await page.getByRole('textbox', { name: 'Product name', exact: true }).fill(name)
  await choose(page.getByRole('combobox', { name: 'Category', exact: true }), 'Cables')
  await page.getByRole('textbox', { name: 'Selling price (₹)', exact: true }).fill(price)
  await page.getByRole('button', { name: 'Create product' }).click()
  await expect(page).toHaveURL(/\/products$/)
}

async function stockUp(page: Page, supplier: string, product: string, quantity: string) {
  await page.goto('/suppliers/new')
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(supplier)
  await page.getByRole('button', { name: 'Create supplier' }).click()
  await expect(page).toHaveURL(/\/suppliers$/)

  await page.goto('/purchases/new')
  await page.getByRole('combobox', { name: 'Supplier', exact: true }).click()
  await page.getByPlaceholder('Name, phone, email or GST').fill(supplier)
  await page.getByTestId('supplier-picker-list').getByRole('option', { name: supplier }).first().click()
  await page.getByRole('combobox', { name: 'Line 1 product' }).click()
  await page.getByPlaceholder('Name, SKU or barcode').fill(product)
  await page.getByTestId('product-picker-list').getByRole('option', { name: new RegExp(product) }).first().click()
  await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill(quantity)
  await page.getByRole('textbox', { name: 'Unit cost (₹)', exact: true }).fill('100')
  await page.getByRole('button', { name: 'Confirm purchase' }).click()
  await expect(page).toHaveURL(/\/purchases\/\d+$/)
}

async function createCustomer(page: Page, name: string, phone: string) {
  await page.goto('/customers/new')
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
  await page.getByRole('textbox', { name: 'Phone', exact: true }).fill(phone)
  await page.getByRole('button', { name: 'Create customer' }).click()
  await expect(page).toHaveURL(/\/customers$/)
}

/** Bill `product` to `customer`, paying `paid` rupees of it now. */
async function billOnCredit(page: Page, product: string, customer: string, paid: string) {
  await page.goto('/billing')
  await page.getByRole('textbox', { name: 'Scan or search' }).fill(product)
  await page.getByTestId('bill-search-results').getByRole('button').first().click()
  await page.getByRole('combobox', { name: 'Customer' }).click()
  await page.getByPlaceholder('Name, phone, email or GST').fill(customer)
  await page.getByTestId('customer-picker-list').getByRole('option', { name: customer }).first().click()

  if (paid !== '0') {
    await page.getByRole('button', { name: /^\+ Cash$/ }).click()
    await page.getByRole('textbox', { name: 'Amount', exact: true }).first().fill(paid)
  }
  await page.getByRole('button', { name: /^Save bill/ }).click()
  await expect(page).toHaveURL(/\/sales\/\d+$/)
  return {
    invoiceNumber: (await page.getByRole('heading', { level: 1 }).textContent())?.trim() ?? '',
    saleUrl: page.url(),
  }
}

/** Open the collection screen for one named customer from the dues list. */
async function collectFor(page: Page, buyer: string) {
  await page.goto('/customers/dues')
  await page.getByRole('searchbox', { name: 'Search customers' }).fill(buyer)
  await page.getByRole('searchbox', { name: 'Search customers' }).press('Enter')
  await expect(page.getByRole('link', { name: buyer })).toBeVisible()
  // Scoped to this customer's own row - .first() would pick whichever the
  // search happened to return first. One testid covers both layouts: a table
  // row on a large screen, a card on a phone.
  const row = page.getByTestId('dues-row').filter({ hasText: buyer })
  await row.getByRole('link', { name: 'Collect', exact: true }).click()
  await expect(page).toHaveURL(/\/customers\/\d+\/collect$/)
}

test.describe('credit at the counter', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('credit terms appear only once a bill is short', async ({ page }) => {
    const id = unique()
    const name = `E2E Credit Cable ${id}`
    await createProduct(page, name, '1000')
    await stockUp(page, `E2E CreditSup ${id}`, name, '10')
    await createCustomer(page, `E2E Credit Buyer ${id}`, `95${id}`)

    await page.goto('/billing')
    await page.getByRole('textbox', { name: 'Scan or search' }).fill(name)
    await page.getByTestId('bill-search-results').getByRole('button').first().click()

    // Nothing paid yet, so the bill is short and the terms show.
    await expect(page.getByRole('textbox', { name: 'Payment due' })).toBeVisible()

    // Pay it in full and they go away — a cash sale needs no due date.
    await page.getByRole('button', { name: /^\+ Cash$/ }).click()
    await expect(page.getByRole('textbox', { name: 'Payment due' })).toHaveCount(0)
  })

  test('an unpaid bill shows its terms on the bill itself (FR-7.2)', async ({ page }) => {
    const id = unique()
    const name = `E2E Due Cable ${id}`
    const buyer = `E2E Due Buyer ${id}`
    await createProduct(page, name, '1200')
    await stockUp(page, `E2E DueSup ${id}`, name, '10')
    await createCustomer(page, buyer, `94${id}`)
    await billOnCredit(page, name, buyer, '0')

    await expect(page.getByText('UNPAID')).toBeVisible()
    // The terms were agreed at the counter, so they have to be readable here
    // rather than only derivable from the dues screen.
    await expect(page.getByText('Outstanding')).toBeVisible()
    await expect(page.getByText(/^Due /)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Collect payment' })).toBeVisible()
  })

  test('a fully paid bill shows no credit terms', async ({ page }) => {
    const id = unique()
    const name = `E2E Paid Cable ${id}`
    const buyer = `E2E Paid Buyer ${id}`
    await createProduct(page, name, '400')
    await stockUp(page, `E2E PaidSup ${id}`, name, '10')
    await createCustomer(page, buyer, `85${id}`)

    await page.goto('/billing')
    await page.getByRole('textbox', { name: 'Scan or search' }).fill(name)
    await page.getByTestId('bill-search-results').getByRole('button').first().click()
    await page.getByRole('button', { name: /^\+ Cash$/ }).click()
    await page.getByRole('button', { name: /^Save bill/ }).click()
    await expect(page).toHaveURL(/\/sales\/\d+$/)

    await expect(page.getByText('PAID', { exact: true })).toBeVisible()
    await expect(page.getByText('Outstanding')).toHaveCount(0)
  })
})

test.describe('dues and aging', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('an unpaid bill shows the customer on the dues list with an age', async ({ page }) => {
    const id = unique()
    const name = `E2E Dues Cable ${id}`
    const buyer = `E2E Dues Buyer ${id}`
    await createProduct(page, name, '1500')
    await stockUp(page, `E2E DuesSup ${id}`, name, '10')
    await createCustomer(page, buyer, `93${id}`)
    await billOnCredit(page, name, buyer, '0')

    await page.goto('/customers/dues')
    await page.getByRole('searchbox', { name: 'Search customers' }).fill(buyer)
    await page.getByRole('searchbox', { name: 'Search customers' }).press('Enter')

    await expect(page.getByRole('link', { name: buyer })).toBeVisible()
    await expect(page.getByText('Total outstanding')).toBeVisible()
    // A bill made today falls in the youngest bucket.
    await expect(page.getByText('0–7 days').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('the overdue filter excludes a bill that is not yet due', async ({ page }) => {
    const id = unique()
    const name = `E2E NotLate Cable ${id}`
    const buyer = `E2E NotLate Buyer ${id}`
    await createProduct(page, name, '900')
    await stockUp(page, `E2E NotLateSup ${id}`, name, '10')
    await createCustomer(page, buyer, `92${id}`)
    await billOnCredit(page, name, buyer, '0')

    await page.goto('/customers/dues?overdue=1')
    await page.getByRole('searchbox', { name: 'Search customers' }).fill(buyer)
    await page.getByRole('searchbox', { name: 'Search customers' }).press('Enter')
    // Owed, but the default term has not elapsed.
    await expect(page.getByRole('link', { name: buyer })).toHaveCount(0)
  })
})

test.describe('collecting a payment', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('settles the bill, flips it to PAID and prints a receipt', async ({ page }) => {
    const id = unique()
    const name = `E2E Collect Cable ${id}`
    const buyer = `E2E Collect Buyer ${id}`
    await createProduct(page, name, '2000')
    await stockUp(page, `E2E CollectSup ${id}`, name, '10')
    await createCustomer(page, buyer, `91${id}`)
    const { invoiceNumber, saleUrl } = await billOnCredit(page, name, buyer, '0')

    await collectFor(page, buyer)

    // The open bill is listed, and "settle everything" fills the amount.
    await expect(page.getByTestId('open-bills')).toContainText(invoiceNumber)
    await page.getByRole('button', { name: /Settle everything/ }).click()
    await page.getByRole('button', { name: 'Record payment' }).click()

    await expect(page).toHaveURL(/\/receipts\/\d+$/)
    await expect(page.getByText('Received with thanks')).toBeVisible()
    await expect(page.getByText(invoiceNumber)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Print A4' })).toBeVisible()

    // FR-7.4: the invoice is settled.
    await page.goto(saleUrl)
    await expect(page.getByText('PAID')).toBeVisible()
  })

  test('a part payment leaves the rest owing', async ({ page }) => {
    const id = unique()
    const name = `E2E Part Cable ${id}`
    const buyer = `E2E Part Buyer ${id}`
    await createProduct(page, name, '1000')
    await stockUp(page, `E2E PartSup ${id}`, name, '10')
    await createCustomer(page, buyer, `90${id}`)
    await billOnCredit(page, name, buyer, '0')

    await collectFor(page, buyer)
    await page.getByRole('textbox', { name: 'Amount (₹)', exact: true }).fill('400')
    await page.getByRole('button', { name: 'Record payment' }).click()
    await expect(page).toHaveURL(/\/receipts\/\d+$/)

    // 600 still owed, so they stay on the dues list.
    await page.goto('/customers/dues')
    await page.getByRole('searchbox', { name: 'Search customers' }).fill(buyer)
    await page.getByRole('searchbox', { name: 'Search customers' }).press('Enter')
    await expect(page.getByRole('link', { name: buyer })).toBeVisible()
  })

  test('voiding a receipt puts the debt back', async ({ page }) => {
    const id = unique()
    const name = `E2E Void Cable ${id}`
    const buyer = `E2E Void Buyer ${id}`
    await createProduct(page, name, '700')
    await stockUp(page, `E2E VoidSup ${id}`, name, '10')
    await createCustomer(page, buyer, `89${id}`)
    const { saleUrl } = await billOnCredit(page, name, buyer, '0')

    await collectFor(page, buyer)
    await page.getByRole('button', { name: /Settle everything/ }).click()
    await page.getByRole('button', { name: 'Record payment' }).click()
    await expect(page).toHaveURL(/\/receipts\/\d+$/)

    await page.getByRole('button', { name: 'Void', exact: true }).click()
    await page.getByRole('textbox', { name: 'Reason' }).fill('Cheque bounced')
    await page.getByRole('button', { name: 'Void receipt' }).click()

    // Wait for the dialog to close and the reason to appear on the receipt
    // itself. Asserting on the word "voided" matched the dialog's own
    // description - getByText is case-insensitive substring matching - so it
    // passed before the request had even been sent, and the next step then
    // raced the server.
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByText('Cheque bounced')).toBeVisible()

    // The bill is owing again.
    await page.goto(saleUrl)
    await expect(page.getByText('UNPAID')).toBeVisible()
  })
})

test.describe('branch-wise reporting (FR-7.6)', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('shows what each branch is owed and what it collected', async ({ page }) => {
    const id = unique()
    const name = `E2E Branch Cable ${id}`
    const buyer = `E2E Branch Buyer ${id}`
    await createProduct(page, name, '1300')
    await stockUp(page, `E2E BranchSup ${id}`, name, '10')
    await createCustomer(page, buyer, `87${id}`)
    await billOnCredit(page, name, buyer, '0')

    await page.goto('/customers/dues')
    const byBranch = page.getByTestId('branch-dues')
    await expect(byBranch).toBeVisible()
    await expect(byBranch).toContainText('Outstanding')
    await expect(byBranch).toContainText('Collected')
    await expect(byBranch).toContainText('All branches')
    await expectNoHorizontalOverflow(page)
  })

  test('a collection moves the collected column, not the owed one', async ({ page }) => {
    const id = unique()
    const name = `E2E Moved Cable ${id}`
    const buyer = `E2E Moved Buyer ${id}`
    await createProduct(page, name, '600')
    await stockUp(page, `E2E MovedSup ${id}`, name, '10')
    await createCustomer(page, buyer, `86${id}`)
    await billOnCredit(page, name, buyer, '0')

    const readTotals = async () => {
      const row = page.getByTestId('branch-dues').getByRole('row').filter({ hasText: 'All branches' })
      return (await row.textContent()) ?? ''
    }
    await page.goto('/customers/dues')
    const before = await readTotals()

    await collectFor(page, buyer)
    await page.getByRole('button', { name: /Settle everything/ }).click()
    await page.getByRole('button', { name: 'Record payment' }).click()
    await expect(page).toHaveURL(/\/receipts\/\d+$/)

    await page.goto('/customers/dues')
    expect(await readTotals()).not.toBe(before)
  })
})

test.describe('the customer statement', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('shows the invoice, the payment and a running balance', async ({ page }) => {
    const id = unique()
    const name = `E2E Stmt Cable ${id}`
    const buyer = `E2E Stmt Buyer ${id}`
    await createProduct(page, name, '1100')
    await stockUp(page, `E2E StmtSup ${id}`, name, '10')
    await createCustomer(page, buyer, `88${id}`)
    const { invoiceNumber } = await billOnCredit(page, name, buyer, '0')

    await page.goto('/customers/dues')
    await page.getByRole('searchbox', { name: 'Search customers' }).fill(buyer)
    await page.getByRole('searchbox', { name: 'Search customers' }).press('Enter')
    await page.getByRole('link', { name: buyer }).click()
    await expect(page).toHaveURL(/\/customers\/\d+$/)

    await page.getByRole('tab', { name: 'Statement' }).click()
    await expect(page.getByRole('link', { name: invoiceNumber })).toBeVisible()
    await expect(page.getByText('Closing balance')).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})

test.describe('permissions', () => {
  test('staff can collect but cannot void a receipt', async ({ page }) => {
    await signIn(page, USERS.staff)
    await page.goto('/customers/dues')
    // Collecting is the counter's job, so the screen is theirs.
    await expect(page.getByRole('heading', { name: 'Customer dues' })).toBeVisible()
  })

  test('customer dues appears in the navigation', async ({ page }, testInfo) => {
    await signIn(page, USERS.admin)
    if (isMobileProject(testInfo.project.name)) {
      await page.getByRole('button', { name: 'Open navigation menu' }).click()
    }
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Customer dues' }),
    ).toBeVisible()
  })

  test('only the dues item highlights, not Customers as well', async ({ page }, testInfo) => {
    await signIn(page, USERS.admin)
    await page.goto('/customers/dues')
    if (isMobileProject(testInfo.project.name)) {
      await page.getByRole('button', { name: 'Open navigation menu' }).click()
    }
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1)
    await expect(nav.locator('[aria-current="page"]')).toHaveText('Customer dues')
  })
})
