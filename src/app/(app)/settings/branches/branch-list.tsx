'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { BranchListItem } from '@/server/services/branch.service'

export function BranchList({
  branches,
  canManage,
}: {
  branches: BranchListItem[]
  canManage: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  async function toggle(b: BranchListItem) {
    const status = b.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    const res = await fetch(`/api/branches/${b.id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      toast.error(data.error ?? 'Could not update the branch.')
      return
    }
    toast.success(`${b.name} ${status === 'ACTIVE' ? 'reactivated' : 'deactivated'}.`)
    startTransition(() => router.refresh())
  }

  return (
    <>
      <div className="grid gap-3 md:hidden" data-testid="branch-cards">
        {branches.map((b) => (
          <Card key={b.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/settings/branches/${b.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {b.name}
                </Link>
                <p className="font-mono text-xs text-muted-foreground">{b.code}</p>
              </div>
              <Badge variant={b.status === 'ACTIVE' ? 'success' : 'muted'}>
                {b.status === 'ACTIVE' ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Manager</dt>
              <dd>{b.managerName ?? '—'}</dd>
              <dt className="text-muted-foreground">Users</dt>
              <dd>{b.userCount}</dd>
            </dl>
            {canManage ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full"
                onClick={() => void toggle(b)}
                disabled={pending}
              >
                {b.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
              </Button>
            ) : null}
          </Card>
        ))}
      </div>

      <Card className="hidden overflow-hidden md:block" data-testid="branch-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="hidden lg:table-cell">City</TableHead>
              <TableHead>Manager</TableHead>
              <TableHead>Users</TableHead>
              <TableHead>Status</TableHead>
              {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {branches.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="font-mono text-xs">{b.code}</TableCell>
                <TableCell className="font-medium">
                  <Link
                    href={`/settings/branches/${b.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {b.name}
                  </Link>
                </TableCell>
                <TableCell className="hidden lg:table-cell">{b.city ?? '—'}</TableCell>
                <TableCell>{b.managerName ?? '—'}</TableCell>
                <TableCell>{b.userCount}</TableCell>
                <TableCell>
                  <Badge variant={b.status === 'ACTIVE' ? 'success' : 'muted'}>
                    {b.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                {canManage ? (
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void toggle(b)}
                      disabled={pending}
                    >
                      {b.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  )
}
