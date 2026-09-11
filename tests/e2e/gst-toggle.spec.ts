import { expect, test, type Page } from '@playwright/test'
import { choose, expectNoHorizontalOverflow, signIn, USERS } from './helpers'

/**
 * The GST toggle (business settings).
 *
 * A shop trading below the registration threshold charges no GST and must not
 * issue a tax invoice. These tests run the switch both ways and check the one
 * thing that cannot be undone later: a bill issued while unregistered must
 * still print as a plain invoice after the shop registers.
 */

const unique = () => String(Date.now()).slice(-8)
/*
 * A per-run unique IMEI.
 *
 * `n` is spaced by 100, not by 10: the previous version reserved a single
 * digit per test, so `imei(80)` in one run collided with `imei(0)` from a run
 * eight milliseconds earlier — which showed up as an unrelated test failing
 * with "already in the shop on ...". Two digits is more numbers than
 * any one spec uses.
 */
const imei = (n: number) =>
  String(35_800_000_000_000 + (Date.now() % 1_000_000) * 100 + n)

/** Flip the switch and save. Restored by the test that changed it. */
async function setGst(page: Page, on: boolean) {
  await page.goto('/settings/business')
  const toggle = page.getByRole('switch', { name: 'Registered for GST' })
  if ((await toggle.getAttribute('data-state')) === (on ? 'checked' : 'unchecked')) return
  await toggle.click()
  await page.getByRole('button', { name: /^Save profile$/ }).click()
  await expect(page.getByText('Saved')).toBeVisible({ timeout: 10_000 })
}

async function sellOnePhone(page: Page, product: string, price: string) {
  await page.goto('/billing')
  await page.getByRole('textbox', { name: 'Scan or search' }).fill(product)
  await page.getByTestId('bill-search-results').getByRole('button').first().click()
  await page.getByRole('textbox', { name: 'Price (₹)', exact: true }).fill(price)
  await page.getByRole('button', { name: /^\+ Cash$/ }).click()
  const save = page.getByRole('button', { name: /^Save bill/ })
  await save.scrollIntoViewIfNeeded()
  await save.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/sales\/\d+$/)
  return page.url()
}

async function stockAPhone(page: Page, name: string, one: string) {
  await page.goto('/products/new')
  await page.getByRole('textbox', { name: 'Product name', exact: true }).fill(name)
  await choose(page.getByRole('combobox', { name: 'Category', exact: true }), 'Mobiles (IMEI)')
  await page.getByRole('button', { name: 'Create product' }).click()
  await expect(page).toHaveURL(/\/products$/)

  await page.goto('/devices/new')
  await page.getByRole('textbox', { name: 'IMEI', exact: true }).fill(one)
  await page.getByRole('combobox', { name: 'Product', exact: true }).click()
  await page.getByPlaceholder('Name, SKU or barcode').fill(name)
  await page.getByTestId('product-picker-list').getByRole('option', { name: new RegExp(name) }).first().click()
  await page.getByRole('button', { name: 'GLOBAL', exact: true }).click()
  await page.getByRole('button', { name: 'Add device' }).click()
  await expect(page).toHaveURL(/\/devices$/)
}

test.describe('GST switched off', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test.afterEach(async ({ page }) => {
    // Every other spec expects the seeded shop to be GST-registered.
    await setGst(page, true)
  })

  test('the bill charges no tax and the invoice shows no GST', async ({ page }) => {
    const id = unique()
    const name = `E2E NoGST Phone ${id}`
    await stockAPhone(page, name, imei(1))
    await setGst(page, false)

    const saleUrl = await sellOnePhone(page, name, '10000')

    // A plain invoice, not a tax invoice, and no GST anywhere on it.
    await expect(page.getByText('Tax Invoice')).toHaveCount(0)
    await expect(page.getByText('Invoice', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('GSTIN')).toHaveCount(0)
    await expect(page.getByText('Taxable')).toHaveCount(0)
    await expect(page.getByText('HSN summary')).toHaveCount(0)
    // The customer pays the price on the label.
    await expect(page.getByText('₹10,000.00').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)

    /*
     * Now the shop registers. The bill above must NOT become a tax invoice -
     * nothing archives the PDF, so this reprint is a fresh render and the only
     * thing that remembers is the flag stamped on the sale.
     */
    await setGst(page, true)
    await page.goto(saleUrl)
    await expect(page.getByText('Tax Invoice')).toHaveCount(0)
    await expect(page.getByText('GSTIN')).toHaveCount(0)
  })

  test('GST fields disappear from the forms', async ({ page }) => {
    await setGst(page, false)

    await page.goto('/settings/business')
    await expect(page.getByLabel('GST number')).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'Tax' })).toHaveCount(0)
    await expect(page.getByLabel('Prices include tax')).toHaveCount(0)

    await page.goto('/products/new')
    await expect(page.getByLabel('HSN code')).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: 'Tax rate' })).toHaveCount(0)

    await page.goto('/customers/new')
    await expect(page.getByLabel('GST number')).toHaveCount(0)
  })

  test('the till shows a total with no tax breakdown', async ({ page }) => {
    const id = unique()
    const name = `E2E Till NoGST ${id}`
    await stockAPhone(page, name, imei(2))
    await setGst(page, false)

    await page.goto('/billing')
    await page.getByRole('textbox', { name: 'Scan or search' }).fill(name)
    await page.getByTestId('bill-search-results').getByRole('button').first().click()
    await expect(page.getByText('Bill total')).toBeVisible()
    await expect(page.getByText('Taxable')).toHaveCount(0)
  })
})

test.describe('GST switched on', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('the seeded shop still issues tax invoices', async ({ page }) => {
    await page.goto('/settings/business')
    await expect(page.getByRole('switch', { name: 'Registered for GST' })).toHaveAttribute(
      'data-state',
      'checked',
    )
    await expect(page.getByLabel('GST number')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Tax' })).toBeVisible()
  })
})
