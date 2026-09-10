import { createHash } from 'node:crypto'
import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { db } from '@/server/db'
import { importJob, importRow, type MainType } from '@/server/db/schema'
import { writeAudit, type AuditContext } from '@/server/db/audit'
import { AppError, conflict, notFound } from '@/server/http'
import { branchScope, type AuthUser } from '@/server/auth/permissions'
import { MAIN_TYPES } from '@/lib/validation'
import { shopDateString } from '@/lib/date'
import { createDevice } from './device.service'
import { createParty } from './party.service'
import { createProduct } from './product.service'
import {
  postOpeningCustomerDue,
  postOpeningStockLine,
  postOpeningSupplierDue,
} from './opening-balance.service'

/**
 * Imports (PRD FR-33.1, FR-33.2; the opening-balance kinds serve FR-34).
 *
 * Two phases, always: parse and validate into `import_row` first, show the
 * operator exactly what will happen, and only then commit. Nothing is ever
 * half-applied, and a browser that dies between the two steps loses nothing -
 * the staged batch is in the database, not in a wizard's memory.
 *
 * A **structural** problem rejects the whole file: if the header cannot be
 * understood there is nothing to salvage, and importing "the rows that
 * happened to parse" is how a shop ends up with silently partial stock. A
 * **row** problem is reported per row, with its line number, and the rest of
 * the file still goes in.
 */

export type ImportKind = (typeof importJob.$inferInsert)['kind']

/** What each kind needs, and what it will take if offered. */
export const IMPORT_FIELDS: Record<
  ImportKind,
  { required: string[]; optional: string[]; description: string }
> = {
  PRODUCTS: {
    required: ['name', 'category'],
    optional: ['brand', 'sku', 'barcode', 'hsnCode', 'purchasePrice', 'sellingPrice'],
    description: 'The catalogue: what the shop sells.',
  },
  DEVICES: {
    required: ['product', 'imei', 'mainType'],
    optional: [
      'imei2',
      'imei3',
      'imei4',
      'isNewCut',
      'variant',
      'ram',
      'storage',
      'colour',
      'batteryHealth',
      'purchasePrice',
      'sellingPrice',
      'receivedAt',
      'warrantyMonths',
      'warrantyProvider',
    ],
    description: 'Handsets, one per row. A row may carry several IMEIs.',
  },
  CUSTOMERS: {
    required: ['name'],
    optional: ['phone', 'altPhone', 'email', 'gstin', 'city', 'address'],
    description: 'People who buy.',
  },
  SUPPLIERS: {
    required: ['name'],
    optional: ['company', 'phone', 'email', 'gstin', 'city'],
    description: 'People you buy from.',
  },
  OPENING_STOCK: {
    required: ['product', 'quantity'],
    optional: ['purchasePrice'],
    description: 'Accessory counts as they stand on the day you start.',
  },
  OPENING_CUSTOMER_DUES: {
    required: ['customer', 'amount'],
    optional: ['note'],
    description: 'What customers already owed before ECITY.',
  },
  OPENING_SUPPLIER_DUES: {
    required: ['supplier', 'amount'],
    optional: ['note'],
    description: 'What the shop already owed before ECITY.',
  },
}

/**
 * Split a CSV into rows, honouring quotes.
 *
 * Written rather than pulled in: the format is small and completely specified,
 * and a dependency here would be a dependency in the path that loads a shop's
 * entire history.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  // A byte-order mark would otherwise become part of the first header.
  const input = text.replace(/^\uFEFF/, '')

  for (let i = 0; i < input.length; i += 1) {
    const c = input[i]!
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 1
        } else quoted = false
      } else field += c
      continue
    }
    if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i += 1
      row.push(field)
      field = ''
      // A trailing newline is not an empty row.
      if (row.some((v) => v.trim() !== '')) rows.push(row)
      row = []
    } else field += c
  }

  row.push(field)
  if (row.some((v) => v.trim() !== '')) rows.push(row)
  return rows
}

/**
 * Guess which of their columns is which of ours.
 *
 * Only a starting point - the wizard shows the mapping and lets it be
 * corrected, because a guess that cannot be overridden is worse than no guess.
 */
