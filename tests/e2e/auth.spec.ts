import { expect, test } from '@playwright/test'
import { SEED_PASSWORD, signIn, USERS } from './helpers'

/**
 * Requires a running, seeded app:
 *   docker compose up -d && npm run db:migrate && npm run db:seed && npm run dev
 * Runs at every viewport in playwright.config.ts.
 */

test('rejects a wrong password without revealing whether the account exists', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(USERS.admin)
  await page.getByLabel('Password').fill('definitely-not-the-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('[data-slot="alert"]')).toContainText('Email or password is incorrect')
})

test('gives the same message for an account that does not exist', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('nobody@ecity.local')
  await page.getByLabel('Password').fill(SEED_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('[data-slot="alert"]')).toContainText('Email or password is incorrect')
})

test('signs in, lands on the dashboard, and signs out again', async ({ page }) => {
  await signIn(page, USERS.admin)
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: /Account menu/ }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login/)
})

test('an unauthenticated visitor is sent to the login page', async ({ page }) => {
  await page.goto('/settings/users')
  await expect(page).toHaveURL(/\/login/)
})

test('a staff user does not see admin-only navigation', async ({ page }, testInfo) => {
  await signIn(page, USERS.staff)
  if (testInfo.project.name.startsWith('mobile')) {
    await page.getByRole('button', { name: 'Open navigation menu' }).click()
  }
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Users' })).toBeHidden()
  await expect(nav.getByRole('link', { name: 'Audit log' })).toBeHidden()
})
