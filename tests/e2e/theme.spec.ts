import { expect, test, type Page } from '@playwright/test'
import { signIn, USERS } from './helpers'

/**
 * The whole colour scheme comes from CSS custom properties, so a client
 * re-skin is a config change. These tests fail if a component ever
 * hardcodes a colour and stops responding to the theme.
 */

async function tokens(page: Page) {
  return page.evaluate(() => {
    const s = getComputedStyle(document.documentElement)
    return {
      theme: document.documentElement.dataset.theme,
      primary: s.getPropertyValue('--primary').trim(),
      primaryForeground: s.getPropertyValue('--primary-foreground').trim(),
      background: s.getPropertyValue('--background').trim(),
      ring: s.getPropertyValue('--ring').trim(),
    }
  })
}

test('ships with the black (onyx) theme by default', async ({ page }) => {
  await page.goto('/login')
  const t = await tokens(page)
  expect(t.theme).toBe('onyx')
  // oklch lightness well under 0.5 = a dark primary.
  const lightness = Number(/oklch\(([\d.]+)/.exec(t.primary)?.[1] ?? '1')
  expect(lightness, `--primary is ${t.primary}`).toBeLessThan(0.35)
})

test('the primary button actually paints with the theme token', async ({ page }) => {
  await page.goto('/login')
  const button = page.getByRole('button', { name: 'Sign in' })
  const bg = await button.evaluate((el) => getComputedStyle(el).backgroundColor)
  // Near-black, whatever colour space the browser reports it in.
  const [r, g, b] = (bg.match(/[\d.]+/g) ?? []).map(Number) as [number, number, number]
  expect(r + g + b, `button background is ${bg}`).toBeLessThan(200)
})

test('swapping data-theme repaints without touching any component', async ({ page }) => {
  await page.goto('/login')
  const before = await tokens(page)

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'navy'))
  const after = await tokens(page)

  expect(after.theme).toBe('navy')
  expect(after.primary).not.toBe(before.primary)
  // The neutral base is shared, so surfaces must not move.
  expect(after.background).toBe(before.background)
})

test('every registered theme defines a primary and a readable foreground', async ({ page }) => {
  await page.goto('/login')
  for (const name of ['onyx', 'navy', 'emerald', 'amber']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), name)
    const t = await tokens(page)
    expect(t.primary, `${name} --primary`).not.toBe('')
    expect(t.primaryForeground, `${name} --primary-foreground`).not.toBe('')
    expect(t.ring, `${name} --ring`).not.toBe('')
  }
})

test('dark mode inverts the black primary so buttons stay visible', async ({ page }) => {
  await page.goto('/login')
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  const t = await tokens(page)
  const lightness = Number(/oklch\(([\d.]+)/.exec(t.primary)?.[1] ?? '0')
  expect(lightness, `dark --primary is ${t.primary}`).toBeGreaterThan(0.7)
})

test('the app shell uses theme tokens, not fixed colours', async ({ page }) => {
  await signIn(page, USERS.admin)
  const hardcoded = await page.evaluate(() => {
    const offenders: string[] = []
    for (const el of Array.from(document.querySelectorAll('header *, aside *, main *'))) {
      const style = (el as HTMLElement).getAttribute('style') ?? ''
      if (/(background|color)\s*:\s*(#|rgb)/i.test(style)) {
        offenders.push(`${el.tagName.toLowerCase()}: ${style.slice(0, 60)}`)
      }
    }
    return offenders
  })
  expect(hardcoded, 'inline hardcoded colours bypass the theme').toEqual([])
})