export function suggestMapping(headers: string[], kind: ImportKind): Record<string, string> {
  const fields = [...IMPORT_FIELDS[kind].required, ...IMPORT_FIELDS[kind].optional]
  const normalise = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '')

  const map: Record<string, string> = {}
  for (const field of fields) {
    const target = normalise(field)
    const hit = headers.find((h) => normalise(h) === target)
    if (hit) map[field] = hit
  }

  // The things people actually write in a spreadsheet.
  const aliases: Record<string, string[]> = {
    name: ['productname', 'customername', 'suppliername', 'itemname', 'fullname', 'party'],
    imei: ['imei1', 'imeino', 'imeinumber', 'serial', 'serialno'],
    imei2: ['imeitwo', 'secondimei'],
    product: ['productname', 'item', 'model'],
    mainType: ['type', 'devicetype', 'condition'],
    quantity: ['qty', 'stock', 'count'],
    amount: ['balance', 'outstanding', 'due'],
    phone: ['mobile', 'contact', 'phoneno'],
    ram: ['memory'],
    warrantyMonths: ['warranty', 'warrantymonths', 'warrantyperiod'],
    warrantyProvider: ['warrantyby', 'warrantyprovider'],
    storage: ['rom', 'internalstorage', 'capacity'],
    colour: ['color'],
    purchasePrice: ['cost', 'costprice', 'buyprice'],
    sellingPrice: ['price', 'mrp', 'saleprice'],
    customer: ['customername', 'party'],
    supplier: ['suppliername', 'party', 'vendor'],
  }
  for (const [field, options] of Object.entries(aliases)) {
    if (map[field] || !fields.includes(field)) continue
    const hit = headers.find((h) => options.includes(normalise(h)))
    if (hit) map[field] = hit
  }

  return map
}

/**
 * Read the first sheet of an .xlsx as the same grid a CSV gives.
 *
 * A shop's list arrives as a spreadsheet far more often than as a CSV, and
 * "export it as CSV first" is a step to get wrong at the one moment the data
 * has to be right. ExcelJS is already here for writing exports, so reading
 * costs a function rather than a dependency.
 *
 * Only the first sheet, deliberately: a workbook with several is a question
 * about which one, and guessing is how the wrong list gets imported.
 */
export async function parseXlsx(bytes: Buffer): Promise<string[][]> {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer)
  } catch {
    throw new AppError(
      'That file could not be read as a spreadsheet. An .xls saved by an old Excel has to be saved again as .xlsx, or exported as CSV.',
      422,
      'BAD_WORKBOOK',
    )
  }

  const sheet = workbook.worksheets[0]
  if (!sheet) throw new AppError('That workbook has no sheets in it.', 422, 'EMPTY_FILE')

  const grid: string[][] = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = []
    // `row.values` is 1-based with a hole at 0, which is why this is indexed
    // rather than mapped.
    const values = row.values as unknown[]
    for (let i = 1; i < values.length; i += 1) {
      cells.push(cellText(values[i]))
    }
    grid.push(cells)
  })
  return grid
}

/** A cell can be a number, a date, a formula or rich text; the importer wants text. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) {
    // A date column is a date to the spreadsheet and a day to the shop.
    return shopDateString(value)
  }
  if (typeof value === 'object') {
    const cell = value as { text?: string; result?: unknown; richText?: { text: string }[] }
    if (Array.isArray(cell.richText)) return cell.richText.map((r) => r.text).join('')
    if (cell.text !== undefined) return String(cell.text)
    if (cell.result !== undefined) return cellText(cell.result)
    return ''
  }
  /*
   * A number is stringified plainly. An IMEI read as a number would otherwise
   * come back as 3.81e+14 and match nothing - which is exactly why the whole
   * column is treated as text from here on.
   */
  if (typeof value === 'number') return Number.isInteger(value) ? value.toFixed(0) : String(value)
  return String(value)
}

