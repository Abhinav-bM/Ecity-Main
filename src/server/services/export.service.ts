import { PassThrough } from 'node:stream'
import ExcelJS from 'exceljs'
import { db } from '@/server/db'
import { exportJob } from '@/server/db/schema'
import type { AuthUser } from '@/server/auth/permissions'
import { AppError } from '@/server/http'
import { formatMoney } from '@/lib/money'

/**
 * Exports (PRD FR-33.1 – FR-33.3).
 *
 * Every report produces the same shape - a list of columns and an async
 * iterable of rows - and the three writers turn that into CSV, Excel or PDF.
 * One report therefore gets all three formats for free, and a new format is
 * one writer rather than eight.
 *
 * Rows arrive as an async iterable so a large export never has to exist in
 * memory all at once: the CSV and Excel writers stream, and only the PDF
 * (which is a paginated document by nature) buffers, with a row cap that says
 * so rather than quietly truncating.
 */

export type ExportColumn = {
  key: string
  header: string
  /** Money is bigint paise; everything else is rendered as written. */
  money?: boolean
  align?: 'right'
}

export type ExportFormat = 'csv' | 'xlsx' | 'pdf'

export type ExportSpec = {
  /** Used for the file name and the export log. */
  name: string
  title: string
  subtitle?: string
  columns: ExportColumn[]
  rows: AsyncIterable<Record<string, unknown>> | Record<string, unknown>[]
}

/** A PDF is a document, not a stream; past this it is the wrong format. */
const PDF_ROW_LIMIT = 5_000

function cell(value: unknown, column: ExportColumn): string {
  if (value === null || value === undefined) return ''
  if (column.money) return formatMoney(value as bigint)
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

/**
 * CSV, quoted the way a spreadsheet expects.
 *
 * A leading BOM so Excel opens it as UTF-8 rather than mangling any name with
 * an accent in it - the single most common complaint about exported CSVs.
 */
function csvCell(text: string): string {
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

async function* toAsync(
  rows: AsyncIterable<Record<string, unknown>> | Record<string, unknown>[],
): AsyncIterable<Record<string, unknown>> {
  if (Array.isArray(rows)) {
    for (const row of rows) yield row
    return
  }
  yield* rows
}

function csvStream(spec: ExportSpec): { body: ReadableStream<Uint8Array>; counted: () => number } {
  let count = 0
  const encoder = new TextEncoder()

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // A BOM, so Excel opens it as UTF-8 rather than mangling accents.
        controller.enqueue(encoder.encode('\uFEFF'))
        controller.enqueue(
          encoder.encode(spec.columns.map((c) => csvCell(c.header)).join(',') + '\r\n'),
        )
        for await (const row of toAsync(spec.rows)) {
          count += 1
          const line = spec.columns.map((c) => csvCell(cell(row[c.key], c))).join(',')
          controller.enqueue(encoder.encode(line + '\r\n'))
        }
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })

  return { body, counted: () => count }
}

/**
 * Excel, written through ExcelJS's streaming workbook.
 *
 * The streaming writer flushes rows to the output as they are added rather
 * than holding the sheet in memory, which is the whole reason to use it over
 * the ordinary workbook.
 */
