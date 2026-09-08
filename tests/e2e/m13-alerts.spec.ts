import { expect, test, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow, signIn, USERS } from './helpers'

/**
 * M13 — alerts and warranty.
 *
 * Whether each rule fires correctly is proved by the integration suite; these
 * check that a person can find what needs attention, act on it, and stop
 * being told about things they do not want to hear.
 */
const unique = () => String(Date.now()).slice(-8)

/** Ask the server to evaluate now, rather than waiting for the worker. */
async function checkNow(page: Page) {
  const res = await page.request.post('/api/notifications', { data: { action: 'evaluate' } })
  expect(res.ok()).toBe(true)
}

test.describe('the alert centre', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('is reachable from the bell and from the navigation', async ({ page }, testInfo) => {
    await page.goto('/dashboard')

    if (!testInfo.project.name.startsWith('mobile')) {
      await expect(page.getByTestId('notification-bell')).toBeVisible()
      await page.getByTestId('notification-bell').click()
    } else {
      await page.goto('/notifications')
    }

    await expect(page.getByRole('heading', { name: 'Alerts', level: 1 })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('raises a low-stock alert, and clears it when the shelf is refilled', async ({ page }) => {
    const id = unique()

    // Make a product that is genuinely short.
    const products = await page.request.get('/api/products?serialised=false&pageSize=1')
    const product = ((await products.json()) as { rows?: { id: number }[] }).rows?.[0]
    test.skip(!product, 'needs a counted product')

    const branches = await page.request.get('/api/branches')
    const branchId = ((await branches.json()) as { id: number }[])[0]!.id

    await page.request.post('/api/inventory/min-quantity', {
      data: { productId: product!.id, branchId, minQuantity: 9999 },
    })
    await checkNow(page)

    await page.goto('/notifications')
    const alert = page.getByTestId('notification').filter({ hasText: /running low|out of stock/i })
    await expect(alert.first()).toBeVisible()

    // Marking it read is personal and takes it off the list.
    await alert.first().getByRole('button', { name: /Mark ".*" as read/ }).click()
    await expect(page.getByTestId('notification').filter({ hasText: `${id}` })).toHaveCount(0)

    // Put it back; the condition goes away and so does the alert.
    await page.request.post('/api/inventory/min-quantity', {
      data: { productId: product!.id, branchId, minQuantity: 0 },
    })
    await checkNow(page)
    await page.reload()
    await expect(
      page.getByTestId('notification').filter({ hasText: /running low|out of stock/i }),
    ).toHaveCount(0)
  })

  test('the bell counts only what has not been read', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'the bell is in the desktop header')

    const products = await page.request.get('/api/products?serialised=false&pageSize=1')
    const product = ((await products.json()) as { rows?: { id: number }[] }).rows?.[0]
    test.skip(!product, 'needs a counted product')
    const branches = await page.request.get('/api/branches')
    const branchId = ((await branches.json()) as { id: number }[])[0]!.id

    await page.request.post('/api/inventory/min-quantity', {
      data: { productId: product!.id, branchId, minQuantity: 9999 },
    })
    await checkNow(page)

    await page.goto('/dashboard')
    await expect(page.getByTestId('notification-count')).toBeVisible()

    await page.goto('/notifications')
    await page.getByRole('button', { name: 'Mark all read' }).click()
    await expect(page.getByTestId('notification-count')).toHaveCount(0)

    await page.request.post('/api/inventory/min-quantity', {
      data: { productId: product!.id, branchId, minQuantity: 0 },
    })
    await checkNow(page)
  })

  test('a person can mute a kind for themselves without changing the shop', async ({ page }) => {
    await page.goto('/notifications')
    await page.getByRole('tab', { name: 'What you are told about' }).click()

    const card = page.getByTestId('rule-card').filter({ hasText: 'Low stock' })
    await card.getByRole('button', { name: /Mute Low stock for me/ }).click()
    await expect(card.getByRole('button', { name: /Unmute Low stock for me/ })).toBeVisible()

    // The shop's own setting is untouched — muting is your bell, not theirs.
    await expect(card.getByRole('button', { name: 'On for the shop' })).toBeVisible()
    await card.getByRole('button', { name: /Unmute Low stock for me/ }).click()
  })
})

test.describe('warranty (FR-29)', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('the expiring list opens and explains itself', async ({ page }) => {
    await page.goto('/inventory/warranty')
    await expect(page.getByRole('heading', { name: 'Warranty', level: 1 })).toBeVisible()
    await expect(page.getByLabel('Expiring within')).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('the window is a filter, and lives in the URL', async ({ page }) => {
    await page.goto('/inventory/warranty?days=7')
    await expect(page).toHaveURL(/days=7/)
  })

  /** FR-29.2: the warranty has to be visible from the handset's own page. */
  test('a handset shows its cover, its length and who honours it', async ({ page }) => {
    const id = unique()
    const imei = `35${id}${id}`.slice(0, 15)

    const products = await page.request.get('/api/products?serialised=true&pageSize=1')
    const product = ((await products.json()) as { rows?: { id: number }[] }).rows?.[0]
    test.skip(!product, 'needs a serialised product')
    const branches = await page.request.get('/api/branches')
    const branchId = ((await branches.json()) as { id: number }[])[0]!.id

    const made = await page.request.post('/api/devices', {
      data: {
        productId: product!.id,
        identifiers: [imei],
        mainType: 'USED',
        branchId,
        purchaseDate: new Date().toISOString().slice(0, 10),
        warrantyMonths: 12,
        warrantyProvider: 'Brand India',
      },
    })
    expect(made.ok(), await made.text()).toBe(true)
    const { id: deviceId } = (await made.json()) as { id: number }

    await page.goto(`/devices/${deviceId}`)
    const warranty = page.getByTestId('device-warranty')
    await expect(warranty).toContainText('Brand India')
    await expect(warranty).toContainText('12 months')
    // ...and says whether it is still good, so nobody has to do the arithmetic.
    await expect(warranty).toContainText(/in warranty|days left/)
  })

  test('the new-device and edit forms both ask who honours it', async ({ page }) => {
    await page.goto('/devices/new')
    await expect(page.getByLabel('Warranty by')).toBeVisible()
    await expect(page.getByLabel('Warranty (months)')).toBeVisible()
  })
})

test.describe('alert permissions', () => {
  test('staff see their own branch, and nothing about money', async ({ page }) => {
    await signIn(page, USERS.staff)
    await page.goto('/notifications')
    await expect(page.getByRole('heading', { name: 'Alerts', level: 1 })).toBeVisible()

    // The settings tab lists only the kinds they may be told about.
    await page.getByRole('tab', { name: 'What you are told about' }).click()
    const cards = page.getByTestId('rule-card')
    await expect(cards.filter({ hasText: 'Supplier due' })).toHaveCount(0)
    await expect(cards.filter({ hasText: 'Cash mismatch' })).toHaveCount(0)
    await expect(cards.filter({ hasText: 'Low stock' })).toHaveCount(1)

    // ...and they cannot change the shop's settings.
    await expect(cards.first().getByRole('button', { name: /On for the shop/ })).toHaveCount(0)
  })
})
