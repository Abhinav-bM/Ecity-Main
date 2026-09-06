import { notFound, redirect } from 'next/navigation'
import { PartyForm } from '@/components/party-form'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getParty } from '@/server/services/party.service'
import { getCustomerHistory } from '@/server/services/sale.service'
import {
  customerBalance,
  customerReceipts,
  customerStatement,
} from '@/server/services/customer-ledger.service'
import { formatMoney } from '@/lib/money'
import { formatDateShort } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { CustomerHistory } from './history'
import { Statement } from './statement'

export const dynamic = 'force-dynamic'

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'customer.view')) redirect('/dashboard')

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const canManage = hasPermission(session.user, 'customer.manage')
  const canSeeSales = hasPermission(session.user, 'sale.view')
  const canSeeMoney = hasPermission(session.user, 'customer_payment.view')
  const canCollect = hasPermission(session.user, 'customer_payment.manage')

  const [party, history, statement, receipts, balance] = await Promise.all([
    getParty(session.user, 'customer', id),
    canSeeSales ? getCustomerHistory(session.user, id) : null,
    canSeeMoney ? customerStatement(session.user, id) : null,
    canSeeMoney ? customerReceipts(session.user, id) : [],
    canSeeMoney ? customerBalance(id) : 0n,
  ])

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">{party.name}</h1>
          <p className="text-sm text-muted-foreground">
            {party.phone ?? 'Customer'} · shared across every branch
          </p>
        </div>
        {canSeeMoney && balance !== 0n ? (
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">
                {balance > 0n ? 'Owes' : 'In credit'}
              </p>
              <p
                className={`tabular text-lg font-semibold ${balance > 0n ? 'text-destructive' : ''}`}
              >
                {formatMoney(balance > 0n ? balance : -balance)}
              </p>
            </div>
            {canCollect ? (
              <Button asChild>
                <Link href={`/customers/${id}/collect`}>Collect</Link>
              </Button>
            ) : null}
          </div>
        ) : canCollect ? (
          <Button variant="outline" asChild>
            <Link href={`/customers/${id}/collect`}>Collect</Link>
          </Button>
        ) : null}
      </div>

      {/*
        History leads: someone opening a customer is usually answering "what
        did they buy?" rather than correcting a typo in the address.
      */}
      <Tabs defaultValue={history ? 'history' : 'details'}>
        <TabsList className="w-full justify-start overflow-x-auto">
          {history ? <TabsTrigger value="history">History</TabsTrigger> : null}
          {statement ? <TabsTrigger value="statement">Statement</TabsTrigger> : null}
          {statement ? <TabsTrigger value="receipts">Receipts</TabsTrigger> : null}
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>

        {history ? (
          <TabsContent value="history" className="mt-4">
            <CustomerHistory history={history} />
          </TabsContent>
        ) : null}

        {statement ? (
          <TabsContent value="statement" className="mt-4">
            <Statement statement={statement} />
          </TabsContent>
        ) : null}

        {statement ? (
          <TabsContent value="receipts" className="mt-4">
            <Receipts rows={receipts} />
          </TabsContent>
        ) : null}

        <TabsContent value="details" className="mt-4">
          <PartyForm
            kind="customer"
            id={id}
            readOnly={!canManage}
            initial={{
              name: party.name,
              company: party.company ?? '',
              phone: party.phone ?? '',
              altPhone: party.altPhone ?? '',
              email: party.email ?? '',
              addressLine1: party.addressLine1 ?? '',
              addressLine2: party.addressLine2 ?? '',
              city: party.city ?? '',
              state: party.state ?? '',
              pincode: party.pincode ?? '',
              gstin: party.gstin ?? '',
              stateCode: party.stateCode ?? '',
              notes: party.notes ?? '',
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/** Money collected from this customer, newest first (PRD FR-7.3). */
function Receipts({
  rows,
}: {
  rows: Awaited<ReturnType<typeof customerReceipts>>
}) {
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No payments collected yet. Money taken at the counter shows on the bill itself.
      </p>
    )
  }
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <Link
          key={r.id}
          href={`/receipts/${r.id}`}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm hover:bg-accent"
        >
          <div className="min-w-0">
            <p className="font-mono text-xs">{r.receiptNumber}</p>
            <p className="text-xs text-muted-foreground">
              {formatDateShort(r.receivedOn)} · {r.methodName} · {r.branchName}
              {r.reference ? ` · ${r.reference}` : ''}
            </p>
          </div>
          <p
            className={`tabular font-medium ${r.voidedAt ? 'text-muted-foreground line-through' : ''}`}
          >
            {formatMoney(r.amountPaise)}
          </p>
        </Link>
      ))}
    </div>
  )
}