/* ------------------------------------------------------------- staging --- */

export async function createImportJob(
  actor: AuthUser,
  ctx: AuditContext,
  input: {
    kind: ImportKind
    fileName: string
    content: string
    /** `base64` for a spreadsheet, which is bytes rather than text. */
    encoding?: 'text' | 'base64'
    branchId?: number | null
  },
): Promise<{ id: number; headers: string[]; suggested: Record<string, string>; rows: number }> {
  if (input.branchId) {
    const scope = branchScope(actor, null)
    if (scope !== null && !scope.includes(input.branchId)) throw notFound('Branch')
  } else if (input.kind === 'DEVICES' || input.kind === 'OPENING_STOCK') {
    // Stock is held somewhere. Without a branch the rows would parse and then
    // fail one at a time on commit, which is the worst moment to find out.
    throw new AppError('Choose which branch this stock is at.', 422, 'BRANCH_REQUIRED')
  }

  const bytes = input.encoding === 'base64' ? Buffer.from(input.content, 'base64') : null
  const parsed = bytes ? await parseXlsx(bytes) : parseCsv(input.content)
  if (parsed.length === 0) {
    throw new AppError('That file has no rows in it.', 422, 'EMPTY_FILE')
  }

  const headers = (parsed[0] ?? []).map((h) => h.trim())
  if (headers.length === 0 || headers.every((h) => h === '')) {
    // Structural: without a header there is nothing to map, so nothing to save.
    throw new AppError(
      'The first row must be column headings — without them nothing can be mapped.',
      422,
      'NO_HEADER',
    )
  }

  const body = parsed.slice(1)
  if (body.length === 0) {
    throw new AppError('That file has headings but no rows.', 422, 'NO_ROWS')
  }

  const fileHash = createHash('sha256').update(bytes ?? input.content).digest('hex')

  /*
   * The same file uploaded twice is almost always a mistake, and importing it
   * twice would double a shop's stock. Committed batches are what matter -
   * an abandoned upload should not block a retry.
   */
  const previous = (
    await db
      .select({ id: importJob.id, status: importJob.status })
      .from(importJob)
      .where(
        and(
          eq(importJob.businessId, actor.businessId),
          eq(importJob.fileHash, fileHash),
          eq(importJob.status, 'COMMITTED'),
        ),
      )
      .limit(1)
  )[0]
  if (previous) {
    throw conflict(
      `This exact file has already been imported (batch #${previous.id}). Importing it again would duplicate everything in it.`,
    )
  }

  const job = (
    await db
      .insert(importJob)
      .values({
        businessId: actor.businessId,
        kind: input.kind,
        fileName: input.fileName,
        fileHash,
        branchId: input.branchId ?? null,
        columnMap: suggestMapping(headers, input.kind),
        totalRows: body.length,
        uploadedBy: actor.id,
      })
      .returning({ id: importJob.id })
  )[0]!

  await db.insert(importRow).values(
    body.map((cells, i) => ({
      jobId: job.id,
      // 1-based and counting the header, so it matches what the spreadsheet
      // shows the person looking for the bad line.
      rowNumber: i + 2,
      raw: Object.fromEntries(headers.map((h, j) => [h, cells[j] ?? ''])),
    })),
  )

  await writeAudit(ctx, {
    action: 'CREATE',
    entityType: 'import_job',
    entityId: job.id,
    summary: `Uploaded ${input.fileName} — ${body.length} rows of ${input.kind}`,
  })

  return {
    id: job.id,
    headers,
    suggested: suggestMapping(headers, input.kind),
    rows: body.length,
  }
}

