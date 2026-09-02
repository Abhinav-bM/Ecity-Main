import { expect, type Page } from '@playwright/test'

export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe!2026'

export const USERS = {
  admin: 'admin@ecity.local',
  manager: 'manager@ecity.local',
  staff: 'staff@ecity.local',
} as const

export async function signIn(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(SEED_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

/**
 * The single most common responsive bug: something wider than the viewport
 * makes the whole page scroll sideways. Wide content must scroll inside its
 * own container, never take the body with it.
 */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      offender: (() => {
        const limit = doc.clientWidth + 1
        for (const el of Array.from(document.body.querySelectorAll('*'))) {
          const r = el.getBoundingClientRect()
          if (r.width > 0 && r.right > limit) {
            const e = el as HTMLElement
            return `${e.tagName.toLowerCase()}.${e.className?.toString().slice(0, 80)}`
          }
        }
        return null
      })(),
    }
  })
  expect(
    overflow.scrollWidth,
    `Page scrolls horizontally (${overflow.scrollWidth}px in ${overflow.clientWidth}px). ` +
      `First element past the edge: ${overflow.offender ?? 'unknown'}`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1)
}

/** Anything tappable must be big enough to hit with a thumb. */
export async function expectTouchTargets(page: Page, minPx = 40) {
  const tooSmall = await page.evaluate((min) => {
    const bad: string[] = []
    const selector = 'button, a[href], [role="button"], input:not([type="hidden"])'
    for (const el of Array.from(document.querySelectorAll(selector))) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue // hidden
      if (r.height < min) {
        const e = el as HTMLElement
        bad.push(`${e.tagName.toLowerCase()} "${(e.innerText || e.ariaLabel || '').slice(0, 30)}" ${Math.round(r.height)}px`)
      }
    }
    return bad
  }, minPx)
  expect(tooSmall, `Touch targets under ${minPx}px tall`).toEqual([])
}

export function isMobileProject(name: string) {
  return name.startsWith('mobile')
}
