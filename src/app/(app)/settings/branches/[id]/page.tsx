import { notFound, redirect } from 'next/navigation'
import { orNotFound } from '@/server/page-data'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getBranch } from '@/server/services/branch.service'
import { getBusiness } from '@/server/services/business.service'
import { listUsers } from '@/server/services/user.service'
import { BranchForm } from '../branch-form'

export const dynamic = 'force-dynamic'

export default async function EditBranchPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'branch.manage')) redirect('/settings/branches')

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const [branch, users, business] = await orNotFound(Promise.all([
    getBranch(session.user, id),
    listUsers(session.user),
    getBusiness(session.user),
  ]))

  return (
    <BranchForm
      id={id}
      managers={users.filter((u) => u.isActive).map((u) => ({ id: u.id, name: u.name }))}
      gstEnabled={business.gstEnabled}
      initial={{
        code: branch.code,
        name: branch.name,
        phone: branch.phone ?? '',
        email: branch.email ?? '',
        addressLine1: branch.addressLine1 ?? '',
        addressLine2: branch.addressLine2 ?? '',
        city: branch.city ?? '',
        state: branch.state ?? '',
        pincode: branch.pincode ?? '',
        gstin: branch.gstin ?? '',
        stateCode: branch.stateCode ?? '',
        invoicePrefix: branch.invoicePrefix ?? '',
        managerUserId: branch.managerUserId,
        notes: branch.notes ?? '',
      }}
    />
  )
}
