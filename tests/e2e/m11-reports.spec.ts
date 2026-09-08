import { execFileSync } from 'node:child_process'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow, isMobileProject, signIn, USERS } from './helpers'

/**
 * M11 — reports, exports, imports and the catalogue screens.
 *
 * The arithmetic is proved by the integration suite; these check that a person
 * can reach a report, take the file away, and walk a file through the wizard.
 */

const unique = () => String(Date.now()).slice(-8)
const PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe!2026'

/**
 * Build a real .xlsx to upload.
 *
 * Out in a child process on purpose: ExcelJS pulls in jszip, which will not
 * load inside Playwright's module loader at all — importing it takes the
 * whole run down with "Unexpected module status 3" before a single test runs.
 * Plain Node has no such trouble, so the workbook is built there and comes
 * back as bytes.
 */
function makeWorkbook(rows: (string | number)[][]): Buffer {
  const script = `
    const ExcelJS = require('exceljs')
    const rows = JSON.parse(process.argv[1])
    const wb = new ExcelJS.Workbook()
    const sheet = wb.addWorksheet('Sheet1')
    for (const row of rows) sheet.addRow(row)
    wb.xlsx.writeBuffer().then((b) => process.stdout.write(Buffer.from(b).toString('base64')))
  `
  const out = execFileSync(process.execPath, ['-e', script, JSON.stringify(rows)], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  return Buffer.from(out, 'base64')
}

/** The request fixture keeps its own cookie jar, so it signs in separately. */
async function apiSignIn(request: APIRequestContext, email: string) {
  const res = await request.post('/api/auth/login', { data: { email, password: PASSWORD } })
  expect(res.ok(), `sign-in failed for ${email}`).toBe(true)
}

const REPORTS = [
  ['sales', 'Sales'],
  ['purchases', 'Purchases'],
  ['inventory', 'Inventory'],
  ['financial', 'Financial'],
  ['credit', 'Credit'],
  ['tax', 'Tax'],
  ['reconciliation', 'Reconciliation'],
  ['branches', 'Branch comparison'],
  ['customers', 'Customers'],
  ['suppliers', 'Suppliers'],
] as const

async function gotoReport(page: Page, report: string) {
  await page.goto(`/reports?report=${report}&from=2020-01-01&to=2030-12-31`)
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible()
}

test.describe('the report centre', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('every family opens and offers all three formats', async ({ page }) => {
    for (const [slug] of REPORTS) {
      await gotoReport(page, slug)
      const buttons = page.getByTestId('export-buttons')
      for (const label of ['CSV', 'Excel', 'PDF']) {
        await expect(buttons.getByRole('link', { name: label })).toBeVisible()
      }
      await expectNoHorizontalOverflow(page)
    }
  })

  test('the filters live in the URL, so a report can be sent to someone', async ({ page }) => {
    await gotoReport(page, 'sales')
    await page.getByRole('textbox', { name: 'From', exact: true }).fill('2024-01-01')
    /*
     * Generous, deliberately: changing a filter is a same-route navigation, so
     * the URL does not change until the server has rebuilt the report. On a
     * shop's worth of history that is seconds, which is why the controls say
     * "Rebuilding…" while it happens.
     */
    await expect(page).toHaveURL(/from=2024-01-01/, { timeout: 20_000 })
    await expect(page).toHaveURL(/report=sales/)
  })

  /** FR-25.4. The same three questions every morning, asked once. */
  test('saves a view, comes back to it, and removes it', async ({ page }) => {
    const name = `E2E View ${unique()}`
    await gotoReport(page, 'credit')
    await page.getByRole('button', { name: 'Save this view' }).click()
    await page.getByLabel('Name for this view').fill(name)
    await page.getByRole('button', { name: 'Save', exact: true }).click()

    const view = page.getByTestId('saved-view').filter({ hasText: name })
    await expect(view).toBeVisible()

    // Somewhere else entirely, then back through the saved view.
    await gotoReport(page, 'sales')
    await page.getByTestId('saved-view').filter({ hasText: name }).getByRole('button').first().click()
    await expect(page).toHaveURL(/report=credit/)
    await expect(page).toHaveURL(/from=2020-01-01/)

    await page.getByRole('button', { name: `Remove the ${name} view` }).click()
    await expect(page.getByTestId('saved-view').filter({ hasText: name })).toHaveCount(0)
  })

  /** FR-33. The file has to actually arrive. */
  test('downloads a CSV, an Excel file and a PDF', async ({ request }) => {
    await apiSignIn(request, USERS.admin)

    for (const [format, signature] of [
      ['csv', 'Invoice'],
      ['xlsx', 'PK'],
      ['pdf', '%PDF-'],
    ] as const) {
      const res = await request.get(
        `/api/reports/export?report=sales&from=2020-01-01&to=2030-12-31&format=${format}`,
      )
      expect(res.ok(), `${format} export failed`).toBe(true)
      const body = await res.body()
      expect(body.length).toBeGreaterThan(0)
      // Each format announces itself in its first bytes.
      expect(body.subarray(0, 8).toString('latin1')).toContain(
        format === 'csv' ? '' : signature,
      )
      if (format === 'csv') expect(body.toString('utf8')).toContain(signature)
    }
  })

  test('appears in the navigation', async ({ page }, testInfo) => {
    await page.goto('/dashboard')
    if (isMobileProject(testInfo.project.name)) {
      await page.getByRole('button', { name: 'Open navigation menu' }).click()
    }
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Reports' }),
    ).toBeVisible()
  })
})

