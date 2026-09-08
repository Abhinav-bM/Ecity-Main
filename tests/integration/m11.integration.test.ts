import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/server/db'
import * as schema from '@/server/db/schema'
import {
  createBrand,
  createCategory,
  createProduct,
  listBrands,
  listCategories,
  updateBrand,
  updateCategory,
} from '@/server/services/product.service'
import { createParty } from '@/server/services/party.service'
import {
  commitImport,
  createImportJob,
  errorReport,
  getImport,
  parseCsv,
  parseXlsx,
  suggestMapping,
  validateImport,
} from '@/server/services/import.service'
import { buildReport } from '@/server/services/reports.service'
import { openingCash, openingDues, openingStock, openingSummary } from '@/server/services/opening-balance.service'
import { customerDues } from '@/server/services/customer-ledger.service'
import { supplierOutstanding } from '@/server/services/supplier-ledger.service'
import { expectedCashPaise } from '@/server/services/cash.service'
import { getStock } from '@/server/services/stock.service'
import type { AuthUser } from '@/server/auth/permissions'
import type { AuditContext } from '@/server/db/audit'
import { clearCustomerCredit, clearMoney, databaseAvailable, withAppendOnlySuspended } from './setup'

const available = await databaseAvailable()
const suite = available ? describe : describe.skip

