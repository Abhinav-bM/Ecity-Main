import { notFound, redirect } from 'next/navigation'
import { PartyForm } from '@/components/party-form'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getParty } from '@/server/services/party.service'
import { getCustomerHistory } from '@/server/services/sale.service'
import { CustomerHistory } from './history'

export const dynamic = 'force-dynamic'

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'customer.view')) redirect('/dashboard')

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const canManage = hasPermission(session.user, 'customer.manage')
  const canSeeSales = hasPermission(session.user, 'sale.view')

  const [party, history] = await Promise.all([
    getParty(session.user, 'customer', id),
    canSeeSales ? getCustomerHistory(session.user, id) : null,
  ])

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">{party.name}</h1>
        <p className="text-sm text-muted-foreground">
          {party.phone ?? 'Customer'} · shared across every branch
        </p>
      </div>

      {/*
        History leads: someone opening a customer is usually answering "what
        did they buy?" rather than correcting a typo in the address.
      */}
      <Tabs defaultValue={history ? 'history' : 'details'}>
        <TabsList className="w-full justify-start overflow-x-auto">
          {history ? <TabsTrigger value="history">History</TabsTrigger> : null}
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>

        {history ? (
          <TabsContent value="history" className="mt-4">
            <CustomerHistory history={history} />
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
