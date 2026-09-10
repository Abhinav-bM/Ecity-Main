import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { choose, expectNoHorizontalOverflow, signIn, USERS } from './helpers'

/**
 * M9 — global search and IMEI device history.
 *
 * These four tests are the module's acceptance criteria, in order.
 */

const PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe!2026'
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
  String(37_400_000_000_000 + (Date.now() % 1_000_000) * 100 + n)

/** Register a handset, optionally dual-SIM, and return its device URL. */
async function registerDevice(
  page: Page,
  name: string,
  identifiers: string[],
): Promise<string> {
  await page.goto('/products/new')
  await page.getByRole('textbox', { name: 'Product name', exact: true }).fill(name)
  await choose(page.getByRole('combobox', { name: 'Category', exact: true }), 'Mobiles (IMEI)')
  await page.getByRole('button', { name: 'Create product' }).click()
  await expect(page).toHaveURL(/\/products$/)

  /*
   * How many IMEI fields the form shows is a business-wide setting, so this
   * always sets the number it needs rather than assuming what the last test
   * left behind. The field is labelled "IMEI" when there is one and
   * "IMEI 1", "IMEI 2" when there are several.
   */
  await page.goto('/settings/business')
  // Cleared, then typed. fill() alone left the previous value with the new
  // one appended ("12"), which failed validation, sent no request, and looked
  // exactly like a hang.
  const slots = page.getByRole('textbox', { name: 'IMEI fields per device', exact: true })
  await slots.click()
  await slots.press('ControlOrMeta+a')
  await slots.press('Backspace')
  await slots.pressSequentially(String(identifiers.length))
  await expect(slots).toHaveValue(String(identifiers.length))
  await page.getByRole('button', { name: /^Save/ }).last().click()
  await expect(page.getByText(/Saved/i).first()).toBeVisible({ timeout: 10_000 })

  await page.goto('/devices/new')
  for (const [i, value] of identifiers.entries()) {
    const label = identifiers.length === 1 ? 'IMEI' : `IMEI ${i + 1}`
    await page.getByRole('textbox', { name: label, exact: true }).fill(value)
  }
  await page.getByRole('combobox', { name: 'Product', exact: true }).click()
  await page.getByPlaceholder('Name, SKU or barcode').fill(name)
  await page
    .getByTestId('product-picker-list')
    .getByRole('option', { name: new RegExp(name) })
    .first()
    .click()
  await page.getByRole('button', { name: 'GLOBAL', exact: true }).click()
  await page.getByRole('checkbox', { name: 'NEW CUT' }).click()
  await page.getByRole('button', { name: 'Add device' }).click()
  await expect(page).toHaveURL(/\/devices$/)

  await page.getByRole('searchbox', { name: 'Search devices' }).fill(identifiers[0]!)
  await page.keyboard.press('Enter')
  await page.getByRole('link', { name: new RegExp(identifiers[0]!) }).first().click()
  await expect(page).toHaveURL(/\/devices\/\d+$/)
  return page.url()
}

async function search(page: Page, term: string) {
  await page.getByRole('button', { name: 'Find anything' }).first().click()
  await page.getByRole('textbox', { name: 'Find anything' }).fill(term)
}

