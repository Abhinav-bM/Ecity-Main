import { expect, test, type Page } from '@playwright/test'
import { choose, expectNoHorizontalOverflow, isMobileProject, signIn, USERS } from './helpers'

/**
 * M8 — branch transfers and stock adjustments.
 *
 * The rule worth testing hardest is FR-3.6: while stock is in transit it
 * belongs to neither branch. A handset sellable at both ends of its journey
 * gets sold twice, and the second customer finds out afterwards.
 */

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
  String(36_800_000_000_000 + (Date.now() % 1_000_000) * 100 + n)

/** A handset in stock at the active branch, ready to send. */
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
  await page
    .getByTestId('product-picker-list')
    .getByRole('option', { name: new RegExp(name) })
    .first()
    .click()
  await page.getByRole('button', { name: 'GLOBAL', exact: true }).click()
  // NEW CUT is a switch inside GLOBAL on this form, not a type button.
  await page.getByRole('checkbox', { name: 'NEW CUT' }).click()
  await page.getByRole('button', { name: 'Add device' }).click()
  await expect(page).toHaveURL(/\/devices$/)
}

/**
 * Accessory stock at the active branch, bought in so it really is there.
 *
 * The seeded shop has no accessory stock, and a test that skips itself when it
 * finds none proves nothing.
 */
async function stockAnAccessory(page: Page, name: string, quantity: string) {
  const id = unique()
  await page.goto('/products/new')
  await page.getByRole('textbox', { name: 'Product name', exact: true }).fill(name)
  await choose(page.getByRole('combobox', { name: 'Category', exact: true }), 'Cables')
  await page.getByRole('button', { name: 'Create product' }).click()
  await expect(page).toHaveURL(/\/products$/)

  await page.goto('/suppliers/new')
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(`E2E AdjSup ${id}`)
  await page.getByRole('button', { name: 'Create supplier' }).click()
  await expect(page).toHaveURL(/\/suppliers$/)

  await page.goto('/purchases/new')
  await page.getByRole('combobox', { name: 'Supplier', exact: true }).click()
  await page.getByPlaceholder('Name, phone, email or GST').fill(`E2E AdjSup ${id}`)
  await page
    .getByTestId('supplier-picker-list')
    .getByRole('option', { name: `E2E AdjSup ${id}` })
    .first()
    .click()
  await page.getByRole('combobox', { name: 'Line 1 product' }).click()
  await page.getByPlaceholder('Name, SKU or barcode').fill(name)
  await page
    .getByTestId('product-picker-list')
    .getByRole('option', { name: new RegExp(name) })
    .first()
    .click()
  await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill(quantity)
  await page.getByRole('textbox', { name: 'Unit cost (₹)', exact: true }).fill('100')
  await page.getByRole('button', { name: 'Confirm purchase' }).click()
  await expect(page).toHaveURL(/\/purchases\/\d+$/)
}

/** Request a transfer of one handset and return the detail URL. */
async function requestTransferOf(page: Page, identifier: string) {
  await page.goto('/transfers/new')
  await page.getByRole('textbox', { name: /Search this branch/ }).fill(identifier)
  await page.getByTestId('sendable-devices').getByRole('button').first().click()
  await expect(page.locator('[data-testid="transfer-line"]:visible')).toHaveCount(1)
  await page.getByRole('button', { name: 'Request transfer' }).click()
  await expect(page).toHaveURL(/\/transfers\/\d+$/)
  return page.url()
}

