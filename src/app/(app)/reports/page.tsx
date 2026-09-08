import { redirect } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatMoney } from '@/lib/money'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { selectableBranches } from '@/server/services/analytics.service'
import { buildReport, REPORTS, type ReportName } from '@/server/services/reports.service'
import { listSavedReports } from '@/server/services/saved-report.service'
import { rangeFromParams } from '../analytics/shared'
import { ReportControls } from './report-controls'

export const dynamic = 'force-dynamic'

/** The largest table worth putting on a screen; the rest is what exports are for. */
const PREVIEW_ROWS = 100

/**
 * The report centre (PRD FR-25.1 – FR-25.4).
 *
 * Eight families, one set of filters, three export formats. The screen shows a
 * preview; the file is what someone actually takes away.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'analytics.view')) redirect('/dashboard')

  const p = await searchParams
  const { range, branchId } = rangeFromParams(p)
  const name = (Object.keys(REPORTS).includes(p.report ?? '') ? p.report : 'sales') as ReportName

  const [branches, saved] = await Promise.all([
    selectableBranches(session.user),
    listSavedReports(session.user),
  ])

  let spec: Awaited<ReturnType<typeof buildReport>> | null = null
  let error: string | null = null
  try {
    spec = await buildReport(session.user, name, range)
  } catch (e) {
    // A report the user may not see says so, rather than blanking the page.
    error = e instanceof Error ? e.message : 'That report could not be built.'
  }

  const rows = spec ? (spec.rows as Record<string, unknown>[]) : []
  const shown = rows.slice(0, PREVIEW_ROWS)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Pick a report, set the period, take the file. Every one exports as CSV, Excel or PDF.
        </p>
      </div>

      <ReportControls
        reports={Object.entries(REPORTS).map(([value, label]) => ({ value, label }))}
        branches={branches}
        report={name}
        from={range.from}
        to={range.to}
        branchId={branchId}
        saved={saved}
      />

      {error ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">{error}</CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nothing in this period.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <Table data-testid="report-table">
                <TableHeader>
                  <TableRow>
                    {spec!.columns.map((c) => (
                      <TableHead key={c.key} className={c.align === 'right' ? 'text-right' : ''}>
                        {c.header}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((row, i) => (
                    <TableRow key={i} data-testid="report-row">
                      {spec!.columns.map((c) => {
                        const value = row[c.key]
                        return (
                          <TableCell
                            key={c.key}
                            className={c.align === 'right' ? 'tabular text-right' : ''}
                          >
                            {value === null || value === undefined
                              ? '—'
                              : c.money
                                ? formatMoney(value as bigint)
                                : value instanceof Date
                                  ? value.toISOString().slice(0, 16).replace('T', ' ')
                                  : String(value)}
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          <p className="text-xs text-muted-foreground" data-testid="report-count">
            {rows.length > PREVIEW_ROWS
              ? `Showing the first ${PREVIEW_ROWS} of ${rows.length} rows. The export has all of them.`
              : `${rows.length} row${rows.length === 1 ? '' : 's'}.`}
          </p>
        </>
      )}
    </div>
  )
}