test.describe('global search', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  /** Criterion 1. */
  test('a full IMEI opens the device, a partial one lists candidates', async ({ page }) => {
    const id = unique()
    const one = imei(1)
    const url = await registerDevice(page, `E2E Search Phone ${id}`, [one])

    // A complete IMEI is unambiguous — go straight there.
    await page.goto('/dashboard')
    await search(page, one)
    await expect(page).toHaveURL(url)

    // A partial one cannot be: show the candidates instead of guessing.
    await page.goto('/dashboard')
    await search(page, one.slice(0, 12))
    await expect(page.getByTestId('search-results')).toBeVisible()
    await expect(page.getByTestId('search-hit').first()).toBeVisible()
    // Still on the dashboard — it did not jump anywhere.
    await expect(page).toHaveURL(/\/dashboard$/)

    // Clicking a candidate goes to that device.
    await page.getByTestId('search-hit').first().click()
    await expect(page).toHaveURL(/\/devices\/\d+$/)
  })

  /** Criterion 1, the dual-SIM half. */
  test('any IMEI of a dual-SIM handset opens the same device', async ({ page }) => {
    const id = unique()
    const first = imei(2)
    const second = imei(3)
    const url = await registerDevice(page, `E2E Dual Phone ${id}`, [first, second])

    for (const value of [first, second]) {
      await page.goto('/dashboard')
      await search(page, value)
      await expect(page).toHaveURL(url)
    }

    // FR-30.5: the identity header lists every identifier, primary marked.
    // Each appears twice - the heading and the identifier list - so scope it.
    const identity = page.getByRole('main')
    await expect(identity.getByText(first).first()).toBeVisible()
    await expect(identity.getByText(second).first()).toBeVisible()
    await expect(page.getByText('Primary').first()).toBeVisible()
    await expect(page.getByText('GLOBAL', { exact: false }).first()).toBeVisible()
    await expect(page.getByText('NEW CUT', { exact: false }).first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('the box is reachable from every screen, by keyboard', async ({ page }) => {
    for (const path of ['/dashboard', '/devices', '/sales']) {
      await page.goto(path)
      // The shortcut is bound on hydration, so pressing it the instant the
      // HTML lands does nothing. Waiting for the button that carries the same
      // action is waiting for exactly the code that listens for the key.
      await expect(page.getByRole('button', { name: 'Find anything' })).toBeVisible()
      await page.keyboard.press('ControlOrMeta+k')
      await expect(page.getByRole('textbox', { name: 'Find anything' })).toBeVisible()
      await page.keyboard.press('Escape')
    }
  })

  test('says so plainly when nothing matches', async ({ page }) => {
    await page.goto('/dashboard')
    await search(page, 'zzzznothinghere')
    await expect(page.getByText(/Nothing matched/)).toBeVisible()
  })
})

test.describe('device history', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  /** Criteria 2 and 4. */
  test('shows the whole life with working links, and renders fast', async ({ page }) => {
    const id = unique()
    const one = imei(4)
    const name = `E2E Life Phone ${id}`
    const url = await registerDevice(page, name, [one])

    // Sell it, take it back, grade it, correct it — a life with stages.
    await page.goto('/billing')
    await page.getByRole('textbox', { name: 'Scan or search' }).fill(one)
    await page.getByTestId('bill-search-results').getByRole('button').first().click()
    await page.getByRole('textbox', { name: 'Price (₹)', exact: true }).fill('20000')
    await page.getByRole('button', { name: /^\+ Cash$/ }).click()
    const save = page.getByRole('button', { name: /^Save bill/ })
    await save.scrollIntoViewIfNeeded()
    await save.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/sales\/\d+$/)

    await page.getByRole('link', { name: 'Take a return' }).click()
    await page.getByRole('textbox', { name: /Return quantity/ }).first().fill('1')
    await page.getByRole('button', { name: 'Record return' }).click()
    await expect(page).toHaveURL(/\/returns\/\d+$/)

    await page.goto('/returns/inspection')
    await page
      .locator('[data-testid="inspection-row"]:visible')
      .filter({ hasText: one })
      .getByRole('button', { name: 'Inspect' })
      .click()
    await choose(page.getByRole('combobox', { name: 'Condition' }), /Used/)
    await page.getByRole('button', { name: 'Record inspection' }).click()
    // Wait for it to actually land, or the history is read too early.
    await expect(
      page.locator('[data-testid="inspection-row"]:visible').filter({ hasText: one }),
    ).toHaveCount(0)

    // Now read the history, and time the render (PRD §9.1: under 1.5 s).
    const started = Date.now()
    await page.goto(url)
    await expect(page.getByTestId('device-timeline')).toBeVisible()
    const elapsed = Date.now() - started
    expect(elapsed).toBeLessThan(1500)

    const timeline = page.getByTestId('device-timeline')
    await expect(timeline).toContainText('Purchased')
    await expect(timeline).toContainText('Sold')
    await expect(timeline).toContainText('Returned')
    await expect(timeline).toContainText('Inspected')

    // FR-30.6 — the links have to work, not just be there.
    const invoiceLink = timeline.getByRole('link').filter({ hasText: /INV/ }).first()
    await expect(invoiceLink).toBeVisible()
    await invoiceLink.click()
    await expect(page).toHaveURL(/\/sales\/\d+$/)

    // FR-30.5's commercials: what it went for, and whether it was paid for.
    await page.goto(url)
    const money = page.getByTestId('device-commercials')
    await expect(money).toContainText('20,000.00')
    await expect(money).toContainText('PAID')
    await expect(money).toContainText('Paid / on credit')
    // ...and its current position, including where it was before.
    await expect(page.getByRole('main')).toContainText('Previous branch')
    await expectNoHorizontalOverflow(page)
  })
})

/**
 * Criterion 3, verified at the API rather than through the UI — a hidden menu
 * is not a permission.
 */