function asMoneyPaise(value: string): bigint | null {
  const cleaned = value.replace(/[₹,\s]/g, '')
  if (cleaned === '') return null
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [whole, fraction = ''] = cleaned.split('.')
  const paise = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'))
  return paise
}

/**
 * Check every staged row against the chosen mapping.
 *
 * Validation only - nothing is created here, so a preview can be looked at,
 * corrected and re-validated as many times as it takes.
 */
export async function validateImport(
  actor: AuthUser,
  jobId: number,
  columnMap: Record<string, string>,
): Promise<{ valid: number; errors: number }> {
  const job = await loadJob(actor, jobId)
  if (job.status === 'COMMITTED') throw conflict('That batch has already been imported.')

  const required = IMPORT_FIELDS[job.kind].required
  const missing = required.filter((f) => !columnMap[f])
  if (missing.length) {
    // Structural: the file cannot answer what we must know.
    throw new AppError(
      `Nothing is mapped to ${missing.join(', ')}. Those are needed for every row.`,
      422,
      'MISSING_MAPPING',
    )
  }

  const rows = await db
    .select()
    .from(importRow)
    .where(eq(importRow.jobId, jobId))
    .orderBy(asc(importRow.rowNumber))

  let valid = 0
  let errors = 0

  for (const row of rows) {
    const raw = row.raw as Record<string, string>
    const get = (field: string) => (raw[columnMap[field] ?? ''] ?? '').trim()

    const parsed: Record<string, unknown> = {}
    let error: string | null = null

    for (const field of required) {
      if (!get(field)) error = `${field} is empty`
    }

    if (!error && job.kind === 'DEVICES') {
      const mainType = get('mainType').toUpperCase()
      if (!MAIN_TYPES.includes(mainType as MainType)) {
        error = `"${get('mainType')}" is not a main type (${MAIN_TYPES.join(', ')})`
      } else {
        /*
         * FR-33.2: several IMEIs on one row, accepted even while the business
         * setting shows one field. An importer that dropped the second IMEI
         * of a dual-SIM handset would lose it silently.
         */
        const identifiers = ['imei', 'imei2', 'imei3', 'imei4']
          .map((f) => get(f))
          .filter(Boolean)
        const duplicated = identifiers.length !== new Set(identifiers).size
        if (duplicated) error = 'the same IMEI appears twice on this row'
        else {
          parsed.identifiers = identifiers
          parsed.mainType = mainType
          parsed.isNewCut = /^(1|y|yes|true)$/i.test(get('isNewCut'))
          if (parsed.isNewCut && mainType !== 'GLOBAL') {
            error = 'NEW CUT belongs to GLOBAL and nowhere else'
          }
        }
      }
    }

    if (!error) {
      for (const field of ['purchasePrice', 'sellingPrice', 'amount']) {
        const text = get(field)
        if (!text) continue
        const paise = asMoneyPaise(text)
        if (paise === null) error = `"${text}" is not an amount`
        else parsed[`${field}Paise`] = paise.toString()
      }
    }

    if (!error && job.kind === 'OPENING_STOCK') {
      const qty = Number(get('quantity'))
      if (!Number.isInteger(qty) || qty < 0) error = `"${get('quantity')}" is not a whole number`
      else parsed.quantity = qty
    }

    for (const field of [...required, ...IMPORT_FIELDS[job.kind].optional]) {
      const value = get(field)
      if (value && parsed[field] === undefined) parsed[field] = value
    }

    if (error) errors += 1
    else valid += 1

    await db
      .update(importRow)
      .set({ parsed: error ? null : parsed, error })
      .where(eq(importRow.id, row.id))
  }

  await db
    .update(importJob)
    .set({ status: 'VALIDATED', columnMap, validRows: valid, errorRows: errors })
    .where(eq(importJob.id, jobId))

  return { valid, errors }
}

/* ------------------------------------------------------------- applying --- */

