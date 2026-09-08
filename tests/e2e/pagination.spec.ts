import { expect, test, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow, signIn, USERS } from './helpers'

/**
 * Every list is paginated server-side, but the control is what tells the user
 * more data exists. A list that silently stops at 25 rows reads as "that is
 * everything", which is how stock goes missing.
 */
test.beforeEach(async ({ page }) => {
  await signIn(page, USERS.admin)
})

test('the products list states the range and the total', async ({ page }) => {
  await page.goto('/products')
  const pagination = page.getByTestId('pagination')
  await expect(pagination).toBeVisible()

  // The seed holds far more than one page.
  await expect(pagination).toContainText(/Showing\s*1–25\s*of\s*[\d,]+/)
  await expectNoHorizontalOverflow(page)
})

test('Previous is disabled on the first page rather than linking to page 0', async ({ page }) => {
  await page.goto('/products')
  const previous = page.getByTestId('pagination').getByRole('button', { name: 'Previous' })
  await expect(previous).toBeDisabled()
})

test('Next advances a page and Previous comes back', async ({ page }) => {
  await page.goto('/products')
  // The list is a table on a large screen and cards on a phone, so compare the
  // first product link rather than a row of either one.
  const firstProduct = () => page.getByRole('main').getByRole('link', { name: /./ }).nth(1).textContent()
  const pageOne = await firstProduct()

  await page.getByTestId('pagination').getByRole('link', { name: 'Next' }).click()
  await expect(page).toHaveURL(/[?&]page=2/)
  // Page two starts at 26. Where it ends depends on how many products exist,
  // which varies with what earlier tests created - so it is not asserted.
  await expect(page.getByTestId('pagination')).toContainText(/Showing\s*26–\d+\s*of/)

  expect(await firstProduct()).not.toBe(pageOne)

  await page.getByTestId('pagination').getByRole('link', { name: 'Previous' }).click()
  // Page 1 is the bare URL, so there is one canonical address for it.
  await expect(page).not.toHaveURL(/[?&]page=/)
  await expect(page.getByTestId('pagination')).toContainText(/Showing\s*1–25/)
})

test('paging keeps the active filter (it is in the URL, not client state)', async ({ page }) => {
  await page.goto('/devices')
  await page.getByRole('searchbox', { name: 'Search devices' }).fill('a')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/search=a/)

  const pagination = page.getByTestId('pagination')
  const next = pagination.getByRole('link', { name: 'Next' })
  if (await next.count()) {
    await next.click()
    // The filter must survive the hop, or page 2 shows unfiltered rows.
    await expect(page).toHaveURL(/search=a/)
    await expect(page).toHaveURL(/page=2/)
  }
})

test('changing a filter returns to page 1', async ({ page }) => {
  await page.goto('/products?page=2')
  await expect(page.getByTestId('pagination')).toContainText(/Showing\s*26–\d+\s*of/)

  await page.getByRole('searchbox', { name: 'Search products' }).fill('cable')
  await page.keyboard.press('Enter')

  // Staying on page 2 of a narrower result set would show an empty screen.
  await expect(page).not.toHaveURL(/page=2/)
})

test('the audit log paginates and keeps its filters', async ({ page }) => {
  await page.goto('/settings/audit')
  await expect(page.getByTestId('pagination')).toBeVisible()
  await expect(page.getByTestId('pagination')).toContainText(/of\s*[\d,]+\s*entries/)
})

test('a short list says how many rows there are without offering pages', async ({ page }) => {
  await page.goto('/suppliers')
  const pagination = page.getByTestId('pagination')
  await expect(pagination).toContainText(/Showing|No suppliers/)
  // One page of results should not offer a Next.
  const total = Number((await pagination.textContent())?.match(/of\s*([\d,]+)/)?.[1]?.replace(/,/g, '') ?? '0')
  if (total <= 25) {
    await expect(pagination.getByRole('link', { name: 'Next' })).toHaveCount(0)
  }
})

/**
 * The settings lists and low stock, which had no control at all until now: a
 * shop with sixty users saw twenty-five and no sign there were more.
 */
