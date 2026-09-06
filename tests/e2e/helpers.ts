import { expect, type Locator, type Page } from '@playwright/test'

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

/**
 * Anything tappable must be big enough to hit with a thumb - but only where
 * a thumb is used. The 44px rule in globals.css is scoped to
 * `@media (pointer: coarse)`, so a 32px control driven by a mouse is correct.
 * This is a no-op on pointer-fine devices rather than a false failure.
 */
export async function expectTouchTargets(page: Page, minPx = 40) {
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
  if (!coarse) return
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

/**
 * Tab forward until `target` holds focus, so a test can prove a control is
 * reachable without a mouse rather than just clicking it.
 *
 * Fails with the accessible name of whatever ended up focused, which is far
 * easier to debug than a bare timeout when the tab order changes.
 */
export async function tabTo(page: Page, target: Locator, maxPresses = 25) {
  for (let i = 0; i < maxPresses; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return
    await page.keyboard.press('Tab')
  }
  if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return
  const focused = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return el ? `${el.tagName.toLowerCase()} "${el.textContent?.trim().slice(0, 40) ?? ''}"` : 'nothing'
  })
  throw new Error(
    `Could not reach the target with ${maxPresses} Tab presses; focus stopped on ${focused}.`,
  )
}

/**
 * Choose an option from an AppSelect.
 *
 * These are Radix comboboxes, not native <select>s — `selectOption` only works
 * on the latter. Click the trigger, then pick from the listbox that opens.
 */
export async function choose(trigger: Locator, optionName: string | RegExp) {
  await trigger.click()
  await trigger
    .page()
    .getByRole('option', { name: optionName, exact: typeof optionName === 'string' })
    .first()
    .click()
}
