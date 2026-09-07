import { redirect } from 'next/navigation'
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
import { formatMoney } from '@/lib/money'
import { formatDateShort } from '@/lib/utils'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listAccounts } from '@/server/services/cash.service'
import { listBranches } from '@/server/services/branch.service'
import { AccountActions } from './account-actions'

export const dynamic = 'force-dynamic'

/** PRD FR-12.1 – FR-12.4. Money that is not in a till. */
export default async function AccountsPage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'account.view')) redirect('/dashboard')

  const canManage = hasPermission(session.user, 'account.manage')
  const [accounts, branches] = await Promise.all([
    listAccounts(session.user, { includeInactive: true }),
    listBranches(session.user),
  ])

  const total = accounts
    .filter((a) => a.isActive)
    .reduce((sum, a) => sum + a.balancePaise, 0n)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Accounts</h1>
          <p className="text-sm text-muted-foreground">
            Bank, UPI and card balances. Every figure is the sum of its transactions, never a
            stored number.
          </p>
        </div>
        {canManage ? (
          <AccountActions
            accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
            branches={branches.map((b) => ({ id: b.id, name: b.name }))}
          />
        ) : null}
      </div>

      <Card className="p-4">
        <p className="text-xs text-muted-foreground">Across every active account</p>
        <p className="tabular text-2xl font-semibold">{formatMoney(total)}</p>
      </Card>

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No accounts yet. Add the shop&rsquo;s bank or UPI account to track what is in it.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:hidden" data-testid="account-cards">
            {accounts.map((a) => (
              <Card key={a.id} data-testid="account-row">
                <CardContent className="space-y-1.5 py-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{a.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.type} · {a.branchName ?? 'All branches'}
                      </p>
                    </div>
                    <p className="tabular font-semibold">{formatMoney(a.balancePaise)}</p>
                  </div>
                  {a.unreconciledPaise !== null && a.unreconciledPaise !== 0n ? (
                    <Badge variant="warning">
                      {formatMoney(
                        a.unreconciledPaise < 0n ? -a.unreconciledPaise : a.unreconciledPaise,
                      )}{' '}
                      unreconciled
                    </Badge>
                  ) : null}
                  {!a.isActive ? <Badge variant="secondary">Inactive</Badge> : null}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="hidden overflow-hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Last reconciled</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="text-right">Unreconciled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((a) => (
                  <TableRow key={a.id} data-testid="account-row">
                    <TableCell>
                      {a.name}
                      {!a.isActive ? (
                        <Badge variant="secondary" className="ml-1.5">
                          Inactive
                        </Badge>
                      ) : null}
                      {a.bankName ? (
                        <span className="block text-xs text-muted-foreground">{a.bankName}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{a.type}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {a.branchName ?? 'All branches'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {a.reconciledAt ? formatDateShort(a.reconciledAt) : '—'}
                    </TableCell>
                    <TableCell className="tabular text-right font-medium">
                      {formatMoney(a.balancePaise)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {a.unreconciledPaise === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : a.unreconciledPaise === 0n ? (
                        <span className="text-success">Matched</span>
                      ) : (
                        <span className="text-warning-foreground">
                          {formatMoney(
                            a.unreconciledPaise < 0n ? -a.unreconciledPaise : a.unreconciledPaise,
                          )}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  )
}
