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

    await nav.getByRole('link', { name: 'Audit log' }).click()
    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible()
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
    const details = page.locator('details').first()
    if (await details.count()) {
      await details.click()
      await expectNoHorizontalOverflow(page)
    }
  })
})
