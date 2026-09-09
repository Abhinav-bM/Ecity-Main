import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Attachments } from '@/components/attachments'
import { formatMoney } from '@/lib/money'
import { formatDateTime } from '@/lib/utils'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getExpense } from '@/server/services/expense.service'
import { listAttachments } from '@/server/services/attachment.service'

export const dynamic = 'force-dynamic'

/** PRD FR-10.2 — one expense, with its receipt. */
export default async function ExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'expense.view')) redirect('/dashboard')

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const [expense, files] = await Promise.all([
    getExpense(session.user, id),
    listAttachments(session.user, 'expense', id),
  ])

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link
          href="/expenses"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Expenses
        </Link>
        <h1 className="mt-1 text-lg font-semibold tracking-tight sm:text-xl">
          {expense.categoryName}
          <span className="tabular ml-2">{formatMoney(expense.amountPaise)}</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          {expense.businessDate} · {expense.branchName} · paid by {expense.methodName}
        </p>
      </div>

      {expense.voidedAt ? (
        <Card className="border-destructive">
          <CardContent className="py-3 text-sm">
            <Badge variant="destructive">VOIDED</Badge>{' '}
            {formatDateTime(expense.voidedAt)} — {expense.voidReason}
            <p className="mt-1 text-muted-foreground">
              The entry is kept and the money was posted back. Nothing here is deleted.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-1 text-sm">
            <dt className="text-muted-foreground">Description</dt>
            <dd>{expense.description ?? '—'}</dd>
            <dt className="text-muted-foreground">Reference</dt>
            <dd>{expense.reference ?? '—'}</dd>
            <dt className="text-muted-foreground">Recorded by</dt>
            <dd>{expense.recordedBy ?? '—'}</dd>
            {expense.postedAfterClose ? (
              <>
                <dt className="text-muted-foreground">Note</dt>
                <dd>
                  <Badge variant="warning">Recorded after the day was closed</Badge>
                </dd>
              </>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Attachments
        entityType="expense"
        entityId={id}
        rows={files}
        canManage={hasPermission(session.user, 'attachment.upload') && !expense.voidedAt}
        description="The receipt or bill for this expense. Images or PDF, up to 5 MB."
      />
    </div>
  )
}
