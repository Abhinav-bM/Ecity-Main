import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { MainTypeBadge } from '@/components/main-type-badge'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { inspectionQueue } from '@/server/services/return.service'
import { formatDateShort } from '@/lib/utils'
import { InspectButton } from './inspect-button'

export const dynamic = 'force-dynamic'

/** PRD FR-8.2, FR-8.3. Returned handsets waiting to be graded. */
export default async function InspectionQueuePage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'return.view')) redirect('/dashboard')

  const canInspect = hasPermission(session.user, 'return.inspect')
  const queue = await inspectionQueue(session.user, session.activeBranchId)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Inspection queue</h1>
        <p className="text-sm text-muted-foreground">
          Returned handsets are not sellable until someone grades them. Their type and NEW CUT
          status are unchanged by grading.
        </p>
      </div>

      {queue.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nothing waiting. Returned handsets appear here.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:hidden" data-testid="inspection-cards">
            {queue.map((d) => (
              <Card key={d.id} data-testid="inspection-row">
                <CardContent className="space-y-2 py-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/devices/${d.id}`}
                        className="font-mono text-xs underline-offset-4 hover:underline"
                      >
                        {d.identifier}
                      </Link>
                      <p className="text-muted-foreground">{d.productName}</p>
                    </div>
                    <MainTypeBadge mainType={d.mainType} isNewCut={d.isNewCut} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {d.branchName} · returned {formatDateShort(d.updatedAt)}
                  </p>
                  {canInspect ? (
                    <InspectButton deviceId={d.id} identifier={d.identifier} mainType={d.mainType} />
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="hidden overflow-hidden md:block" data-testid="inspection-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Identifier</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Returned</TableHead>
                  {canInspect ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {queue.map((d) => (
                  <TableRow key={d.id} data-testid="inspection-row">
                    <TableCell className="font-mono text-xs">
                      <Link href={`/devices/${d.id}`} className="underline-offset-4 hover:underline">
                        {d.identifier}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {d.productName}
                      {d.storage ? (
                        <span className="block text-xs text-muted-foreground">
                          {d.storage}
                          {d.colour ? ` · ${d.colour}` : ''}
                          {d.batteryHealthPercent != null
                            ? ` · battery ${d.batteryHealthPercent}%`
                            : ''}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <MainTypeBadge mainType={d.mainType} isNewCut={d.isNewCut} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{d.branchName}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateShort(d.updatedAt)}
                    </TableCell>
                    {canInspect ? (
                      <TableCell className="text-right">
                        <InspectButton
                          deviceId={d.id}
                          identifier={d.identifier}
                          mainType={d.mainType}
                        />
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      {!canInspect ? (
        <p className="text-xs text-muted-foreground">
          You can see the queue but not grade. Ask a manager to release these.
        </p>
      ) : null}
    </div>
  )
}
