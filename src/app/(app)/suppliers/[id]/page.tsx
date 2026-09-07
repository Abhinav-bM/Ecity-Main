import { notFound, redirect } from 'next/navigation'
import { PartyForm } from '@/components/party-form'
import { SupplierHistory } from '@/components/supplier-history'
import { Attachments } from '@/components/attachments'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getBusiness } from '@/server/services/business.service'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getParty } from '@/server/services/party.service'
import { supplierHistory } from '@/server/services/supplier-ledger.service'
import { listPaymentMethods } from '@/server/services/business.service'
import { listAttachments } from '@/server/services/attachment.service'

export const dynamic = 'force-dynamic'

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'supplier.view')) redirect('/dashboard')

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const party = await getParty(session.user, 'supplier', id)
  const canEdit = hasPermission(session.user, 'supplier.manage')
  const canSeeMoney = hasPermission(session.user, 'supplier_payment.view')

  const [history, methods, files, business] = await Promise.all([
    canSeeMoney ? supplierHistory(session.user, id) : null,
    canSeeMoney ? listPaymentMethods(session.user) : [],
    listAttachments(session.user, 'supplier', id),
      getBusiness(session.user),
  ])

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">{party.name}</h1>
        <p className="text-sm text-muted-foreground">
          {party.company ?? 'Supplier'} · shared across every branch
        </p>
      </div>

      <Tabs defaultValue={canSeeMoney ? 'history' : 'details'}>
        <TabsList className="w-full justify-start overflow-x-auto">
          {canSeeMoney ? <TabsTrigger value="history">History</TabsTrigger> : null}
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
        </TabsList>

        {canSeeMoney && history ? (
          <TabsContent value="history" className="mt-4">
            <SupplierHistory
              supplierId={id}
              supplierName={party.name}
              branchId={session.activeBranchId ?? session.user.branchIds[0] ?? null}
              balancePaise={history.balancePaise}
              purchases={history.purchases}
              payments={history.payments}
              paymentMethods={methods
                .filter((m) => m.isActive)
                .map((m) => ({ id: m.id, name: m.name }))}
              canPay={hasPermission(session.user, 'supplier_payment.manage')}
            />
          </TabsContent>
        ) : null}

        <TabsContent value="details" className="mt-4">
          {canEdit ? (
            <PartyForm
              kind="supplier"
              id={id}
              gstEnabled={business.gstEnabled}
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
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Phone</dt>
              <dd>{party.phone ?? '—'}</dd>
              <dt className="text-muted-foreground">Email</dt>
              <dd>{party.email ?? '—'}</dd>
              {business.gstEnabled ? (
                <>
                  <dt className="text-muted-foreground">GST</dt>
                  <dd>{party.gstin ?? '—'}</dd>
                </>
              ) : null}
            </dl>
          )}
        </TabsContent>

        <TabsContent value="files" className="mt-4">
          <Attachments
            entityType="supplier"
            entityId={id}
            rows={files}
            canManage={hasPermission(session.user, 'attachment.upload')}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