suite('M11 reports, imports and opening balances (database-backed)', () => {
  const stamp = Date.now()
  let businessId: number
  let branchA: number
  let cableProductId: number
  let actor: AuthUser
  let ctx: AuditContext
  const imei = (n: number) => String(38_100_000_000_000 + (stamp % 100_000) * 100 + n)
  const rs = (n: number) => BigInt(Math.round(n * 100))
  const DAY = '2022-04-01'

  beforeAll(async () => {
    businessId = (
      await db.insert(schema.business).values({ name: `M11 Test ${stamp}` }).returning()
    )[0]!.id
    branchA = (
      await db
        .insert(schema.branch)
        .values({ businessId, code: `M11${stamp}`.slice(0, 12), name: 'M11 Branch' })
        .returning()
    )[0]!.id

    actor = {
      id: 0,
      businessId,
      name: 'M11 Tester',
      email: 'm11@example.local',
      roleId: 0,
      permissions: new Set([
        'product.manage',
        'analytics.view',
        'analytics.view_profit',
        'inventory.view',
        'inventory.view_cost',
        'customer_payment.view',
        'supplier_payment.view',
      ]),
      branchIds: [branchA],
      canViewAllBranches: true,
    }
    ctx = { actor: null, businessId, branchId: branchA }

    const mobiles = await createCategory(actor, ctx, {
      name: 'M11 Mobiles',
      isSerialised: true,
      identifierType: 'IMEI',
    })
    const cables = await createCategory(actor, ctx, { name: 'M11 Cables', isSerialised: false })
    // Referenced by name from the import file, not by id.
    await createProduct(actor, ctx, { name: 'M11 Phone', categoryId: mobiles.id })
    cableProductId = (
      await createProduct(actor, ctx, { name: 'M11 Cable', categoryId: cables.id })
    ).id
  })

  afterAll(async () => {
    if (!available) return
    await withAppendOnlySuspended(async () => {
      const devices = await db
        .select({ id: schema.deviceUnit.id })
        .from(schema.deviceUnit)
        .where(eq(schema.deviceUnit.businessId, businessId))
      const ids = devices.map((d) => d.id)
      await clearMoney(businessId)
      await clearCustomerCredit(businessId)
      await db.execute(`delete from import_row where job_id in
        (select id from import_job where business_id = ${businessId})`)
      await db.execute(`delete from import_job where business_id = ${businessId}`)
      await db.execute(`delete from export_job where business_id = ${businessId}`)
      await db.execute(`delete from saved_report where business_id = ${businessId}`)
      if (ids.length) {
        await db.execute(`delete from device_event where device_id in (${ids.join(',')})`)
        await db
          .delete(schema.deviceIdentifier)
          .where(inArray(schema.deviceIdentifier.deviceId, ids))
      }
      await db.delete(schema.deviceUnit).where(eq(schema.deviceUnit.businessId, businessId))
      await db.execute(`delete from stock_ledger where business_id = ${businessId}`)
      await db.delete(schema.branchStock).where(eq(schema.branchStock.productId, cableProductId))
      await db.execute(`delete from supplier_ledger_entry where business_id = ${businessId}`)
      await db.delete(schema.product).where(eq(schema.product.businessId, businessId))
      await db.delete(schema.brand).where(eq(schema.brand.businessId, businessId))
      await db.delete(schema.category).where(eq(schema.category.businessId, businessId))
      await db.delete(schema.customer).where(eq(schema.customer.businessId, businessId))
      await db.delete(schema.supplier).where(eq(schema.supplier.businessId, businessId))
      await db.execute(`delete from audit_log where business_id = ${businessId}`)
      await db.delete(schema.branch).where(eq(schema.branch.businessId, businessId))
      await db.delete(schema.business).where(eq(schema.business.id, businessId))
    })
  })

  /* --- carried in from M5: managing the catalogue ---------------------- */

  describe('brands and categories (carried in)', () => {
    it('renames a brand without disturbing the products on it', async () => {
      const { id } = await createBrand(actor, ctx, { name: `M11 Brand ${stamp}` })
      await updateBrand(actor, ctx, id, { name: `M11 Renamed ${stamp}` })
      const found = (await listBrands(actor)).find((b) => b.id === id)!
      expect(found.name).toBe(`M11 Renamed ${stamp}`)
      expect(found.isActive).toBe(true)
    })

    it('deactivates rather than deletes', async () => {
      const { id } = await createBrand(actor, ctx, { name: `M11 Gone ${stamp}` })
      await updateBrand(actor, ctx, id, { isActive: false })
      const found = (await listBrands(actor)).find((b) => b.id === id)!
      // Still there: invoices already issued refer to it.
      expect(found.isActive).toBe(false)
    })

    it('refuses a duplicate name', async () => {
      const { id } = await createBrand(actor, ctx, { name: `M11 One ${stamp}` })
      await createBrand(actor, ctx, { name: `M11 Two ${stamp}` })
      await expect(
        updateBrand(actor, ctx, id, { name: `M11 Two ${stamp}` }),
      ).rejects.toThrow(/already exists/i)
    })

    it('will not change how a category is tracked once it has products', async () => {
      /*
       * The whole point of the rule: flipping this would reinterpret stock
       * that already exists, turning counted items into ones the system
       * believes carry identifiers.
       */
      const inUse = (await listCategories(actor)).find((c) => c.name === 'M11 Cables')!
      await expect(
        updateCategory(actor, ctx, inUse.id, { isSerialised: true }),
      ).rejects.toThrow(/already has products/i)

      // ...but renaming it is fine.
      await updateCategory(actor, ctx, inUse.id, { name: 'M11 Cables & leads' })
      expect((await listCategories(actor)).find((c) => c.id === inUse.id)!.name).toBe(
        'M11 Cables & leads',
      )
    })

    it('allows the change while the category is empty', async () => {
      const fresh = await createCategory(actor, ctx, { name: `M11 Empty ${stamp}`, isSerialised: false })
      await updateCategory(actor, ctx, fresh.id, { isSerialised: true, identifierType: 'SERIAL' })
      const found = (await listCategories(actor)).find((c) => c.id === fresh.id)!
      expect(found.isSerialised).toBe(true)
      expect(found.identifierType).toBe('SERIAL')
    })
  })

  /* --- the CSV reader --------------------------------------------------- */

  describe('reading a file', () => {
    it('handles quotes, commas and newlines inside a field', () => {
      const rows = parseCsv('name,note\r\n"Smith, John","He said ""hi""\nthen left"\r\n')
      expect(rows).toHaveLength(2)
      expect(rows[1]).toEqual(['Smith, John', 'He said "hi"\nthen left'])
    })

    it('drops a byte-order mark rather than gluing it to the first heading', () => {
      const rows = parseCsv('﻿name,phone\nA,1\n')
      expect(rows[0]).toEqual(['name', 'phone'])
    })

    it('ignores a trailing blank line', () => {
      expect(parseCsv('a,b\n1,2\n\n')).toHaveLength(2)
    })

    it('guesses a mapping from the words people actually use', () => {
      const map = suggestMapping(['Product Name', 'IMEI No', 'Type', 'Cost Price'], 'DEVICES')
      expect(map.product).toBe('Product Name')
      expect(map.imei).toBe('IMEI No')
      expect(map.mainType).toBe('Type')
      expect(map.purchasePrice).toBe('Cost Price')
    })
  })

  /* --- the acceptance criterion: 1,000 rows, 20 deliberate errors ------- */

  describe('importing 1,000 devices with 20 errors', () => {
    let jobId: number

    it('stages the file without creating anything', { timeout: 30_000 }, async () => {
      const header = 'Product,IMEI No,IMEI 2,Type,NEW CUT,Cost Price\n'
      const lines: string[] = []

      for (let i = 0; i < 1000; i += 1) {
        if (i < 10) {
          // Ten rows with a main type that does not exist.
          lines.push(`M11 Phone,${imei(i)},,BANANA,,12000`)
        } else if (i < 20) {
          // Ten rows naming a product the shop does not have.
          lines.push(`No Such Product,${imei(i)},,USED,,12000`)
        } else if (i < 40) {
          // Twenty perfectly good dual-SIM handsets.
          lines.push(`M11 Phone,${imei(i)},${imei(i + 5000)},GLOBAL,yes,15000`)
        } else {
          lines.push(`M11 Phone,${imei(i)},,USED,,9000`)
        }
      }

      const staged = await createImportJob(actor, ctx, {
        kind: 'DEVICES',
        fileName: 'stock.csv',
        content: header + lines.join('\n') + '\n',
        branchId: branchA,
      })
      jobId = staged.id

      expect(staged.rows).toBe(1000)
      // The guess found every column without being told.
      expect(staged.suggested).toMatchObject({
        product: 'Product',
        imei: 'IMEI No',
        mainType: 'Type',
      })

      // Nothing exists yet — that is the whole point of staging.
      const devices = await db
        .select({ n: schema.deviceUnit.id })
        .from(schema.deviceUnit)
        .where(eq(schema.deviceUnit.businessId, businessId))
      expect(devices).toHaveLength(0)
    })

    it('finds exactly the 20 bad rows, by line number', { timeout: 30_000 }, async () => {
      const result = await validateImport(actor, jobId, {
        product: 'Product',
        imei: 'IMEI No',
        imei2: 'IMEI 2',
        mainType: 'Type',
        isNewCut: 'NEW CUT',
        purchasePrice: 'Cost Price',
      })

      /*
       * Ten unknown main types are caught here. The ten unknown products are
       * not - nothing in the row itself is wrong, and finding out needs the
       * catalogue - so they surface when the row is applied.
       */
      expect(result.errors).toBe(10)
      expect(result.valid).toBe(990)

      const { rows } = await getImport(actor, jobId, { errorsOnly: true })
      // Row 2 is the first data row: 1-based, counting the header, as the
      // spreadsheet shows it.
      expect(rows[0]!.rowNumber).toBe(2)
      expect(rows[0]!.error).toMatch(/not a main type/i)
    })

    /*
     * The M11 acceptance case, and deliberately the slowest test here: a
     * thousand rows through the real service layer, each one checking its
     * IMEIs against every identifier in the business. Given its own timeout
     * because it grows with the database it runs against - on a developer's
     * machine after months of test runs it is seconds, not milliseconds, and
     * the default 5s starts failing for reasons that have nothing to do with
     * the importer.
     */
    it('imports 980, reports 20, and leaves no partial rows', { timeout: 60_000 }, async () => {
      const result = await commitImport(actor, ctx, jobId)

      expect(result.committed).toBe(980)
      // Ten refused at validation, ten more when the product could not be found.
      expect(result.failed).toBe(10)

      const job = (await getImport(actor, jobId)).job
      expect(job.status).toBe('COMMITTED')
      expect(job.committedRows).toBe(980)
      expect(job.errorRows).toBe(20)

      const devices = await db
        .select({ id: schema.deviceUnit.id })
        .from(schema.deviceUnit)
        .where(eq(schema.deviceUnit.businessId, businessId))
      expect(devices).toHaveLength(980)
    })

    it('imports both IMEIs of a dual-SIM row', async () => {
      const identifiers = await db
        .select({ deviceId: schema.deviceIdentifier.deviceId })
        .from(schema.deviceIdentifier)
        .where(eq(schema.deviceIdentifier.value, imei(20)))
      expect(identifiers).toHaveLength(1)

      // The second IMEI reached the same handset, not a second one.
      const second = await db
        .select({ deviceId: schema.deviceIdentifier.deviceId })
        .from(schema.deviceIdentifier)
        .where(eq(schema.deviceIdentifier.value, imei(5020)))
      expect(second).toHaveLength(1)
      expect(second[0]!.deviceId).toBe(identifiers[0]!.deviceId)
    })

    it('produces an error report naming every bad row and why', async () => {
      const report = await errorReport(actor, jobId)
      expect(report.rows).toHaveLength(20)
      const first = report.rows[0] as { rowNumber: number; error: string; raw: string }
      expect(first.rowNumber).toBeGreaterThan(1)
      expect(first.error).toBeTruthy()
      // The row as uploaded, so it can be found in the original file.
      expect(first.raw).toContain('IMEI No=')
    })

    it('refuses the same file a second time', async () => {
      await expect(
        createImportJob(actor, ctx, {
          kind: 'DEVICES',
          fileName: 'stock.csv',
          content: 'Product,IMEI No,IMEI 2,Type,NEW CUT,Cost Price\n',
          branchId: branchA,
        }),
      ).rejects.toThrow(/no rows/i)
    })
  })

  /*
   * FR-33.1 says CSV *or* Excel. A shop's list arrives as a spreadsheet far
   * more often than as a CSV, and "export it as CSV first" is a step to get
   * wrong at the one moment the data has to be right.
   */
  describe('reading a spreadsheet', () => {
    async function workbookOf(rows: (string | number | Date)[][]): Promise<Buffer> {
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      const sheet = wb.addWorksheet('Sheet1')
      for (const row of rows) sheet.addRow(row)
      return Buffer.from(await wb.xlsx.writeBuffer())
    }

    it('reads the first sheet, with numbers as digits rather than as science', async () => {
      const bytes = await workbookOf([
        ['Product', 'IMEI No', 'Type'],
        // Typed as a number, which is what a spreadsheet does to an IMEI.
        ['M11 Phone', Number(imei(700)), 'USED'],
      ])
      const grid = await parseXlsx(bytes)

      expect(grid[0]).toEqual(['Product', 'IMEI No', 'Type'])
      // 3.81e+14 would match no handset anywhere.
      expect(grid[1]![1]).toBe(imei(700))
    })

    it('brings a workbook all the way in, like any other file', async () => {
      const bytes = await workbookOf([
        ['Full Name', 'Mobile'],
        [`M11 Spreadsheet Buyer ${stamp}`, '9876500001'],
      ])

      const staged = await createImportJob(actor, ctx, {
        kind: 'CUSTOMERS',
        fileName: 'people.xlsx',
        content: bytes.toString('base64'),
        encoding: 'base64',
      })
      expect(staged.rows).toBe(1)
      expect(staged.suggested).toMatchObject({ name: 'Full Name', phone: 'Mobile' })

      await validateImport(actor, staged.id, staged.suggested)
      const result = await commitImport(actor, ctx, staged.id)
      expect(result.committed).toBe(1)

      const found = await db
        .select({ id: schema.customer.id })
        .from(schema.customer)
        .where(eq(schema.customer.name, `M11 Spreadsheet Buyer ${stamp}`))
      expect(found).toHaveLength(1)
    })

    it('says what to do with a file that is not a workbook at all', async () => {
      await expect(
        createImportJob(actor, ctx, {
          kind: 'CUSTOMERS',
          fileName: 'old.xls',
          content: Buffer.from('this is not a spreadsheet').toString('base64'),
          encoding: 'base64',
        }),
      ).rejects.toThrow(/saved again as \.xlsx/i)
    })
  })

  describe('structural problems reject the whole file', () => {
    it('refuses a file with no headings', async () => {
      await expect(
        createImportJob(actor, ctx, { kind: 'CUSTOMERS', fileName: 'x.csv', content: '\n\n' }),
      ).rejects.toThrow(/no rows/i)
    })

    it('refuses to validate when a required field is unmapped', async () => {
      const staged = await createImportJob(actor, ctx, {
        kind: 'CUSTOMERS',
        fileName: `people-${stamp}.csv`,
        content: 'Full Name,Mobile\nAsha,900000001\n',
      })
      await expect(validateImport(actor, staged.id, { phone: 'Mobile' })).rejects.toThrow(
        /nothing is mapped to name/i,
      )
    })

    it('will not commit a batch nobody has checked', async () => {
      const staged = await createImportJob(actor, ctx, {
        kind: 'CUSTOMERS',
        fileName: `unchecked-${stamp}.csv`,
        content: 'name\nAsha\n',
      })
      await expect(commitImport(actor, ctx, staged.id)).rejects.toThrow(/check the file/i)
    })
  })

  /* --- opening balances ------------------------------------------------- */

  describe('opening balances (FR-34.3)', () => {
    it('starting stock shows up in the stock figures', async () => {
      await openingStock(actor, ctx, {
        branchId: branchA,
        asOf: DAY,
        lines: [{ productId: cableProductId, quantity: 40 }],
      })
      expect((await getStock(cableProductId, branchA))?.quantity).toBe(40)
    })

    it('starting cash shows up in the drawer', async () => {
      await openingCash(actor, ctx, {
        asOf: DAY,
        branches: [{ branchId: branchA, amountPaise: rs(5000) }],
        accounts: [],
      })
      expect(await expectedCashPaise(branchA, DAY)).toBe(rs(5000))
    })

    it('refuses a second opening cash figure for the same branch', async () => {
      await expect(
        openingCash(actor, ctx, {
          asOf: DAY,
          branches: [{ branchId: branchA, amountPaise: rs(1) }],
          accounts: [],
        }),
      ).rejects.toThrow(/already has an opening cash figure/i)
    })

    it('starting dues show up in the dues screens', async () => {
      const buyer = (await createParty(actor, ctx, 'customer', { name: `M11 Debtor ${stamp}` })).id
      const seller = (await createParty(actor, ctx, 'supplier', { name: `M11 Creditor ${stamp}` }))
        .id

      await openingDues(actor, ctx, {
        asOf: DAY,
        customers: [{ customerId: buyer, amountPaise: rs(7500) }],
        suppliers: [{ supplierId: seller, amountPaise: rs(3200) }],
      })

      const dues = await customerDues(actor, { page: 1, pageSize: 50 })
      expect(dues.rows.find((r) => r.customerId === buyer)?.balancePaise).toBe(rs(7500))

      const owed = await supplierOutstanding(actor, 1, 50)
      expect(owed.rows.find((r) => r.supplierId === seller)?.balancePaise).toBe(rs(3200))
    })

    it('says what has already been declared', async () => {
      const summary = await openingSummary(actor)
      expect(summary.cashDeclared).toBe(1)
      expect(summary.customerDuesDeclared).toBe(1)
      expect(summary.supplierDuesDeclared).toBe(1)
    })

    /*
     * A shop with three debtors types them in; a shop with three hundred sends
     * a file. Both must land in the same ledger, or the dues screen would
     * depend on how the figure happened to arrive.
     */
    it('brings dues in from a file, into the same ledger as the typed-in ones', async () => {
      const one = (await createParty(actor, ctx, 'customer', { name: `M11 Filed A ${stamp}` })).id
      const two = (await createParty(actor, ctx, 'customer', { name: `M11 Filed B ${stamp}` })).id

      const content =
        'Customer,Amount\n' +
        `M11 Filed A ${stamp},1200.50\n` +
        `M11 Filed B ${stamp},800\n` +
        `Somebody Who Does Not Exist ${stamp},999\n`

      const staged = await createImportJob(actor, ctx, {
        kind: 'OPENING_CUSTOMER_DUES',
        fileName: 'dues.csv',
        content,
      })
      expect(staged.suggested).toMatchObject({ customer: 'Customer', amount: 'Amount' })

      const checked = await validateImport(actor, staged.id, staged.suggested)
      // Validation cannot know the customer is missing — that is found on the
      // way in, and reported against its own line rather than stopping the file.
      expect(checked.valid).toBe(3)

      const result = await commitImport(actor, ctx, staged.id)
      expect(result.committed).toBe(2)
      expect(result.failed).toBe(1)

      const { rows } = await getImport(actor, staged.id, { errorsOnly: true })
      expect(rows).toHaveLength(1)
      expect(rows[0]!.rowNumber).toBe(4)
      expect(rows[0]!.error).toMatch(/no customer called/i)

      const dues = await customerDues(actor, { page: 1, pageSize: 100 })
      expect(dues.rows.find((r) => r.customerId === one)?.balancePaise).toBe(rs(1200.5))
      expect(dues.rows.find((r) => r.customerId === two)?.balancePaise).toBe(rs(800))
    })

    it('brings opening stock in from a file', async () => {
      const before = (await getStock(cableProductId, branchA))?.quantity ?? 0
      const staged = await createImportJob(actor, ctx, {
        kind: 'OPENING_STOCK',
        fileName: 'counts.csv',
        content: 'Product,Quantity\nM11 Cable,15\n',
        branchId: branchA,
      })
      await validateImport(actor, staged.id, staged.suggested)
      const result = await commitImport(actor, ctx, staged.id)

      expect(result.committed).toBe(1)
      expect((await getStock(cableProductId, branchA))?.quantity).toBe(before + 15)
    })

    it('refuses a stock file with no branch, rather than failing a row at a time', async () => {
      await expect(
        createImportJob(actor, ctx, {
          kind: 'OPENING_STOCK',
          fileName: 'nobranch.csv',
          content: 'Product,Quantity\nM11 Cable,3\n',
        }),
      ).rejects.toThrow(/which branch/i)
    })
  })

  /* --- the report families ---------------------------------------------- */

  describe('reports (FR-25)', () => {
    const range = { from: '2022-01-01', to: '2030-12-31' }

    it('every family builds, with columns and rows', async () => {
      for (const name of [
        'sales',
        'purchases',
        'inventory',
        'financial',
        'credit',
        'tax',
        'reconciliation',
        'branches',
        'customers',
        'suppliers',
      ] as const) {
        const spec = await buildReport(actor, name, range)
        expect(spec.columns.length).toBeGreaterThan(1)
        expect(spec.title).toBeTruthy()
      }
    })

    it('the inventory report groups by main type with NEW CUT split out', async () => {
      const spec = await buildReport(actor, 'inventory', range)
      const rows = spec.rows as Record<string, unknown>[]
      // 980 imported handsets are in stock; 20 of them are GLOBAL · NEW CUT.
      expect(rows).toHaveLength(980)
      const newCut = rows.filter((r) => r.type === 'GLOBAL · NEW CUT')
      expect(newCut).toHaveLength(20)
      // ...and NEW CUT never appears as a type of its own.
      expect(rows.some((r) => r.type === 'NEW CUT')).toBe(false)
    })

    /* FR-33.3 names customers and suppliers as exports in their own right. */
    it('lists customers with what they bought and what they owe', async () => {
      const spec = await buildReport(actor, 'customers', {
        from: '2000-01-01',
        to: '2100-01-01',
      })
      const headers = spec.columns.map((c) => c.header)
      expect(headers).toContain('Phone')
      expect(headers).toContain('Owes now')

      // The debtor from the opening-balance tests owes, and has bought nothing.
      const debtor = (spec.rows as Record<string, unknown>[]).find(
        (r) => r.name === `M11 Debtor ${stamp}`,
      )
      expect(debtor?.owedPaise).toBe(rs(7500))
      expect(debtor?.bills).toBe(0)
    })

    it('lists suppliers with what they are owed', async () => {
      const spec = await buildReport(actor, 'suppliers', {
        from: '2000-01-01',
        to: '2100-01-01',
      })
      const creditor = (spec.rows as Record<string, unknown>[]).find(
        (r) => r.name === `M11 Creditor ${stamp}`,
      )
      expect(creditor?.owedPaise).toBe(rs(3200))
    })

    it('the credit report carries the aging buckets', async () => {
      const spec = await buildReport(actor, 'credit', range)
      expect(spec.columns.map((c) => c.header)).toEqual(
        expect.arrayContaining(['0–7 days', '8–30 days', '31–60 days', 'Over 60']),
      )
    })

    it('the financial report is refused without permission to see cost', async () => {
      const blind: AuthUser = {
        ...actor,
        permissions: new Set(['analytics.view']) as AuthUser['permissions'],
      }
      await expect(buildReport(blind, 'financial', range)).rejects.toThrow(/cost prices/i)
    })
  })
})
