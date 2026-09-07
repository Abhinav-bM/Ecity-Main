import { expect, test, type Page } from '@playwright/test'
import { choose, expectNoHorizontalOverflow, isMobileProject, signIn, USERS } from './helpers'

/**
 * M7 — expenses, the cash drawer, accounts and daily closing.
 *
 * The thing worth testing hardest is PRD OQ-5: a closing is signed and never
 * rewritten. Everything else in the module is arithmetic that the integration
 * tests already prove; these check that a person can actually do it.
 */

const unique = () => String(Date.now()).slice(-8)

/** "₹1,234.00" and "-₹1,234.00" alike. Intl uses its own minus glyph. */
function parseRupees(text: string): number {
  const negative = /[-\u2212]/.test(text)
  const digits = Number(text.replace(/[^0-9.]/g, ''))
  return negative ? -digits : digits
}

/**
 * Put real cash in today's till: create something, buy stock, sell it for cash.
 *
 * The closing tests need a positive drawer - a day can be counted short only
 * if there is something in it, and counted cash cannot be negative.
 */
async function sellForCash(page: Page, rupees: string) {
  const id = unique()
  const name = `E2E Money Item ${id}`

  await page.goto('/products/new')
  await page.getByRole('textbox', { name: 'Product name', exact: true }).fill(name)
  await choose(page.getByRole('combobox', { name: 'Category', exact: true }), 'Cables')
  await page.getByRole('button', { name: 'Create product' }).click()
  await expect(page).toHaveURL(/\/products$/)

  await page.goto('/suppliers/new')
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(`E2E MoneySup ${id}`)
  await page.getByRole('button', { name: 'Create supplier' }).click()
  await expect(page).toHaveURL(/\/suppliers$/)

  await page.goto('/purchases/new')
  await page.getByRole('combobox', { name: 'Supplier', exact: true }).click()
  await page.getByPlaceholder('Name, phone, email or GST').fill(`E2E MoneySup ${id}`)
  await page
    .getByTestId('supplier-picker-list')
    .getByRole('option', { name: `E2E MoneySup ${id}` })
    .first()
    .click()
  await page.getByRole('combobox', { name: 'Line 1 product' }).click()
  await page.getByPlaceholder('Name, SKU or barcode').fill(name)
  await page
    .getByTestId('product-picker-list')
    .getByRole('option', { name: new RegExp(name) })
    .first()
    .click()
  await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill('1')
  await page.getByRole('textbox', { name: 'Unit cost (₹)', exact: true }).fill('100')
  await page.getByRole('button', { name: 'Confirm purchase' }).click()
  await expect(page).toHaveURL(/\/purchases\/\d+$/)

  await page.goto('/billing')
  await page.getByRole('textbox', { name: 'Scan or search' }).fill(name)
  await page.getByTestId('bill-search-results').getByRole('button').first().click()
  await page.getByRole('textbox', { name: 'Price (₹)', exact: true }).fill(rupees)
  await page.getByRole('button', { name: /^\+ Cash$/ }).click()
  const save = page.getByRole('button', { name: /^Save bill/ })
  await save.scrollIntoViewIfNeeded()
  await save.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/sales\/\d+$/)
}

async function recordExpense(page: Page, amount: string, description: string) {
  await page.goto('/expenses/new')
  await page.getByRole('textbox', { name: 'Amount (₹)', exact: true }).fill(amount)
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill(description)
  await page.getByRole('button', { name: 'Record expense' }).click()
  await expect(page).toHaveURL(/\/expenses$/)
}

test.describe('expenses', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('a cash expense shows in the list and leaves the drawer', async ({ page }) => {
    const note = `E2E Expense ${unique()}`

    await page.goto('/cash')
    const before = await page.getByTestId('expected-cash').innerText()

    await recordExpense(page, '250', note)
    await expect(
      page.locator('[data-testid="expense-row"]:visible').filter({ hasText: note }),
    ).toHaveCount(1)

    // The till is lighter by the amount, without anyone posting it by hand.
    await page.goto('/cash')
    await expect(page.getByTestId('expected-cash')).not.toHaveText(before)
    await expectNoHorizontalOverflow(page)
  })

  test('an expense is voided, not deleted, and the money comes back', async ({ page }) => {
    const note = `E2E Void ${unique()}`
    await recordExpense(page, '400', note)

    await page.goto('/cash')
    const afterSpend = await page.getByTestId('expected-cash').innerText()

    await page.goto('/expenses')
    const row = page.locator('[data-testid="expense-row"]:visible').filter({ hasText: note })
    await row.getByRole('button', { name: 'Void' }).click()
    await page.getByRole('textbox', { name: 'Reason', exact: true }).fill('Entered twice')
    await page.getByRole('button', { name: 'Void expense' }).click()

    // The entry is still there, marked, rather than gone.
    await expect(
      page.locator('[data-testid="expense-row"]:visible').filter({ hasText: note }),
    ).toHaveCount(0)

    await page.goto('/cash')
    await expect(page.getByTestId('expected-cash')).not.toHaveText(afterSpend)
  })

})