/**
 * Commit the rows that passed.
 *
 * Everything goes through the same service layer as manual entry, so stock,
 * ledgers and device events end up identical to typing it in by hand. The
 * importer never writes to a table directly - that is how an import quietly
 * produces records the rest of the system does not recognise.
 */
export async function commitImport(
  actor: AuthUser,
  ctx: AuditContext,
  jobId: number,
): Promise<{ committed: number; failed: number }> {
  const job = await loadJob(actor, jobId)
  if (job.status === 'COMMITTED') throw conflict('That batch has already been imported.')
  if (job.status !== 'VALIDATED') {
    throw conflict('Check the file over before importing it.')
  }

  /*
   * Claim the job before applying a single row.
   *
   * The status read above is a moment old, and this loop is long: a
   * double-click, or two people importing the same batch, both got past it and
   * both ran the whole file - creating every product and party in it twice.
   * The UPDATE is conditional on the job still being VALIDATED, so exactly one
   * caller can claim it and the other is told the batch is already going in.
   *
   * The counts are filled in at the end; the status is what has to be taken
   * now, because it is the lock.
   */
  const claimed = await db
    .update(importJob)
    .set({ status: 'COMMITTED', committedAt: new Date(), committedBy: actor.id })
    .where(and(eq(importJob.id, jobId), eq(importJob.status, 'VALIDATED')))
    .returning({ id: importJob.id })
  if (!claimed[0]) throw conflict('That batch is already being imported.')

  const rows = await db
    .select()
    .from(importRow)
    .where(and(eq(importRow.jobId, jobId), isNull(importRow.error)))
    .orderBy(asc(importRow.rowNumber))

  let committed = 0
  let failed = 0

  for (const row of rows) {
    const p = row.parsed as Record<string, string | number | boolean | string[]>
    try {
      const ref = await applyRow(actor, ctx, job, p)
      await db
        .update(importRow)
        .set({ appliedRefType: ref.type, appliedRefId: ref.id })
        .where(eq(importRow.id, row.id))
      committed += 1
    } catch (e) {
      /*
       * A row that fails here failed for a reason validation could not see -
       * a duplicate IMEI, a product that does not exist. It is recorded
       * against its line and the rest of the file continues, because stopping
       * would leave the batch half-applied with no way to tell where.
       */
      failed += 1
      await db
        .update(importRow)
        .set({ error: e instanceof Error ? e.message : 'could not be imported' })
        .where(eq(importRow.id, row.id))
    }
  }

  // The status, and who did it, were taken above when the job was claimed.
  await db
    .update(importJob)
    .set({
      committedRows: committed,
      errorRows: job.errorRows + failed,
      validRows: committed,
    })
    .where(eq(importJob.id, jobId))

  await writeAudit(ctx, {
    action: 'CREATE',
    entityType: 'import_job',
    entityId: jobId,
    summary: `Imported ${committed} of ${job.totalRows} rows from ${job.fileName}`,
  })

  return { committed, failed }
}

