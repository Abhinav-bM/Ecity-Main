import { expect, test, type Page } from '@playwright/test'
import { signIn, USERS } from './helpers'

/*
 * Opening a dropdown must not move the page.
 *
 * The shell used to scroll the document, with the sidebar and header pinned by
 * `position: sticky`. Radix locks scrolling by setting `overflow: hidden` and
 * `position: relative` on <body> whenever a dropdown, dialog or sheet opens -
 * and with the document as the scroller that clamped the scroll position to
 * zero and broke the sticky sidebar's containing block. Opening the branch
 * switcher or the user menu part-way down a long page scrolled the page back to
 * the top and visibly dragged the sidebar up with it.
 *
 * `main` owns the scroll now, so the body never scrolls and the lock has
 * nothing to clamp. These cases are the ones that actually regressed; Selects
 * inside the page never did, which is why the fix is in the shell and not in
 * the select.
 */
test.describe('the page does not move when a menu opens', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  /** Where the app actually scrolls, and where the sidebar sits right now. */
  const position = (page: Page) =>
    page.evaluate(() => {
      const main = document.querySelector('main')
      const aside = document.querySelector('aside')
      return {
        mainScrollTop: main ? Math.round(main.scrollTop) : -1,
        windowScrollY: Math.round(window.scrollY),
        asideTop: aside ? Math.round(aside.getBoundingClientRect().top) : -1,
      }
    })

  for (const menu of ['branch switcher', 'user menu'] as const) {
    test(`the ${menu} leaves the scroll and the sidebar where they were`, async ({ page }) => {
      // A page long enough to scroll, so there is a position to lose.
      await page.goto('/settings/business')
      await page.waitForTimeout(400)
      await page.evaluate(() => {
        const main = document.querySelector('main')!
        main.scrollTop = main.scrollHeight
      })
      await page.waitForTimeout(300)

      const before = await position(page)
      expect(before.mainScrollTop, 'the page has to be scrolled for this to prove anything')
        .toBeGreaterThan(0)

      // Both live in the header, so neither needs scrolling to reach - which
      // matters, because Playwright auto-scrolls to click and that would be a
      // scroll change of its own.
      if (menu === 'branch switcher') {
        await page.getByRole('button', { name: /Active branch/ }).click()
      } else {
        await page.locator('header button').last().click()
      }
      await page.waitForTimeout(400)
      expect(await position(page)).toEqual(before)

      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      expect(await position(page)).toEqual(before)
    })
  }

  test('the document itself never scrolls — main does', async ({ page }) => {
    await page.goto('/settings/business')
    await page.waitForTimeout(400)
    const shape = await page.evaluate(() => {
      const main = document.querySelector('main')!
      return {
        mainScrolls: main.scrollHeight > main.clientHeight,
        documentScrolls:
          document.documentElement.scrollHeight > document.documentElement.clientHeight,
      }
    })
    expect(shape.mainScrolls).toBe(true)
    expect(shape.documentScrolls).toBe(false)
  })
})