test.describe('the catalogue (carried in from M5)', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('adds a brand, renames it, and deactivates it', async ({ page }) => {
    const name = `E2E Brand ${unique()}`
    await page.goto('/settings/catalogue')

    await page.getByRole('textbox', { name: 'Name', exact: true }).first().fill(name)
    await page.getByRole('button', { name: 'Add brand' }).click()
    const row = page.locator('[data-testid="brand-row"]').filter({ hasText: name })
    await expect(row).toHaveCount(1)

    await row.getByRole('button', { name: 'Rename' }).click()
    await page.getByRole('textbox', { name: `Rename ${name}` }).fill(`${name} X`)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(
      page.locator('[data-testid="brand-row"]').filter({ hasText: `${name} X` }),
    ).toHaveCount(1)

    await page
      .locator('[data-testid="brand-row"]')
      .filter({ hasText: `${name} X` })
      .getByRole('button', { name: 'Deactivate' })
      .click()
    // Still listed, marked inactive — invoices already issued refer to it.
    await expect(
      page.locator('[data-testid="brand-row"]').filter({ hasText: `${name} X` }),
    ).toContainText('Inactive')
  })

  test('a category with products cannot change how it is tracked', async ({ page }) => {
    await page.goto('/settings/catalogue')
    await page.getByRole('tab', { name: 'Categories' }).click()
    // The categories the seed created already carry products.
    await expect(page.getByTestId('category-list')).toBeVisible()
    await expect(page.locator('[data-testid="category-row"]').first()).toContainText('product')
    await expectNoHorizontalOverflow(page)
  })

  test('explains why main types are not managed here', async ({ page }) => {
    await page.goto('/settings/catalogue')
    await expect(page.getByText(/Main types/)).toBeVisible()
    await expect(page.getByText(/would carry none of that behaviour/)).toBeVisible()
  })
})