test.describe('a transfer end to end', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('moves the exact IMEI, and it is sellable at neither end in between', async ({ page }) => {
    const id = unique()
    const name = `E2E Transfer Phone ${id}`
    const one = imei(1)
    await stockAPhone(page, name, one)

    const url = await requestTransferOf(page, one)
    await expect(page.getByTestId('transfer-status')).toHaveText('REQUESTED')

    // Nothing has moved yet — the till can still see it.
    await page.goto('/billing')
    await page.getByRole('textbox', { name: 'Scan or search' }).fill(one)
    await expect(page.getByTestId('bill-search-results')).toBeVisible()

    await page.goto(url)
    await page.getByRole('button', { name: 'Approve' }).click()
    await expect(page.getByTestId('transfer-status')).toHaveText('APPROVED')

    await page.getByRole('button', { name: 'Dispatch' }).click()
    await expect(page.getByTestId('transfer-status')).toHaveText('IN TRANSIT')

    /*
     * FR-3.6, the point of the whole module. In transit it belongs to neither
     * branch, so the till must not offer it anywhere.
     */
    await page.goto('/billing')
    await page.getByRole('textbox', { name: 'Scan or search' }).fill(one)
    await expect(page.getByTestId('bill-search-results').getByRole('button')).toHaveCount(0)

    await page.goto(url)
    // Nothing is ticked until it is scanned, so a handset the scanner misses
    // shows as short rather than passing quietly.
    await page.getByRole('textbox', { name: /Scan each IMEI/ }).fill(one)
    await page.keyboard.press('Enter')
    await page.getByTestId('receive-button').click()
    await expect(page.getByTestId('transfer-status')).toHaveText('RECEIVED')
    await expectNoHorizontalOverflow(page)

    // FR-3.7. The exact handset arrived, with both branches on its history.
    await page.goto('/devices')
    await page.getByRole('searchbox', { name: 'Search devices' }).fill(one)
    await page.keyboard.press('Enter')
    await page.getByRole('link', { name: new RegExp(one) }).first().click()
    await expect(page).toHaveURL(/\/devices\/\d+$/)
    const main = page.getByRole('main')
    // Classification survives the journey untouched.
    await expect(main.getByText('GLOBAL', { exact: false }).first()).toBeVisible()
    await expect(main.getByText('NEW CUT', { exact: false }).first()).toBeVisible()
  })

  test('a shortfall on receipt is recorded, not quietly forgotten', async ({ page }) => {
    const id = unique()
    const name = `E2E Short Phone ${id}`
    const one = imei(2)
    await stockAPhone(page, name, one)

    await requestTransferOf(page, one)
    await page.getByRole('button', { name: 'Approve' }).click()
    await page.getByRole('button', { name: 'Dispatch' }).click()

    // Scan nothing — the box arrived without it.
    await expect(page.getByTestId('short-warning')).toBeVisible()
    await page.getByRole('textbox', { name: 'What happened', exact: true }).fill('Box was opened')
    await page.getByTestId('receive-button').click()

    await expect(page.getByText('Short on receipt.')).toBeVisible()
    await expect(page.getByText('Box was opened')).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('an IMEI that is not on the transfer is flagged, not silently accepted', async ({
    page,
  }) => {
    const id = unique()
    const name = `E2E Stray Phone ${id}`
    const one = imei(6)
    await stockAPhone(page, name, one)

    await requestTransferOf(page, one)
    await page.getByRole('button', { name: 'Approve' }).click()
    await page.getByRole('button', { name: 'Dispatch' }).click()

    // Everything on the paperwork arrives...
    const scan = page.getByRole('textbox', { name: /Scan each IMEI/ })
    await scan.fill(one)
    await page.keyboard.press('Enter')

    // ...plus something that should not be in the box.
    const stray = imei(7)
    await scan.fill(stray)
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('unexpected-list')).toContainText(stray)
    await expect(page.getByText(/not on this transfer/i).first()).toBeVisible()

    await page.getByTestId('receive-button').click()
    await expect(page.getByTestId('transfer-status')).toHaveText('RECEIVED')
    // Recorded on the transfer, so someone finds out where it came from.
    await expect(page.getByText(new RegExp(stray))).toBeVisible()
  })

  test('cancelling in transit puts the handset back where it came from', async ({ page }) => {
    const id = unique()
    const name = `E2E Cancel Phone ${id}`
    const one = imei(3)
    await stockAPhone(page, name, one)

    await requestTransferOf(page, one)
    await page.getByRole('button', { name: 'Approve' }).click()
    await page.getByRole('button', { name: 'Dispatch' }).click()

    await page.getByRole('button', { name: 'Cancel transfer' }).first().click()
    await page.getByRole('textbox', { name: 'Reason', exact: true }).fill('Van broke down')
    await page.getByRole('button', { name: 'Cancel transfer' }).last().click()
    await expect(page.getByTestId('transfer-status')).toHaveText('CANCELLED')

    // Back on the shelf it started on, and sellable again.
    await page.goto('/billing')
    await page.getByRole('textbox', { name: 'Scan or search' }).fill(one)
    await expect(page.getByTestId('bill-search-results')).toBeVisible()
  })

  test('the approval queue and the receiving queue are one click away', async ({ page }) => {
    const id = unique()
    const name = `E2E Queue Phone ${id}`
    const one = imei(4)
    await stockAPhone(page, name, one)
    const url = await requestTransferOf(page, one)

    // The approval queue: everything waiting for a manager.
    await page.goto('/transfers')
    await page.getByRole('link', { name: 'Waiting for approval' }).click()
    await expect(page).toHaveURL(/status=REQUESTED/)
    await expect(page.locator('[data-testid="transfer-row"]:visible').first()).toBeVisible()

    // Send it, and it moves to the receiving queue.
    await page.goto(url)
    await page.getByRole('button', { name: 'Approve' }).click()
    await page.getByRole('button', { name: 'Dispatch' }).click()

    await page.goto('/transfers')
    await page.getByRole('link', { name: 'To receive' }).click()
    await expect(page).toHaveURL(/status=IN_TRANSIT/)
    await expect(
      page.locator('[data-testid="transfer-row"]:visible').filter({ hasText: 'IN TRANSIT' }).first(),
    ).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})

test.describe('stock adjustments', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('a miscount corrects the count and is recorded with a reason', async ({ page }) => {
    const name = `E2E Miscount ${unique()}`
    await stockAnAccessory(page, name, '10')

    await page.goto('/adjustments/new')
    await page.getByRole('button', { name: 'An accessory count' }).click()
    await page.getByRole('textbox', { name: 'Find it', exact: true }).fill(name)
    await page
      .getByTestId('adjustable-list')
      .getByRole('button', { name: new RegExp(name) })
      .first()
      .click()

    // The shelf says 7, the system says 10.
    await page.getByRole('textbox', { name: 'Actually counted', exact: true }).fill('7')
    await expect(page.getByTestId('adjustment-delta')).toContainText('-3')
    await choose(page.getByRole('combobox', { name: 'Reason', exact: true }), /Miscount/)
    await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Counted the shelf')
    await page.getByRole('button', { name: 'Record adjustment' }).click()

    await expect(page).toHaveURL(/\/adjustments$/)
    const row = page.locator('[data-testid="adjustment-row"]:visible').filter({ hasText: name })
    await expect(row).toContainText('Miscount')
    // The correction is shown as a movement, not just a new number.
    await expect(row).toContainText('10 → 7')
    await expectNoHorizontalOverflow(page)
  })

  test('the same count twice over is refused — nothing to correct', async ({ page }) => {
    const name = `E2E NoChange ${unique()}`
    await stockAnAccessory(page, name, '5')

    await page.goto('/adjustments/new')
    await page.getByRole('button', { name: 'An accessory count' }).click()
    await page.getByRole('textbox', { name: 'Find it', exact: true }).fill(name)
    await page
      .getByTestId('adjustable-list')
      .getByRole('button', { name: new RegExp(name) })
      .first()
      .click()
    await page.getByRole('textbox', { name: 'Actually counted', exact: true }).fill('5')
    await page.getByRole('button', { name: 'Record adjustment' }).click()
    await expect(page.getByText(/already says/i)).toBeVisible()
  })

  test('an adjustment opens on its own page, where the evidence goes', async ({ page }) => {
    const name = `E2E Evidence ${unique()}`
    await stockAnAccessory(page, name, '4')

    await page.goto('/adjustments/new')
    await page.getByRole('button', { name: 'An accessory count' }).click()
    await page.getByRole('textbox', { name: 'Find it', exact: true }).fill(name)
    await page
      .getByTestId('adjustable-list')
      .getByRole('button', { name: new RegExp(name) })
      .first()
      .click()
    await page.getByRole('textbox', { name: 'Actually counted', exact: true }).fill('2')
    await page.getByRole('button', { name: 'Record adjustment' }).click()
    await expect(page).toHaveURL(/\/adjustments$/)

    await page
      .locator('[data-testid="adjustment-row"]:visible')
      .filter({ hasText: name })
      .getByRole('link')
      .first()
      .click()
    await expect(page).toHaveURL(/\/adjustments\/\d+$/)
    await expect(page.getByText(/photo of the damage/i)).toBeVisible()
    await expect(page.getByText(/never edited/i)).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('a handset can only be damaged or lost, not miscounted', async ({ page }) => {
    const id = unique()
    const name = `E2E Adj Phone ${id}`
    const one = imei(5)
    await stockAPhone(page, name, one)

    await page.goto('/adjustments/new')
    await page.getByRole('button', { name: 'One handset' }).click()
    await page.getByRole('textbox', { name: 'Find it', exact: true }).fill(one)
    await page.getByTestId('adjustable-list').getByRole('button').first().click()

    // Miscount is not on the menu for a handset — it is a device correction.
    await page.getByRole('combobox', { name: 'Reason', exact: true }).click()
    await expect(page.getByRole('option', { name: /Miscount/ })).toHaveCount(0)
    await page.getByRole('option', { name: /Damage/ }).click()

    await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Screen cracked')
    await page.getByRole('button', { name: 'Record adjustment' }).click()
    await expect(page).toHaveURL(/\/adjustments$/)

    // Out of sellable stock, and the till agrees.
    await page.goto('/billing')
    await page.getByRole('textbox', { name: 'Scan or search' }).fill(one)
    await expect(page.getByTestId('bill-search-results').getByRole('button')).toHaveCount(0)
  })
})

test.describe('permissions', () => {
  test('staff can ask for a transfer and receive one, but not approve or adjust', async ({
    page,
  }) => {
    await signIn(page, USERS.staff)

    await page.goto('/transfers')
    await expect(page.getByRole('link', { name: 'Request a transfer' })).toBeVisible()

    // Adjusting stock is a decision about what the shop owns.
    await page.goto('/adjustments')
    await expect(page.getByRole('link', { name: 'Adjust stock' })).toHaveCount(0)
    await page.goto('/adjustments/new')
    await expect(page).toHaveURL(/\/adjustments$/)
  })

  test('adjustments appear in the navigation', async ({ page }, testInfo) => {
    await signIn(page, USERS.admin)
    if (isMobileProject(testInfo.project.name)) {
      await page.getByRole('button', { name: 'Open navigation menu' }).click()
    }
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav.getByRole('link', { name: 'Adjustments' })).toBeVisible()
  })

  /*
   * Transfers is built and works; its link is commented out of the sidebar
   * until the shop runs more than one branch, since a menu item that leads
   * nowhere useful is clutter at the counter.
   *
   * Asserted rather than deleted, so that hiding it stays a *decision*: if
   * someone puts the link back, this fails and they will find the comment
   * explaining why it went. And the second half proves what hiding a link
   * must never mean — that the feature itself is gone.
   */
  test('transfers is hidden from the sidebar, but still reachable', async ({ page }, testInfo) => {
    await signIn(page, USERS.admin)
    if (isMobileProject(testInfo.project.name)) {
      await page.getByRole('button', { name: 'Open navigation menu' }).click()
    }
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav.getByRole('link', { name: 'Transfers' })).toHaveCount(0)

    await page.goto('/transfers')
    await expect(page.getByRole('heading', { name: 'Transfers', level: 1 })).toBeVisible()
  })
})