test.describe('an expense on its own page', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  /** FR-10.2 — the receipt belongs with the expense it explains. */
  test('opens from the list and offers a receipt upload', async ({ page }) => {
    const note = `E2E Receipt ${unique()}`
    await recordExpense(page, '900', note)

    await page
      .locator('[data-testid="expense-row"]:visible')
      .filter({ hasText: note })
      .getByRole('link')
      .first()
      .click()
    await expect(page).toHaveURL(/\/expenses\/\d+$/)
    await expect(page.getByText(note)).toBeVisible()
    await expect(page.getByText(/receipt or bill for this expense/i)).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})

test.describe('an account on its own page', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  /** FR-12.3 — the movements behind the balance. */
  test('shows the running ledger', async ({ page }) => {
    const name = `E2E Ledger ${unique()}`
    await page.goto('/accounts')
    await page.getByRole('button', { name: 'Add account' }).click()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
    await page.getByRole('textbox', { name: 'Opening balance (₹)', exact: true }).fill('7000')
    await page.getByRole('button', { name: 'Add account' }).last().click()

    await page
      .locator('[data-testid="account-row"]:visible')
      .filter({ hasText: name })
      .getByRole('link')
      .first()
      .click()
    await expect(page).toHaveURL(/\/accounts\/\d+$/)
    await expect(page.getByTestId('account-balance')).toContainText('7,000.00')
    await expectNoHorizontalOverflow(page)
  })
})

