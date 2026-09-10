import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { orNotFound } from '@/server/page-data'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Pagination } from '@/components/pagination'
import { formatMoney } from '@/lib/money'
import { formatDateTime } from '@/lib/utils'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { accountLedger } from '@/server/services/cash.service'
import { readPage } from '@/lib/list-view'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

const MOVEMENT_LABEL: Record<string, string> = {
  OPENING: 'Opening',
  SALE: 'Sale',
  CUSTOMER_PAYMENT: 'Collection',
  REFUND: 'Refund',
  EXPENSE: 'Expense',
  SUPPLIER_PAYMENT: 'Supplier payment',
  TRANSFER_IN: 'Transfer in',
  TRANSFER_OUT: 'Transfer out',
  ADJUSTMENT: 'Adjustment',
}

/** PRD FR-12.3 — every movement through one account, newest first. */
export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'account.view')) redirect('/dashboard')

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const p = await searchParams
  const page = readPage(p.page)
  const { account, rows, total } = await orNotFound(
    accountLedger(session.user, id, { page, pageSize: PAGE_SIZE }),
  )

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/accounts"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Accounts
        </Link>
        <h1 className="mt-1 text-lg font-semibold tracking-tight sm:text-xl">{account.name}</h1>
        <p className="text-sm text-muted-foreground">
          {account.type} · {account.branchName ?? 'All branches'}
          {account.bankName ? ` · ${account.bankName}` : ''}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4" data-testid="account-balance">
          <p className="text-xs text-muted-foreground">Balance</p>
          <p className="tabular text-2xl font-semibold">{formatMoney(account.balancePaise)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Last statement</p>
          <p className="tabular text-xl font-semibold">
            {account.reconciledBalancePaise === null
              ? '—'
              : formatMoney(account.reconciledBalancePaise)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Unreconciled</p>
          <p className="tabular text-xl font-semibold">
            {account.unreconciledPaise === null ? (
              <span className="text-muted-foreground">Never checked</span>
            ) : account.unreconciledPaise === 0n ? (
              <span className="text-success">Matched</span>
            ) : (
              formatMoney(account.unreconciledPaise)
            )}
          </p>
        </Card>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nothing has moved through this account yet.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:hidden" data-testid="txn-cards">
            {rows.map((t) => (
              <Card key={t.id} data-testid="txn-row">
                <CardContent className="flex items-start justify-between gap-2 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{MOVEMENT_LABEL[t.movement] ?? t.movement}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.businessDate}
                      {t.note ? ` · ${t.note}` : ''}
                    </p>
                  </div>
                  <p
                    className={`tabular font-semibold ${
                      t.amountPaise < 0n ? 'text-destructive' : 'text-success'
                    }`}
                  >
                    {t.amountPaise < 0n ? '−' : '+'}
                    {formatMoney(t.amountPaise < 0n ? -t.amountPaise : t.amountPaise)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="hidden overflow-hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="text-right">In</TableHead>
                  <TableHead className="text-right">Out</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id} data-testid="txn-row">
                    <TableCell className="whitespace-nowrap">
                      {t.businessDate}
                      <span className="block text-xs text-muted-foreground">
                        {formatDateTime(t.occurredAt)}
                      </span>
                    </TableCell>
                    <TableCell>
                      {MOVEMENT_LABEL[t.movement] ?? t.movement}
                      {t.movement === 'ADJUSTMENT' ? (
                        <Badge variant="warning" className="ml-1.5">
                          Adjustment
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {t.branchName ?? 'All branches'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{t.note ?? '—'}</TableCell>
                    <TableCell className="tabular text-right text-success">
                      {t.amountPaise > 0n ? formatMoney(t.amountPaise) : ''}
                    </TableCell>
                    <TableCell className="tabular text-right text-destructive">
                      {t.amountPaise < 0n ? formatMoney(-t.amountPaise) : ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Pagination
            basePath={`/accounts/${id}`}
            params={p}
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            noun="movements"
          />
        </>
      )}
    </div>
  )
}
