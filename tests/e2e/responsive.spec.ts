import { expect, test } from '@playwright/test'
import {
  expectNoHorizontalOverflow,
  expectTouchTargets,
  isMobileProject,
  signIn,
  USERS,
} from './helpers'

/**
 * Runs at every viewport in playwright.config.ts: 320px, Pixel 7, iPad and
 * desktop. A page that only works on one of them is not finished.
 */

const PAGES = [
  { path: '/dashboard', heading: 'Dashboard' },
  { path: '/settings/users', heading: 'Users' },
  { path: '/settings/roles', heading: 'Roles' },
  { path: '/settings/audit', heading: 'Audit log' },
] as const

test.describe('authenticated pages', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  for (const { path, heading } of PAGES) {
    test(`${path} renders without sideways scroll`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
      await expectNoHorizontalOverflow(page)
    })
  }

  test('every page is reachable from the navigation at this size', async ({ page }, testInfo) => {
    await page.goto('/dashboard')

    if (isMobileProject(testInfo.project.name)) {
      // The sidebar is hidden on a phone - the drawer is the only way through.
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden()
      await page.getByRole('button', { name: 'Open navigation menu' }).click()
    }

    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Users' })).toBeVisible()

    // The drawer slides in; wait for it to settle before clicking, and scroll
    // the target into view since the list can outgrow a small phone.
    const auditLink = nav.getByRole('link', { name: 'Audit log' })
    await auditLink.scrollIntoViewIfNeeded()
    await expect(auditLink).toBeInViewport()
    await auditLink.click()
    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible()
  })

  test('the sidebar and header stay put when a long page scrolls', async ({ page }, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), 'no persistent sidebar on a phone')

    // The audit log is the longest page in the app.
    await page.goto('/settings/audit')
    const nav = page.getByRole('navigation', { name: 'Main' })
    const header = page.locator('header')
    await expect(nav).toBeVisible()

    const before = await nav.boundingBox()
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForFunction(() => window.scrollY > 0 || document.body.scrollHeight <= innerHeight)

    const scrolled = await page.evaluate(() => window.scrollY)
    test.skip(scrolled === 0, 'page is not tall enough to scroll here')

    const after = await nav.boundingBox()
    // Pinned means its viewport position barely moves while the page scrolls
    // hundreds of pixels. A couple of pixels of sub-pixel rounding is fine;
    // scrolling away with the document is not.
    const drift = Math.abs((after?.y ?? 0) - (before?.y ?? 0))
    expect(
      drift,
      `the sidebar moved ${drift.toFixed(1)}px while the page scrolled ${scrolled}px`,
    ).toBeLessThan(2)
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeInViewport()
    await expect(header).toBeInViewport()
  })

  test('branch switcher is usable and does not overflow the header', async ({ page }) => {
    await page.goto('/dashboard')
    const trigger = page.getByRole('button', { name: /Active branch/ })
    await expect(trigger).toBeVisible()
    await trigger.click()
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await expectNoHorizontalOverflow(page)
  })
})

test.describe('phone-specific behaviour', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!isMobileProject(testInfo.project.name), 'phones only')
  })

  test('the users table becomes cards, not a sideways-scrolling grid', async ({ page }) => {
    await signIn(page, USERS.admin)
    await page.goto('/settings/users')
    // The md+ table is hidden; the card list carries the same data.
    await expect(page.getByTestId('user-table')).toBeHidden()
    await expect(page.getByTestId('user-cards').getByText(USERS.admin)).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('the navigation drawer closes after choosing a destination', async ({ page }) => {
    await signIn(page, USERS.admin)
    await page.getByRole('button', { name: 'Open navigation menu' }).click()
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Users' }).click()
    await expect(page).toHaveURL(/\/settings\/users/)
    await expect(page.getByRole('dialog')).toBeHidden()
  })

  test('controls are large enough to tap', async ({ page }) => {
    await signIn(page, USERS.admin)
    await page.goto('/settings/users')
    await expectTouchTargets(page)
  })
})

test.describe('sign-in page', () => {
  test('fits the viewport and can be completed', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await expectTouchTargets(page)
  })

  test('the form is reachable without zooming on a small phone', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-small', '320px only')
    await page.goto('/login')
    const button = page.getByRole('button', { name: 'Sign in' })
    await expect(button).toBeInViewport()
  })
})

test.describe('long content', () => {
  test('a wide code block scrolls inside its own box, not the page', async ({ page }) => {
    await signIn(page, USERS.admin)
    await page.goto('/settings/audit')
    // Both layouts exist in the DOM; only one is visible at a given width.
    // Targeting `details` unscoped picks the hidden one on desktop.
    const container = page.getByTestId(
      (await page.getByTestId('audit-table').isVisible()) ? 'audit-table' : 'audit-cards',
    )
    const details = container.locator('details').first()
    if ((await details.count()) === 0) {
      test.skip(true, 'no audit entry with a changes payload on this page')
      return
    }
    await details.click()
    // Wait for the revealed <pre> to be laid out before measuring, otherwise
    // the overflow check races the expansion and fails intermittently.
    await expect(details.locator('pre')).toBeVisible()
    await page.waitForFunction(() => {
      const el = document.querySelector('details[open] pre')
      return !!el && el.getBoundingClientRect().height > 0
    })
    await expectNoHorizontalOverflow(page)
  })
})
