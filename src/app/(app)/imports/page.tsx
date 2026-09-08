import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDateTime } from '@/lib/utils'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listImports } from '@/server/services/import.service'
import { listBranches } from '@/server/services/branch.service'
import { ImportWizard } from './import-wizard'

export const dynamic = 'force-dynamic'

/** PRD FR-33.1. Upload, map, check, commit — with the history of what went in. */
export default async function ImportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'product.manage')) redirect('/dashboard')

  const { kind } = await searchParams
  const [jobs, branches] = await Promise.all([
    listImports(session.user),
    listBranches(session.user),
  ])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Import</h1>
        <p className="text-sm text-muted-foreground">
          Bring existing data in from a spreadsheet. Nothing is created until you have seen what
          will happen.
        </p>
      </div>

      <ImportWizard
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        defaultKind={kind}
      />

      {jobs.length > 0 ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table data-testid="import-history">
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead className="text-right">Imported</TableHead>
                  <TableHead className="text-right">Problems</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.id} data-testid="import-row">
                    <TableCell className="max-w-[16rem] truncate">{j.fileName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {j.kind.replace(/_/g, ' ').toLowerCase()}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(j.uploadedAt)}
                    </TableCell>
                    <TableCell className="tabular text-right">{j.totalRows}</TableCell>
                    <TableCell className="tabular text-right">{j.committedRows}</TableCell>
                    <TableCell className="tabular text-right">
                      {j.errorRows > 0 ? (
                        <Link
                          href={`/api/imports/${j.id}/errors?format=csv`}
                          className="underline underline-offset-4"
                        >
                          {j.errorRows}
                        </Link>
                      ) : (
                        0
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          j.status === 'COMMITTED'
                            ? 'success'
                            : j.status === 'FAILED'
                              ? 'destructive'
                              : 'secondary'
                        }
                      >
                        {j.status.toLowerCase()}
                      </Badge>
                    </TableCell>
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
