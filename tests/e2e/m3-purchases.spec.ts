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
  // `.last()`: a picker opened on an earlier line can still be mounted, and
  // two boxes share this placeholder. The one just opened is the last in the
  // DOM. With a single line open this is the same element either way.
  await page.getByPlaceholder('Name, SKU or barcode').last().fill(name)
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

  test('an accessory line can be classified too, but is not made to be', async ({ page }) => {
    /*
     * Main type began as a handset property - the database refused it on a
     * counted line outright. The shop buys accessories in the same
     * distinctions, so it is offered on everything now; it stays *required*
     * only on a serialised line, which stamps it onto every unit it creates.
     */
    const id = unique()
    await createSupplier(page, `E2E ClassSupp ${id}`)
    await createProduct(page, `E2E ClassCable ${id}`, 'Cables')

    await page.goto('/purchases/new')
    await pickSupplier(page, `E2E ClassSupp ${id}`)
    await pickProduct(page, `E2E ClassCable ${id}`)

    // Offered on an accessory line.
    const used = page.getByRole('button', { name: 'USED', exact: true })
    await expect(used).toBeVisible()

    // NEW CUT is not - it describes a physical handset.
    await page.getByRole('button', { name: 'GLOBAL', exact: true }).click()
    await expect(page.getByRole('button', { name: 'NEW CUT', exact: true })).toBeHidden()

    await used.click()
    await expect(used).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill('5')
    await page.getByRole('textbox', { name: 'Unit cost (₹)', exact: true }).fill('200')
    await page.getByRole('button', { name: 'Confirm purchase' }).click()
    await expect(page).toHaveURL(/\/purchases\/\d+$/)

    // And it survives onto the saved purchase.
    await expect(page.getByText('USED').first()).toBeVisible()
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
    /*
     * No Variant box, deliberately. The model tier belongs in the product name
     * - "iPhone 17 Pro Max" - because the product is what carries a default
     * price and what every report groups by; a tier hidden in a spec field
     * could be neither. RAM, storage and colour stay on the line, because a
     * product per storage x colour is two dozen rows for one model.
     */
    await expect(page.getByRole('textbox', { name: 'Variant', exact: true })).toHaveCount(0)

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

  test('a second line starts from the main type already in use', async ({ page }) => {
    /*
     * A shipment is nearly always all one kind. Resetting every added line to
     * NEW meant re-picking the same answer line after line, and the one that
     * got missed was booked in as the wrong type - which is not a cosmetic
     * mistake: main type drives the stock reports and, for NEW, which system
     * bills the handset.
     */
    const id = unique()
    await createProduct(page, `E2E Inherit A ${id}`, 'Mobiles (IMEI)')
    await createProduct(page, `E2E Inherit B ${id}`, 'Mobiles (IMEI)')

    await page.goto('/purchases/new')
    await pickProduct(page, `E2E Inherit A ${id}`)

    const typeButton = (n: number, type: string) =>
      page.getByTestId('purchase-line').nth(n).getByRole('button', { name: type, exact: true })

    await typeButton(0, 'USED').click()
    await expect(typeButton(0, 'USED')).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('button', { name: 'Add another line' }).click()
    // The classification block only appears once the line has a serialised
    // product on it - the inherited value is already in the line's state.
    await pickProduct(page, `E2E Inherit B ${id}`, 2)

    // The new line arrives as USED, not back at NEW.
    await expect(typeButton(1, 'USED')).toHaveAttribute('aria-pressed', 'true')
    await expect(typeButton(1, 'NEW')).toHaveAttribute('aria-pressed', 'false')

    // And it is still a per-line choice, not a lock.
    await typeButton(1, 'ER').click()
    await expect(typeButton(1, 'ER')).toHaveAttribute('aria-pressed', 'true')
    await expect(typeButton(0, 'USED')).toHaveAttribute('aria-pressed', 'true')
  })

  test('the same IMEI twice is caught in the box, not after submitting', async ({ page }) => {
    /*
     * Only the camera guarded against this, and only within one line. A typed
     * IMEI went through untouched until the server refused the whole purchase,
     * with a message naming a device it had created moments earlier in the
     * same transaction.
     */
    const id = unique()
    await createSupplier(page, `E2E DupSupp ${id}`)
    await createProduct(page, `E2E DupPhone ${id}`, 'Mobiles (IMEI)')
    const same = imei(1)

    await page.goto('/purchases/new')
    await pickSupplier(page, `E2E DupSupp ${id}`)
    await pickProduct(page, `E2E DupPhone ${id}`)
    await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill('2')
    await page.getByRole('textbox', { name: 'Unit cost (₹)', exact: true }).fill('20000')

    await page.getByRole('textbox', { name: 'Line 1 IMEI 1' }).fill(same)
    await page.getByRole('textbox', { name: 'Line 1 IMEI 2' }).fill(same)

    // Both copies are marked — which one is the mistake is the buyer's call.
    await expect(page.getByRole('textbox', { name: 'Line 1 IMEI 1' })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await expect(page.getByRole('textbox', { name: 'Line 1 IMEI 2' })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await expect(page.getByText(/This IMEI is already on this purchase/).first()).toBeVisible()

    // And it cannot be sent.
    await page.getByRole('button', { name: 'Confirm purchase' }).click()
    await expect(page.locator('[data-slot="alert"]')).toContainText(same)
    await expect(page).toHaveURL(/\/purchases\/new$/)

    // Correcting one clears both marks.
    await page.getByRole('textbox', { name: 'Line 1 IMEI 2' }).fill(imei(2))
    await expect(page.getByRole('textbox', { name: 'Line 1 IMEI 1' })).not.toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })

  test('a duplicate IMEI is caught across two lines as well', async ({ page }) => {
    const id = unique()
    await createSupplier(page, `E2E DupSupp2 ${id}`)
    await createProduct(page, `E2E DupPhoneA ${id}`, 'Mobiles (IMEI)')
    await createProduct(page, `E2E DupPhoneB ${id}`, 'Mobiles (IMEI)')
    const same = imei(3)

    await page.goto('/purchases/new')
    await pickSupplier(page, `E2E DupSupp2 ${id}`)
    await pickProduct(page, `E2E DupPhoneA ${id}`)
    await page.getByRole('textbox', { name: 'Line 1 IMEI 1' }).fill(same)

    await page.getByRole('button', { name: 'Add another line' }).click()
    await pickProduct(page, `E2E DupPhoneB ${id}`, 2)
    await page.getByRole('textbox', { name: 'Line 2 IMEI 1' }).fill(same)

    // The same handset cannot arrive on two lines of one delivery.
    await expect(page.getByRole('textbox', { name: 'Line 1 IMEI 1' })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await expect(page.getByRole('textbox', { name: 'Line 2 IMEI 1' })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })

  test('warranty is a date, and NEW is not asked for one', async ({ page }) => {
    /*
     * A period only answers "is it still covered?" after arithmetic against a
     * start date the buyer never agreed to. A used handset is sold with
     * "covered until the 14th", so that is what is recorded. NEW carries no
     * warranty here: that cover is the manufacturer's, and the handset is
     * billed in the other system anyway.
     */
    const id = unique()
    await createSupplier(page, `E2E WarrSupp ${id}`)
    await createProduct(page, `E2E WarrPhone ${id}`, 'Mobiles (IMEI)')

    await page.goto('/purchases/new')
    await pickSupplier(page, `E2E WarrSupp ${id}`)
    await pickProduct(page, `E2E WarrPhone ${id}`)

    // The line starts as NEW, so there is nothing to fill in.
    const until = page.getByRole('textbox', { name: 'Warranty until' })
    await expect(until).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: 'Warranty by' })).toHaveCount(0)

    // Any other type asks for the day cover ends.
    await page.getByRole('button', { name: 'USED', exact: true }).click()
    const box = page.locator('#warranty-l0')
    await expect(box).toBeVisible()
    await expect(box).toHaveAttribute('type', 'date')

    const ends = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10)
    await box.fill(ends)
    // Two fixed answers rather than free text, so a report can group by it.
    await choose(page.getByRole('combobox', { name: 'Warranty by' }), 'Shop warranty')

    await page.getByRole('textbox', { name: 'Unit cost (₹)', exact: true }).fill('9000')
    const serial = imei(7)
    await page.getByRole('textbox', { name: 'Line 1 IMEI 1' }).fill(serial)
    await page.getByRole('button', { name: 'Confirm purchase' }).click()
    await expect(page).toHaveURL(/\/purchases\/\d+$/)

    // The date reached the handset, not a period converted into one.
    await page.goto('/devices')
    await page.getByLabel('Search devices').fill(serial)
    await page.getByRole('button', { name: 'Search' }).click()
    await page.getByRole('link', { name: serial }).first().click()
    await expect(page.getByTestId('device-warranty')).toContainText('Shop warranty')

    // And it is on the warranty screen, which is the point of recording it.
    await page.goto('/inventory/warranty?days=30')
    // Card and table both render; only one is on screen at this width.
    await expect(page.getByText(serial).and(page.locator(':visible')).first()).toBeVisible()
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

  test('a supplier nobody has bought from before can be added from the form', async ({ page }) => {
    await signIn(page, USERS.admin)
    const id = unique()
    const name = `E2E NewSup ${id}`

    await page.goto('/purchases/new')
    await page.getByRole('combobox', { name: 'Supplier' }).click()
    await page.getByPlaceholder('Name, phone, email or GST').fill(name)
    await page.getByRole('option', { name: `Add “${name}” as a new supplier` }).click()

    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(name)
    await page.getByLabel('Phone', { exact: true }).fill(`91${id}`)
    await page.getByRole('button', { name: 'Create and use' }).click()

    // Chosen on the form that asked for it, with the delivery still half-typed.
    await expect(page.getByRole('combobox', { name: 'Supplier' })).toContainText(name)
  })

  test('a product the catalogue has never heard of can be added from the line', async ({
    page,
  }) => {
    await signIn(page, USERS.admin)
    const id = unique()
    const name = `E2E Unheard Cable ${id}`

    await page.goto('/purchases/new')
    await page.getByRole('combobox', { name: 'Line 1 product' }).click()
    await page.getByPlaceholder('Name, SKU or barcode').fill(name)

    // Nothing matches, so the way on is offered rather than the buyer being
    // sent to the products screen with a half-typed delivery behind them.
    await page.getByRole('option', { name: `Add “${name}” as a new product` }).click()

    // What was searched for is already in the box.
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(name)
    await choose(page.getByRole('combobox', { name: 'Category', exact: true }), 'Cables')

    /*
     * A tax rate is required on a registered shop, and there is no "none"
     * option. This dialog used to send no rate at all, so a product added
     * mid-delivery was saved untaxed and the first bill for it quietly used
     * whatever the shop default happened to be.
     */
    const create = page.getByRole('button', { name: 'Create and use' })
    await expect(create).toBeDisabled()
    await choose(page.getByRole('combobox', { name: 'Tax rate', exact: true }), 'GST 18%')
    await expect(create).toBeEnabled()
    await create.click()

    // And it lands on the line that asked for it.
    await expect(page.getByRole('combobox', { name: 'Line 1 product' })).toContainText(name)

    // The rate really is on the product, not merely picked in a dialog.
    await page.goto('/products')
    await page.getByLabel('Search products').fill(name)
    await page.getByRole('button', { name: 'Search' }).click()
    await page.getByRole('link', { name }).first().click()
    await expect(
      page.getByRole('combobox', { name: 'Tax rate', exact: true }),
    ).toContainText('GST 18%')
  })
})

test.describe('the bill date and the day it arrived', () => {
  test('both are on the form, and both are kept', async ({ page }) => {
    await signIn(page, USERS.admin)
    const id = unique()
    const name = `E2E TwoDate Cable ${id}`
    await createProduct(page, name, 'Cables')
    const supplierName = `E2E TwoDateSup ${id}`
    await createSupplier(page, supplierName)

    await page.goto('/purchases/new')
    await pickSupplier(page, supplierName)

    // The supplier billed it a week before the van turned up.
    await page.getByLabel('Purchase date').fill('2026-03-02')
    await page.getByLabel('Arrived date').fill('2026-03-09')

    await pickProduct(page, name)
    await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill('3')
    await page.getByRole('textbox', { name: 'Unit cost (₹)', exact: true }).fill('100')
    await page.getByRole('button', { name: 'Confirm purchase' }).click()
    await expect(page).toHaveURL(/\/purchases\/\d+$/)

    // Both dates survive, and the detail says so rather than showing one.
    await expect(page.getByText(/Billed 2 Mar 2026/)).toBeVisible()
    await expect(page.getByText(/Arrived 9 Mar 2026/)).toBeVisible()
  })
})

test.describe('a serial number beside the IMEI', () => {
  test('the category asks for it, and the purchase line offers it', async ({ page }) => {
    await signIn(page, USERS.admin)
    const id = unique()
    const categoryName = `E2E DualId ${id}`
    const productName = `E2E DualId Phone ${id}`
    // Captured once: imei() reads the clock, so calling it twice gives two
    // different numbers and the assertion would look for one never entered.
    const phoneImei = imei(60)

    // A phone category that also wants the serial off the box.
    await page.goto('/settings/catalogue')
    await page.getByRole('tab', { name: 'Categories' }).click()
    await page.getByRole('textbox', { name: 'Name', exact: true }).last().fill(categoryName)
    await page.getByRole('checkbox', { name: 'Tracked individually' }).first().check()
    await choose(
      page.getByRole('combobox', { name: 'Identified by' }).first(),
      'IMEI and serial number (phones)',
    )
    await page.getByRole('button', { name: 'Add category' }).click()
    await expect(
      page.locator('[data-testid="category-row"]').filter({ hasText: categoryName }),
    ).toContainText('IMEI + serial')

    await createProduct(page, productName, `${categoryName} (IMEI + serial)`)
    await createSupplier(page, `E2E DualIdSup ${id}`)

    await page.goto('/purchases/new')
    await pickSupplier(page, `E2E DualIdSup ${id}`)
    await pickProduct(page, productName)
    await page.getByRole('button', { name: 'NEW', exact: true }).click()
    await page.getByRole('textbox', { name: 'Unit cost (₹)', exact: true }).fill('20000')

    // The IMEI is required; the serial box is offered beneath it, marked
    // optional, and a handset books in whether or not it is filled.
    const serial = page.getByRole('textbox', { name: 'Line 1 serial 1' })
    await expect(serial).toBeVisible()
    await expect(serial).toHaveAttribute('placeholder', /optional/i)

    await page.getByRole('textbox', { name: 'Line 1 IMEI 1' }).fill(phoneImei)
    await serial.fill(`E2ESN${id}`)
    await page.getByRole('button', { name: 'Confirm purchase' }).click()
    await expect(page).toHaveURL(/\/purchases\/\d+$/)

    // And the handset carries both, each labelled for what it is. The
    // purchase we just confirmed links to the units it created.
    await page.getByRole('link', { name: phoneImei }).first().click()
    await expect(page.getByText(`E2ESN${id}`)).toBeVisible()
    await expect(page.getByText('Serial', { exact: true })).toBeVisible()
  })
})

test.describe('a message that cannot be seen is not a message', () => {
  test('a validation error scrolls itself into view on a long form', async ({ page }) => {
    await signIn(page, USERS.admin)
    await page.goto('/purchases/new')

    // Long enough that the top of the form is well off the screen.
    for (let i = 0; i < 4; i++) {
      await page.getByRole('button', { name: 'Add another line' }).click()
    }
    const confirm = page.getByRole('button', { name: 'Confirm purchase' })
    await confirm.scrollIntoViewIfNeeded()

    // No product on any line, so this fails at the top of the form - which
    // used to mean nothing visibly happened at all.
    await confirm.click()

    const error = page.getByRole('alert').filter({ hasText: 'Every line needs a product.' })
    await expect(error).toBeVisible()
    await expect(error).toBeInViewport()
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
