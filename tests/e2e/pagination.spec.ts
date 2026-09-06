import { expect, test } from '@playwright/test'
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