async function applyRow(
  actor: AuthUser,
  ctx: AuditContext,
  job: typeof importJob.$inferSelect,
  p: Record<string, unknown>,
): Promise<{ type: string; id: number }> {
  const text = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : undefined)
  const paise = (k: string) => (p[k] ? BigInt(p[k] as string) : undefined)

  switch (job.kind) {
    case 'CUSTOMERS':
    case 'SUPPLIERS': {
      const kind = job.kind === 'CUSTOMERS' ? 'customer' : 'supplier'
      const created = await createParty(actor, ctx, kind, {
        name: text('name')!,
        phone: text('phone'),
        altPhone: text('altPhone'),
        email: text('email'),
        gstin: text('gstin'),
        city: text('city'),
        company: text('company'),
      })
      return { type: kind, id: created.id }
    }

    case 'PRODUCTS': {
      const { categoryId, brandId } = await resolveCatalogue(actor, ctx, p)
      const created = await createProduct(actor, ctx, {
        name: text('name')!,
        categoryId,
        brandId,
        sku: text('sku'),
        barcode: text('barcode'),
        hsnCode: text('hsnCode'),
        defaultPurchasePricePaise: paise('purchasePricePaise'),
        defaultSellingPricePaise: paise('sellingPricePaise'),
      })
      return { type: 'product', id: created.id }
    }

    case 'DEVICES': {
      const productId = await resolveProduct(actor, text('product')!)
      const created = await createDevice(actor, ctx, {
        productId,
        identifiers: p.identifiers as string[],
        mainType: p.mainType as MainType,
        isNewCut: p.isNewCut === true,
        variant: text('variant'),
        ram: text('ram'),
        storage: text('storage'),
        colour: text('colour'),
        batteryHealthPercent: p.batteryHealth ? Number(p.batteryHealth) : undefined,
        /*
         * A shop migrating its stock at go-live has warranties running on it
         * (docs/04 §10). Without these the cover would be lost on exactly the
         * handsets nobody can re-derive it for.
         */
        warrantyMonths: p.warrantyMonths ? Number(p.warrantyMonths) : undefined,
        warrantyProvider: text('warrantyProvider'),
        purchasePricePaise: paise('purchasePricePaise'),
        sellingPricePaise: paise('sellingPricePaise'),
        branchId: job.branchId!,
        // An opening-balance import must not date every handset to the day
        // it was uploaded (M10's movement report reads this).
        receivedAt: text('receivedAt') ? new Date(text('receivedAt')!) : undefined,
      })
      return { type: 'device', id: created.id }
    }

    /*
     * Opening balances go through the same service the typed-in screen uses,
     * so a figure looks identical whether it arrived as a file or by hand -
     * and lands in the ledgers everything else is derived from.
     *
     * Dated as at the day the file was uploaded, in shop time. An opening
     * figure is a statement about a day, and the day it was declared is the
     * only one the file itself can be trusted for.
     */
    case 'OPENING_STOCK': {
      const productId = await resolveProduct(actor, text('product')!)
      await postOpeningStockLine(actor, {
        branchId: job.branchId!,
        productId,
        quantity: Number(p.quantity),
        asOf: shopDateString(job.uploadedAt),
      })
      return { type: 'product', id: productId }
    }

    case 'OPENING_CUSTOMER_DUES': {
      const customerId = await resolveParty(actor, 'customer', text('customer')!)
      await postOpeningCustomerDue(actor, {
        customerId,
        amountPaise: paise('amountPaise')!,
        asOf: shopDateString(job.uploadedAt),
        note: text('note'),
      })
      return { type: 'customer', id: customerId }
    }

    case 'OPENING_SUPPLIER_DUES': {
      const supplierId = await resolveParty(actor, 'supplier', text('supplier')!)
      await postOpeningSupplierDue(actor, {
        supplierId,
        amountPaise: paise('amountPaise')!,
        asOf: shopDateString(job.uploadedAt),
        note: text('note'),
      })
      return { type: 'supplier', id: supplierId }
    }
  }
}

/**
 * Find a customer or supplier the file names.
 *
 * Never creates one. A due against a party the shop has not got is far more
 * likely a spelling than a new account, and inventing the account would put
 * money against a name nobody recognises. Matched on name, or on phone for
 * the shops that keep their ledger by number.
 */
async function resolveParty(
  actor: AuthUser,
  kind: 'customer' | 'supplier',
  needle: string,
): Promise<number> {
  const { listParties } = await import('./party.service')
  const found = await listParties(actor, kind, { search: needle, page: 1, pageSize: 10 })
  const wanted = needle.trim().toLowerCase()
  const exact = found.rows.filter(
    (r) => r.name.trim().toLowerCase() === wanted || (r.phone ?? '').trim() === needle.trim(),
  )
  if (exact.length === 0) throw new AppError(`no ${kind} called "${needle}"`, 422, 'UNKNOWN_PARTY')
  if (exact.length > 1) {
    // Two people of the same name: guessing would put the money on the wrong
    // account, and nothing in the file can tell them apart.
    throw new AppError(
      `more than one ${kind} called "${needle}" — import this one by hand`,
      422,
      'AMBIGUOUS_PARTY',
    )
  }
  return exact[0]!.id
}