async function xlsxBuffer(spec: ExportSpec): Promise<{ buffer: Buffer; count: number }> {
  /*
   * A real PassThrough, not a hand-rolled sink.
   *
   * ExcelJS waits on the stream's own events to know when a flush has landed;
   * an object with no-op `on`/`once` satisfies TypeScript and then hangs
   * forever, because the event it is waiting for never fires. This was exactly
   * that bug - the endpoint returned nothing at all until the request timed
   * out.
   */
  const chunks: Buffer[] = []
  const sink = new PassThrough()
  sink.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
  const finished = new Promise<void>((resolve, reject) => {
    sink.on('end', resolve)
    sink.on('error', reject)
  })

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: sink,
    useStyles: true,
  })
  const sheet = workbook.addWorksheet(spec.title.slice(0, 31))

  sheet.columns = spec.columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: Math.max(12, Math.min(40, c.header.length + 6)),
  }))
  sheet.getRow(1).font = { bold: true }

  let count = 0
  for await (const row of toAsync(spec.rows)) {
    count += 1
    const out: Record<string, unknown> = {}
    for (const c of spec.columns) {
      const value = row[c.key]
      /*
       * Money goes in as a number of rupees, not as text - a spreadsheet that
       * cannot sum its own money column is not much use. Divided from paise
       * with integer arithmetic first so no precision is invented.
       */
      out[c.key] =
        c.money && value !== null && value !== undefined
          ? Number((value as bigint) / 100n) + Number((value as bigint) % 100n) / 100
          : cell(value, c)
    }
    sheet.addRow(out).commit()
  }

  sheet.commit()
  await workbook.commit()
  await finished
  return { buffer: Buffer.concat(chunks), count }
}

/** A plain, printable PDF. The invoice has its own richer renderer. */
async function pdfBuffer(spec: ExportSpec): Promise<{ buffer: Buffer; count: number }> {
  const rows: Record<string, unknown>[] = []
  for await (const row of toAsync(spec.rows)) {
    rows.push(row)
    if (rows.length > PDF_ROW_LIMIT) {
      throw new AppError(
        `That is more than ${PDF_ROW_LIMIT.toLocaleString('en-IN')} rows. Export it as CSV or Excel instead — a PDF that long is not readable anyway.`,
        422,
        'TOO_MANY_ROWS',
      )
    }
  }

  const { renderReportPdf } = await import('@/server/pdf/report-pdf')
  const buffer = await renderReportPdf({
    title: spec.title,
    subtitle: spec.subtitle,
    columns: spec.columns.map((c) => ({ header: c.header, align: c.align })),
    rows: rows.map((r) => spec.columns.map((c) => cell(r[c.key], c))),
  })
  return { buffer, count: rows.length }
}

function fileName(spec: ExportSpec, format: ExportFormat): string {
  const stamp = new Date().toISOString().slice(0, 10)
  const safe = spec.name.replace(/[^A-Za-z0-9._-]/g, '-')
  return `${safe}-${stamp}.${format}`
}

const CONTENT_TYPE: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
}

/**
 * Turn a report into a downloadable response, and record that it happened.
 *
 * CSV streams straight through; the other two produce a buffer, because
 * neither format can be written without knowing where things end.
 */
export async function exportReport(
  actor: AuthUser,
  spec: ExportSpec,
  format: ExportFormat,
  filters: Record<string, unknown> = {},
): Promise<Response> {
  const headers = {
    'content-type': CONTENT_TYPE[format],
    'content-disposition': `attachment; filename="${fileName(spec, format)}"`,
    'cache-control': 'private, no-store',
  }

  async function log(rowCount: number) {
    await db.insert(exportJob).values({
      businessId: actor.businessId,
      report: spec.name,
      format,
      filters: JSON.parse(JSON.stringify(filters, (_k, v) => (typeof v === 'bigint' ? String(v) : v))),
      rowCount,
      createdBy: actor.id,
    })
  }

  if (format === 'csv') {
    const { body, counted } = csvStream(spec)
    /*
     * Logged after the stream finishes, so the row count is real rather than
     * a guess - and a download that failed halfway is not recorded as a
     * complete one.
     */
    const [toSend, toCount] = body.tee()
    void (async () => {
      const reader = toCount.getReader()
      while (!(await reader.read()).done) {
        /* drain */
      }
      await log(counted())
    })()
    return new Response(toSend, { headers })
  }

  const { buffer, count } =
    format === 'xlsx' ? await xlsxBuffer(spec) : await pdfBuffer(spec)
  await log(count)
  return new Response(new Uint8Array(buffer), { headers })
}