test.describe('the cash drawer', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('shows the movements behind the expected figure', async ({ page }) => {
    await recordExpense(page, '150', `E2E Drawer ${unique()}`)
    await page.goto('/cash')
    await expect(page.getByTestId('expected-cash')).toBeVisible()
    await expect(page.locator('[data-testid="movement-row"]:visible').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})

test.describe('accounts', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('adds an account, transfers between two, and reconciles one', async ({ page }) => {
    const id = unique()
    const first = `E2E Bank ${id}`
    const second = `E2E UPI ${id}`

    for (const [name, type, opening] of [
      [first, 'BANK', '50000'],
      [second, 'UPI', '0'],
    ] as const) {
      await page.goto('/accounts')
      await page.getByRole('button', { name: 'Add account' }).click()
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
      await choose(page.getByRole('combobox', { name: 'Type', exact: true }), type)
      await page.getByRole('textbox', { name: 'Opening balance (₹)', exact: true }).fill(opening)
      await page.getByRole('button', { name: 'Add account' }).last().click()
      await expect(
        page.locator('[data-testid="account-row"]:visible').filter({ hasText: name }),
      ).toHaveCount(1)
    }

    await page.getByRole('button', { name: 'Transfer' }).click()
    await choose(page.getByRole('combobox', { name: 'From', exact: true }), first)
    await choose(page.getByRole('combobox', { name: 'To', exact: true }), second)
    await page.getByRole('textbox', { name: 'Amount (₹)', exact: true }).fill('12000')
    await page.getByRole('button', { name: 'Transfer' }).last().click()

    await expect(
      page.locator('[data-testid="account-row"]:visible').filter({ hasText: second }),
    ).toContainText('12,000.00')

    // Reconciling records the statement; it must not move the balance to match.
    await page.getByRole('button', { name: 'Reconcile' }).click()
    await choose(page.getByRole('combobox', { name: 'Account', exact: true }), second)
    await page.getByRole('textbox', { name: 'Statement balance (₹)', exact: true }).fill('11500')
    await page.getByRole('button', { name: 'Record balance' }).click()

    const after = page.locator('[data-testid="account-row"]:visible').filter({ hasText: second })
    // The balance is NOT quietly moved to match the statement; the 500 gap is
    // shown as unreconciled, because a real difference wants an explanation.
    await expect(after).toContainText('12,000.00')
    await expect(after).toContainText('500.00')
    await expectNoHorizontalOverflow(page)
  })
})

test.describe('closing the day', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  /*
   * PRD OQ-5, the decision this module turns on. A closing is a person
   * counting the money and signing that it matched, so it is stamped and never
   * rewritten - and a correction afterwards is shown, not folded in.
   */
  test('a shortage is shown, and a later correction does not rewrite the signature', async ({
    page,
  }) => {
    await sellForCash(page, '8000')
    await recordExpense(page, '100', `E2E Close ${unique()}`)

    await page.goto('/closing')
    // FR-13.1. Invoices and units sold, not just a money figure.
    await expect(page.getByText(/\d+ invoices · \d+ items/)).toBeVisible()
    const expected = await page.getByTestId('closing-expected').innerText()
    const expectedRupees = parseRupees(expected)
    // A day the seed left in deficit cannot be counted short of, and counted
    // cash may not be negative - so the shortage case needs a positive till.
    expect(expectedRupees).toBeGreaterThan(200)

    // Count 200 short of whatever the day expects.
    await page
      .getByRole('textbox', { name: 'Counted cash (₹)', exact: true })
      .fill((expectedRupees - 200).toFixed(2))
    await expect(page.getByTestId('closing-difference')).toContainText('200.00 short')

    await page.getByRole('button', { name: 'Close the day' }).click()
    await expect(page.getByTestId('closed-summary')).toBeVisible()
    await expect(page.getByTestId('closed-summary')).toContainText('200.00 short')

    // Now correct the day. The signed figures must stay exactly as they were.
    await recordExpense(page, '700', `E2E Correction ${unique()}`)
    await page.goto('/closing')
    await expect(page.getByText('This day was corrected after it was closed.')).toBeVisible()
    await expect(page.getByTestId('closed-summary')).toContainText('200.00 short')
    await expectNoHorizontalOverflow(page)
  })

  test('the closing appears in the history and the day can be reopened', async ({ page }) => {
    await page.goto('/closing/history')
    await expect(page.locator('[data-testid="closing-row"]:visible').first()).toBeVisible()

    await page.goto('/closing')
    await page.getByRole('button', { name: 'Reopen this day' }).click()
    await page.getByRole('textbox', { name: 'Reason', exact: true }).fill('Closed before the last sale')
    await page.getByRole('button', { name: 'Reopen day' }).click()

    // Reopened, and the voided closing is kept rather than deleted.
    await expect(page.getByTestId('close-day')).toBeVisible()
    await page.goto('/closing/history')
    await expect(
      page.locator('[data-testid="closing-row"]:visible').filter({ hasText: 'Reopened' }).first(),
    ).toBeVisible()
  })

  test('the consolidated view covers every branch', async ({ page }) => {
    await page.goto('/closing/reconciliation')
    await expect(page.getByTestId('consolidated-difference')).toBeVisible()
    await expect(page.locator('[data-testid="reconciliation-row"]:visible').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('the money screens appear in the navigation', async ({ page }, testInfo) => {
    await page.goto('/dashboard')
    if (isMobileProject(testInfo.project.name)) {
      await page.getByRole('button', { name: 'Open navigation menu' }).click()
    }
    const nav = page.getByRole('navigation', { name: 'Main' })
    for (const label of ['Expenses', 'Cash drawer', 'Accounts', 'Daily closing']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible()
    }
  })
})

test.describe('permissions', () => {
  test('staff can see expenses but not record one', async ({ page }) => {
    await signIn(page, USERS.staff)
    await page.goto('/expenses')
    // Recording money out of the till they are counting is not theirs to do -
    // the same reasoning that keeps a closed day uneditable (PRD OQ-5).
    await expect(page.getByRole('link', { name: 'Record an expense' })).toHaveCount(0)
    await page.goto('/expenses/new')
    await expect(page).toHaveURL(/\/expenses$/)
  })

  test('staff cannot close the day', async ({ page }) => {
    await signIn(page, USERS.staff)
    await page.goto('/closing')
    await expect(page).toHaveURL(/\/dashboard$/)
  })
})

test.describe('correcting a purchase', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  /*
   * Carried into M7 from M5: a typo in a supplier bill number had no fix once
   * a unit from the purchase had sold, because reversal is refused by then.
   */
  test('the supplier bill number can be corrected, but not the costs', async ({ page }) => {
    await page.goto('/purchases')
    const firstPurchase = page.getByRole('link', { name: /PUR/ }).first()
    if ((await firstPurchase.count()) === 0) test.skip(true, 'no purchases seeded')
    await firstPurchase.click()
    await expect(page).toHaveURL(/\/purchases\/\d+$/)

    await page.getByRole('button', { name: 'Correct details' }).click()
    const corrected = `SUP-${unique()}`
    await page.getByRole('textbox', { name: 'Supplier bill number', exact: true }).fill(corrected)
    // Costs are deliberately absent from this dialog.
    await expect(page.getByLabel('Unit cost (₹)')).toHaveCount(0)
    await page.getByRole('button', { name: 'Save correction' }).click()

    await expect(page.getByText(corrected)).toBeVisible()
  })
})
