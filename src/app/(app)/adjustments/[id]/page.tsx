import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Attachments } from '@/components/attachments'
import { MainTypeBadge } from '@/components/main-type-badge'
import { formatDateTime } from '@/lib/utils'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getAdjustment } from '@/server/services/adjustment.service'
import { listAttachments } from '@/server/services/attachment.service'

export const dynamic = 'force-dynamic'

const REASON_LABEL: Record<string, string> = {
  DAMAGE: 'Damage',
  LOSS: 'Loss',
  MISCOUNT: 'Miscount',
  DATA_ENTRY_ERROR: 'Data-entry error',
}

/** One adjustment and the evidence behind it (PRD M8, FR-28.2). */
export default async function AdjustmentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'adjustment.view')) redirect('/dashboard')

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const [a, files] = await Promise.all([
    getAdjustment(session.user, id),
    listAttachments(session.user, 'stock_adjustment', id),
  ])

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link
          href="/adjustments"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Adjustments
        </Link>
        <h1 className="mt-1 text-lg font-semibold tracking-tight sm:text-xl">{a.productName}</h1>
        <p className="text-sm text-muted-foreground">
          {a.branchName} · {formatDateTime(a.adjustedAt)} · {a.adjustedBy ?? '—'}
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">What changed</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-1 text-sm">
            <dt className="text-muted-foreground">Reason</dt>
            <dd>
              <Badge variant="warning">{REASON_LABEL[a.reason] ?? a.reason}</Badge>
            </dd>
            {a.deviceId ? (
              <>
                <dt className="text-muted-foreground">IMEI</dt>
                <dd className="font-mono text-xs">{a.identifier ?? '—'}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  {a.deviceStatusBefore} → {a.deviceStatusAfter}
                </dd>
                <dt className="text-muted-foreground">Classification at the time</dt>
                <dd>
                  {a.mainTypeSnapshot ? (
                    <MainTypeBadge
                      mainType={a.mainTypeSnapshot}
                      isNewCut={a.isNewCutSnapshot}
                    />
                  ) : (
                    '—'
                  )}
                </dd>
              </>
            ) : (
              <>
                <dt className="text-muted-foreground">Count</dt>
                <dd className="tabular">
                  {a.quantityBefore} → {a.quantityAfter}{' '}
                  <span className={a.quantityDelta < 0 ? 'text-destructive' : 'text-success'}>
                    ({a.quantityDelta > 0 ? '+' : ''}
                    {a.quantityDelta})
                  </span>
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Notes</dt>
            <dd>{a.notes ?? '—'}</dd>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            An adjustment is never edited. If this one is wrong, record a second correcting it —
            both then stay visible.
          </p>
        </CardContent>
      </Card>

      <Attachments
        entityType="stock_adjustment"
        entityId={id}
        rows={files}
        canManage={hasPermission(session.user, 'attachment.upload')}
        description="Evidence: a photo of the damage, or the count sheet. Images or PDF, up to 8 MB."
      />
    </div>
  )
}
