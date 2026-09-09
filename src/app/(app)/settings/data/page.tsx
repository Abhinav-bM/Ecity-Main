import { redirect } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { businessExportSummary } from '@/server/services/business-export.service'
import { db } from '@/server/db'
import { exportJob } from '@/server/db/schema'
import { formatDateTime } from '@/lib/utils'
import { ExportButton } from './export-button'

export const dynamic = 'force-dynamic'

/**
 * PRD FR-32.1, FR-32.3. Your data, and proof it is being kept.
 *
 * Two different promises, deliberately on one page. The export is the owner's
 * copy — what they would still have if this software went away. The backup
 * history is the shop's assurance that somebody is keeping one; a backup
 * nobody can see the state of is a backup nobody trusts.
 */
export default async function DataPage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'business.manage')) redirect('/dashboard')

  const [summary, exports] = await Promise.all([
    businessExportSummary(session.user),
    db
      .select()
      .from(exportJob)
      .where(eq(exportJob.businessId, session.user.businessId))
      .orderBy(desc(exportJob.createdAt))
      .limit(10),
  ])

  const withRows = summary.tables.filter((t) => t.rows > 0)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Your data</h1>
        <p className="text-sm text-muted-foreground">
          Take a complete copy of everything this shop has recorded.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Full export</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {summary.totalRows.toLocaleString('en-IN')} rows across {withRows.length} tables, as
            one spreadsheet file. Every customer, product, sale, payment and device — the data
            itself, not a summary of it.
          </p>
          <ExportButton />
          <p className="text-xs text-muted-foreground">
            This is <strong>your data</strong>, not a system backup. Restoring the software after
            a server failure needs a database backup, which runs automatically on the server.
          </p>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">What it contains</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table data-testid="export-contents">
            <TableHeader>
              <TableRow>
                <TableHead>Table</TableHead>
                <TableHead className="text-right">Rows</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {withRows.map((t) => (
                <TableRow key={t.table}>
                  <TableCell>{t.label}</TableCell>
                  <TableCell className="tabular text-right">
                    {t.rows.toLocaleString('en-IN')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      {exports.length > 0 ? (
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Recent exports</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table data-testid="export-history">
              <TableHeader>
                <TableRow>
                  <TableHead>What</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exports.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{e.report.replace(/-/g, ' ')}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(e.createdAt)}
                    </TableCell>
                    <TableCell className="tabular text-right">{e.rowCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      ) : null}
    </div>
  )
}