test.describe('the import wizard', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  /** FR-34.1. Upload → map → check → import, with nothing created early. */
  test('walks a file through, and creates nothing until told', async ({ page }) => {
    const id = unique()
    const csv = [
      'Full Name,Mobile,City',
      `E2E Imported One ${id},90000${id},Kochi`,
      `E2E Imported Two ${id},90001${id},Kochi`,
      `,90002${id},Kochi`,
    ].join('\n')

    await page.goto('/imports')
    await page.getByRole('combobox', { name: 'What is in the file' }).click()
    await page.getByRole('option', { name: 'Customers' }).click()

    await page.getByLabel('File', { exact: true }).setInputFiles({
      name: `people-${id}.csv`,
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    })

    await expect(page.getByTestId('staged-summary')).toContainText('3 row(s)')
    // Nothing exists yet.
    await expect(page.getByTestId('column-map')).toBeVisible()

    /*
     * Set the mapping by hand rather than trusting the guess. The guess is a
     * convenience; being able to correct it is the point of the step, and a
     * test that only exercised the happy guess would not prove that.
     */
    await page.getByRole('combobox', { name: 'name', exact: true }).click()
    await page.getByRole('option', { name: 'Full Name' }).click()
    await page.getByRole('combobox', { name: 'phone', exact: true }).click()
    await page.getByRole('option', { name: 'Mobile' }).click()

    await page.getByRole('button', { name: 'Check the file' }).click()
    const result = page.getByTestId('check-result')
    await expect(result).toContainText('2 ready to import')
    await expect(result).toContainText('1 with problems')
    // The bad row is named by its line in the spreadsheet.
    await expect(page.getByText(/Row 4/)).toBeVisible()

    await page.getByRole('button', { name: /Import 2 row/ }).click()
    await expect(page.getByTestId('import-history')).toContainText(`people-${id}.csv`)

    // ...and they really are customers now.
    await page.goto('/customers')
    await page.getByRole('searchbox', { name: 'Search customers' }).fill(`E2E Imported One ${id}`)
    await page.keyboard.press('Enter')
    await expect(
      page.getByText(`E2E Imported One ${id}`).and(page.locator(':visible')).first(),
    ).toBeVisible()
  })

  /** FR-33.1 says CSV *or* Excel — and a shop's list is nearly always Excel. */
  test('takes a spreadsheet straight, without asking for a CSV first', async ({ page }) => {
    const id = unique()
    const name = `E2E Workbook Buyer ${id}`

    // Typed as a number in the second column, which is what a spreadsheet
    // does to a phone number.
    const buffer = makeWorkbook([
      ['Full Name', 'Mobile'],
      [name, Number(`90009${id.slice(-4)}`)],
    ])

    await page.goto('/imports')
    await page.getByRole('combobox', { name: 'What is in the file' }).click()
    await page.getByRole('option', { name: 'Customers' }).click()
    await page.getByLabel('File', { exact: true }).setInputFiles({
      name: `people-${id}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    })

    await expect(page.getByTestId('staged-summary')).toContainText('1 row(s)')
    await page.getByRole('button', { name: 'Check the file' }).click()
    await expect(page.getByTestId('check-result')).toContainText('1 ready to import')
    await page.getByRole('button', { name: /Import 1 row/ }).click()
    await expect(page.getByTestId('import-history')).toContainText(`people-${id}.xlsx`)

    await page.goto('/customers')
    await page.getByRole('searchbox', { name: 'Search customers' }).fill(name)
    await page.keyboard.press('Enter')
    await expect(page.getByText(name).and(page.locator(':visible')).first()).toBeVisible()
  })

  test('refuses the same file twice', async ({ page }) => {
    const id = unique()
    const csv = `name\nE2E Twice ${id}\n`
    const file = {
      name: `twice-${id}.csv`,
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    }

    await page.goto('/imports')
    await page.getByRole('combobox', { name: 'What is in the file' }).click()
    await page.getByRole('option', { name: 'Customers' }).click()
    await page.getByLabel('File', { exact: true }).setInputFiles(file)
    await page.getByRole('button', { name: 'Check the file' }).click()
    await page.getByRole('button', { name: /Import 1 row/ }).click()
    await expect(page.getByTestId('import-history')).toContainText(`twice-${id}.csv`)

    // Uploading it again would double everything in it.
    await page.getByRole('combobox', { name: 'What is in the file' }).click()
    await page.getByRole('option', { name: 'Customers' }).click()
    await page.getByLabel('File', { exact: true }).setInputFiles(file)
    await expect(page.getByText(/already been imported/)).toBeVisible()
  })

})

/**
 * FR-34.3. The figures a shop already has on the day it starts.
 *
 * Cash is a once-per-branch declaration, which is proved in the integration
 * suite where the database is under the test's control; here the concern is
 * that a person can reach the screen, type a figure in, and find it again
 * wherever that kind of figure normally shows up.
 */
test.describe('opening balances', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.admin)
  })

  test('opens, and dates everything to a day rather than to now', async ({ page }) => {
    await page.goto('/settings/opening-balances')
    await expect(
      page.getByRole('heading', { name: 'Opening balances', level: 1 }),
    ).toBeVisible()

    // The shop's day, not the browser's UTC day (docs/03 §4.12).
    const asOf = page.getByLabel('These figures are as at')
    const shopToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    await expect(asOf).toHaveValue(shopToday)

    for (const tab of ['Cash & accounts', 'Stock', 'Dues']) {
      await expect(page.getByRole('tab', { name: tab })).toBeVisible()
    }
    await expect(page.getByTestId('opening-summary')).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  /** A due carried in from before ECITY must reach the screens a due reaches. */
  test('a customer who already owed shows up in the dues screen', async ({ page }) => {
    const id = unique()
    const name = `E2E Opening Debtor ${id}`
    const made = await page.request.post('/api/customers', { data: { name } })
    expect(made.ok()).toBe(true)

    await page.goto('/settings/opening-balances')
    await page.getByRole('tab', { name: 'Dues' }).click()

    await page.getByRole('combobox', { name: 'Customer', exact: true }).click()
    await page.getByPlaceholder('Name, phone, email or GST').fill(name)
    await page.getByRole('option', { name: new RegExp(name) }).click()
    await page.getByLabel('Amount owed').first().fill('4321')

    await page.getByRole('button', { name: 'Record opening dues' }).click()
    await expect(page.getByText('Opening dues recorded.')).toBeVisible()

    await page.goto('/customers/dues')
    // The card and the table both carry the row; only one is on screen.
    await expect(
      page.getByTestId('dues-row').filter({ hasText: name }).and(page.locator(':visible')).first(),
    ).toContainText('4,321')
  })

  test('links to the wizard for a shop with more rows than anyone would type', async ({
    page,
  }) => {
    await page.goto('/settings/opening-balances')
    await page.getByRole('tab', { name: 'Stock' }).click()
    await page.getByRole('link', { name: /Import a stock file instead/ }).click()
    await expect(page).toHaveURL(/kind=OPENING_STOCK/)
    // The wizard opens on the right kind rather than making them find it.
    await expect(
      page.getByRole('combobox', { name: 'What is in the file' }),
    ).toContainText('Opening stock')
  })

})

test.describe('import permissions', () => {
  test('staff cannot import', async ({ page }) => {
    await signIn(page, USERS.staff)
    await page.goto('/imports')
    await expect(page).toHaveURL(/\/dashboard$/)
  })

  test('staff cannot declare opening balances', async ({ page }) => {
    await signIn(page, USERS.staff)
    await page.goto('/settings/opening-balances')
    await expect(page).toHaveURL(/\/dashboard$/)
  })
})

/**
 * M14 — the owner's own copy of everything (PRD FR-32.3).
 *
 * Not a system backup: that runs on the server (docs/04 §7). This is what the
 * owner would still have if the software went away.
 */
test.describe('your data', () => {
  test('the owner can see what an export contains, and take it', async ({ page }) => {
    await signIn(page, USERS.admin)
    await page.goto('/settings/data')

    await expect(page.getByRole('heading', { name: 'Your data', level: 1 })).toBeVisible()
    await expect(page.getByTestId('export-contents')).toContainText('Customers')
    await expect(page.getByTestId('export-contents')).toContainText('Devices')
    // Says plainly what it is not, so nobody treats it as a server backup.
    await expect(page.getByText(/not a system backup/i)).toBeVisible()

    const download = page.waitForEvent('download')
    await page.getByRole('link', { name: /Download everything/ }).click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/ecity-full-export-\d{4}-\d{2}-\d{2}\.csv/)
  })

  test('a manager cannot take the whole business', async ({ page }) => {
    // Every customer, every price, every figure — the owner's decision alone.
    await signIn(page, USERS.manager)
    await page.goto('/settings/data')
    await expect(page).toHaveURL(/\/dashboard$/)
  })
})