async function resolveCatalogue(
  actor: AuthUser,
  ctx: AuditContext,
  p: Record<string, unknown>,
): Promise<{ categoryId: number; brandId?: number }> {
  const { listCategories, listBrands, createCategory, createBrand } = await import(
    './product.service'
  )
  const wantedCategory = String(p.category ?? '').trim()
  const wantedBrand = String(p.brand ?? '').trim()

  const categories = await listCategories(actor)
  let category = categories.find((c) => c.name.toLowerCase() === wantedCategory.toLowerCase())
  if (!category) {
    /*
     * A category named in the file but not in the system is created as a
     * counted one. Guessing that it is IMEI-tracked would be worse: a wrong
     * guess there cannot be corrected once products use it.
     */
    const made = await createCategory(actor, ctx, { name: wantedCategory, isSerialised: false })
    category = (await listCategories(actor)).find((c) => c.id === made.id)!
  }

  let brandId: number | undefined
  if (wantedBrand) {
    const brands = await listBrands(actor)
    const found = brands.find((b) => b.name.toLowerCase() === wantedBrand.toLowerCase())
    brandId = found?.id ?? (await createBrand(actor, ctx, { name: wantedBrand })).id
  }

  return { categoryId: category.id, brandId }
}

async function resolveProduct(actor: AuthUser, name: string): Promise<number> {
  const { listProducts } = await import('./product.service')
  const found = await listProducts(actor, { search: name, page: 1, pageSize: 5 })
  const exact = found.rows.find((r) => r.name.toLowerCase() === name.toLowerCase())
  if (!exact) {
    throw new AppError(`no product called "${name}"`, 422, 'UNKNOWN_PRODUCT')
  }
  return exact.id
}

/* -------------------------------------------------------------- reading --- */

async function loadJob(actor: AuthUser, jobId: number) {
  const job = (
    await db
      .select()
      .from(importJob)
      .where(and(eq(importJob.id, jobId), eq(importJob.businessId, actor.businessId)))
      .limit(1)
  )[0]
  if (!job) throw notFound('Import')
  return job
}

export async function getImport(actor: AuthUser, jobId: number, opts: { errorsOnly?: boolean } = {}) {
  const job = await loadJob(actor, jobId)
  const rows = await db
    .select()
    .from(importRow)
    .where(
      and(
        eq(importRow.jobId, jobId),
        opts.errorsOnly ? isNotNull(importRow.error) : undefined,
      ),
    )
    .orderBy(asc(importRow.rowNumber))
    .limit(500)
  return { job, rows }
}

export async function listImports(actor: AuthUser) {
  return db
    .select()
    .from(importJob)
    .where(eq(importJob.businessId, actor.businessId))
    .orderBy(desc(importJob.uploadedAt))
    .limit(50)
}

/** The per-row error report, as a file someone can work through. */
export async function errorReport(actor: AuthUser, jobId: number) {
  const { job, rows } = await getImport(actor, jobId, { errorsOnly: true })
  return {
    name: `import-${jobId}-errors`,
    title: `Rows that could not be imported — ${job.fileName}`,
    subtitle: `${rows.length} of ${job.totalRows} rows`,
    columns: [
      { key: 'rowNumber', header: 'Row' },
      { key: 'error', header: 'What is wrong' },
      { key: 'raw', header: 'The row as uploaded' },
    ],
    rows: rows.map((r) => ({
      rowNumber: r.rowNumber,
      error: r.error,
      raw: Object.entries(r.raw as Record<string, string>)
        .map(([k, v]) => `${k}=${v}`)
        .join(' | '),
    })),
  }
}