test.describe('search respects branch permissions', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'viewport-independent')
  })

  async function apiSignIn(request: APIRequestContext, email: string) {
    const res = await request.post('/api/auth/login', { data: { email, password: PASSWORD } })
    expect(res.ok(), `sign-in failed for ${email}`).toBe(true)
  }

  test('a branch-limited user cannot find another branch’s customer by phone', async ({
    request,
    page,
  }) => {
    const id = unique()
    const phone = `9${id}01`
    const name = `E2E North Buyer ${id}`
    const product = `E2E North Cable ${id}`

    /*
     * Make this person North Branch's customer by billing them there. The
     * seeded manager is assigned to MAIN only, so North is exactly the branch
     * they must not be able to reach into.
     */
    await signIn(page, USERS.admin)
    await page.goto('/customers/new')
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
    await page.getByRole('textbox', { name: 'Phone', exact: true }).first().fill(phone)
    await page.getByRole('button', { name: /^Create customer$/ }).click()
    await expect(page).toHaveURL(/\/customers$/)

    // Stock something at North, and sell it to them there.
    await page.goto('/products/new')
    await page.getByRole('textbox', { name: 'Product name', exact: true }).fill(product)
    await choose(page.getByRole('combobox', { name: 'Category', exact: true }), 'Cables')
    await page.getByRole('button', { name: 'Create product' }).click()
    await expect(page).toHaveURL(/\/products$/)

    // The branch switcher is a menu, not a listbox.
    await page.getByRole('button', { name: /Active branch/ }).click()
    await page.getByRole('menuitem', { name: /North/ }).click()
    await expect(page.getByRole('button', { name: /Active branch: North/ })).toBeVisible()

    await page.goto('/suppliers/new')
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(`E2E NSup ${id}`)
    await page.getByRole('button', { name: 'Create supplier' }).click()
    await page.goto('/purchases/new')
    await page.getByRole('combobox', { name: 'Supplier', exact: true }).click()
    await page.getByPlaceholder('Name, phone, email or GST').fill(`E2E NSup ${id}`)
    await page
      .getByTestId('supplier-picker-list')
      .getByRole('option', { name: `E2E NSup ${id}` })
      .first()
      .click()
    await page.getByRole('combobox', { name: 'Line 1 product' }).click()
    await page.getByPlaceholder('Name, SKU or barcode').fill(product)
    await page
      .getByTestId('product-picker-list')
      .getByRole('option', { name: new RegExp(product) })
      .first()
      .click()
    await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill('1')
    await page.getByRole('textbox', { name: 'Unit cost (₹)', exact: true }).fill('100')
    await page.getByRole('button', { name: 'Confirm purchase' }).click()
    await expect(page).toHaveURL(/\/purchases\/\d+$/)

    await page.goto('/billing')
    await page.getByRole('textbox', { name: 'Scan or search' }).fill(product)
    await page.getByTestId('bill-search-results').getByRole('button').first().click()
    await page.getByRole('textbox', { name: 'Price (₹)', exact: true }).fill('500')
    await page.getByRole('combobox', { name: /Customer/ }).first().click()
    await page.getByPlaceholder(/Name, phone/).fill(phone)
    await page.getByRole('option', { name: new RegExp(name) }).first().click()
    await page.getByRole('button', { name: /^\+ Cash$/ }).click()
    const save = page.getByRole('button', { name: /^Save bill/ })
    await save.scrollIntoViewIfNeeded()
    await save.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/sales\/\d+$/)

    // The owner, who sees every branch, finds them by phone.
    await apiSignIn(request, 'admin@ecity.local')
    const asAdmin = await request.get(`/api/search?q=${phone}`)
    expect(asAdmin.ok()).toBe(true)
    const adminBody = (await asAdmin.json()) as {
      groups: { kind: string; hits: { title: string }[] }[]
    }
    const adminNames = adminBody.groups
      .filter((g) => g.kind === 'customer')
      .flatMap((g) => g.hits.map((h) => h.title))
    expect(adminNames).toContain(name)

    /*
     * Put the admin back where they started. The active branch is stored on
     * the session, so leaving it on North would follow this user into every
     * later spec - and a billing test that then fails looks like a billing
     * bug rather than the leftover it is.
     */
    await page.getByRole('button', { name: /Active branch/ }).click()
    await page.getByRole('menuitem', { name: /Main/ }).click()
    await expect(page.getByRole('button', { name: /Active branch: Main/ })).toBeVisible()

    // The MAIN-only manager does not — checked at the API, not the menu.
    await apiSignIn(request, 'manager@ecity.local')
    const asManager = await request.get(`/api/search?q=${phone}`)
    expect(asManager.ok()).toBe(true)
    const managerBody = (await asManager.json()) as {
      total: number
      groups: { kind: string; hits: { title: string }[] }[]
    }
    const managerNames = managerBody.groups
      .filter((g) => g.kind === 'customer')
      .flatMap((g) => g.hits.map((h) => h.title))
    expect(managerNames).not.toContain(name)
  })

  test('an unauthenticated search is refused', async ({ request }) => {
    const res = await request.get('/api/search?q=anything')
    expect(res.status()).toBe(401)
  })
})

/**
 * M14 follow-on: scanning into the global search.
 *
 * An IMEI is fifteen digits and the commonest reason to open this box is a
 * handset in somebody's hand. The decode itself is covered by the unit tests;
 * what matters here is that the button exists where there is a camera, and
 * nowhere there is not.
 */
test.describe('scanning into the search', () => {
  test('offers the camera inside the search palette', async ({ page }) => {
    await signIn(page, USERS.admin)
    await page.goto('/dashboard')

    await page.getByRole('button', { name: 'Find anything' }).click()
    await expect(page.getByRole('textbox', { name: 'Find anything' })).toBeVisible()

    const hasCamera = await page.evaluate(
      () => typeof navigator.mediaDevices?.getUserMedia === 'function',
    )
    const scan = page.getByRole('button', { name: 'Scan an IMEI to search' })
    if (hasCamera) {
      await expect(scan).toBeVisible()
    } else {
      await expect(scan).toHaveCount(0)
    }
  })
})