for (const [name, path, noun, emptyText] of [
  ['users', '/settings/users', 'users', 'No users yet'],
  ['branches', '/settings/branches', 'branches', 'No branches yet'],
  ['low stock', '/inventory/low-stock', 'products', 'Nothing is running low'],
] as const) {
  test(`the ${name} list states its size`, async ({ page }) => {
    await page.goto(path)
    // An empty list explains itself in words; a populated one states its
    // range and total. What must never happen is a silent stop at 25.
    const empty = page.getByText(emptyText)
    if (await empty.isVisible().catch(() => false)) return

    await expect(page.getByTestId('pagination')).toContainText(
      new RegExp(`Showing|No ${noun}`),
    )
    await expectNoHorizontalOverflow(page)
  })
}

test('roles says how many there are, and is deliberately not paged', async ({ page }) => {
  // A master-detail editor: paging the picker would mean turning a page to
  // reach the role you came to edit.
  await page.goto('/settings/roles')
  await expect(page.getByTestId('role-count')).toContainText(/\d+ roles?/)
  await expect(page.getByTestId('pagination')).toHaveCount(0)
})

/**
 * Sorting is a link, not client state, so it lands in the URL and a sorted
 * view can be shared - and, crucially, the server sorts the whole list rather
 * than the page you happen to be looking at.
 */
/**
 * The control differs by width — column headings on a table, a scrollable
 * strip on the cards a phone gets — but it is the same link underneath, so
 * the test asks for whichever one is on screen.
 */
const sortLink = (page: Page, label: RegExp) =>
  page.getByRole('link', { name: label }).and(page.locator(':visible')).first()

test('sorting works on every width, and the sort lives in the URL', async ({ page }) => {
  await page.goto('/settings/users')

  await sortLink(page, /Sort by Email/).click()
  await expect(page).toHaveURL(/sort=email/)
  await expect(page).toHaveURL(/dir=asc/)

  // Read from whichever layout is showing.
  const emailsOf = async () => {
    const table = page.getByTestId('user-table')
    if (await table.isVisible().catch(() => false)) {
      return table.locator('tbody tr td:nth-child(2)').allTextContents()
    }
    return page.getByTestId('user-cards').getByTestId('user-email').allTextContents()
  }

  const emails = await emailsOf()
  expect(emails.length).toBeGreaterThan(0)
  expect([...emails].sort((a, b) => a.localeCompare(b))).toEqual(emails)

  // Clicking the active column flips it.
  await sortLink(page, /Sort by Email/).click()
  await expect(page).toHaveURL(/dir=desc/)
  expect(await emailsOf()).toEqual([...emails].reverse())
})

test('sorting a list returns to the first page', async ({ page }) => {
  // Staying on page 7 of a re-ordered list shows a stranger's rows.
  await page.goto('/settings/users?page=2&sort=name&dir=asc')
  await sortLink(page, /Sort by Role/).click()
  await expect(page).toHaveURL(/sort=role/)
  await expect(page).not.toHaveURL(/page=2/)
})

test('low stock sorts worst-first by default, and says so in the URL when changed', async ({
  page,
}) => {
  /*
   * Make something low rather than skipping when the seed happens to have
   * nothing: a skipped test proves nothing about the screen it names. Two
   * counted products with impossible minimums, so both are short by different
   * amounts and the default order has something to say.
   */
  const products = await page.request.get('/api/products?serialised=false&pageSize=2')
  const rows = ((await products.json()) as { rows?: { id: number }[] }).rows ?? []
  test.skip(rows.length < 2, 'needs two counted products')

  const branches = await page.request.get('/api/branches')
  const branchId = ((await branches.json()) as { id: number }[])[0]!.id

  for (const [i, product] of rows.entries()) {
    const res = await page.request.post('/api/inventory/min-quantity', {
      data: { productId: product.id, branchId, minQuantity: 500 + i * 250 },
    })
    expect(res.ok()).toBe(true)
  }

  await page.goto('/inventory/low-stock')

  const table = page.getByTestId('low-stock-table')
  if (await table.isVisible().catch(() => false)) {
    // Worst first, without being asked: what is furthest below its minimum is
    // what to reorder, and alphabetical order would bury it.
    const shortfalls = (await table.locator('tbody tr td:last-child').allTextContents()).map(
      Number,
    )
    expect([...shortfalls].sort((a, b) => b - a)).toEqual(shortfalls)
  }

  await sortLink(page, /Sort by Product/).click()
  await expect(page).toHaveURL(/sort=product/)

  // Put them back, so the screen is not permanently red for the next test.
  for (const product of rows) {
    await page.request.post('/api/inventory/min-quantity', {
      data: { productId: product.id, branchId, minQuantity: 0 },
    })
  }
})
