'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ClientPagination } from '@/components/pagination-client'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export type PartyRow = {
  id: number
  name: string
  company?: string | null
  phone: string | null
  email: string | null
  city: string | null
  gstin: string | null
  status: 'ACTIVE' | 'INACTIVE'
}

export function PartyList({
  kind,
  rows,
  total,
  page,
  pageSize,
  canManage,
  search,
  includeInactive,
}: {
  kind: 'customer' | 'supplier'
  rows: PartyRow[]
  total: number
  page: number
  pageSize: number
  canManage: boolean
  search: string
  includeInactive: boolean
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [term, setTerm] = useState(search)
  const [pending, startTransition] = useTransition()
  const plural = `${kind}s`
  const label = kind === 'customer' ? 'Customer' : 'Supplier'

  function apply(next: Record<string, string | null>) {
    const q = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === '') q.delete(k)
      else q.set(k, v)
    }
    q.delete('page')
    startTransition(() => router.push(`/${plural}?${q.toString()}`))
  }

  async function toggleStatus(row: PartyRow) {
    const status = row.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    const res = await fetch(`/api/${plural}/${row.id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      toast.error(data.error ?? 'Could not update.')
      return
    }
    toast.success(`${row.name} ${status === 'ACTIVE' ? 'reactivated' : 'deactivated'}.`)
    startTransition(() => router.refresh())
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">{label}s</h1>
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString('en-IN')} {total === 1 ? label.toLowerCase() : plural}, shared
            across every branch.
          </p>
        </div>
        {canManage ? (
          <Button asChild size="sm" className="shrink-0">
            <Link href={`/${plural}/new`}>Add {kind}</Link>
          </Button>
        ) : null}
      </div>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          apply({ search: term })
        }}
      >
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Name, phone, email or GST"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            aria-label={`Search ${plural}`}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          Search
        </Button>
        <Button
          type="button"
          variant={includeInactive ? 'default' : 'outline'}
          onClick={() => apply({ includeInactive: includeInactive ? null : '1' })}
        >
          {includeInactive ? 'Hiding none' : 'Show inactive'}
        </Button>
      </form>

      {rows.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          {search ? `No ${plural} match “${search}”.` : `No ${plural} yet.`}
        </Card>
      ) : (
        <>
          {/* Phones get cards; the table is unreadable below md. */}
          <div className="grid gap-3 md:hidden" data-testid={`${kind}-cards`}>
            {rows.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/${plural}/${r.id}`} className="truncate font-medium underline-offset-4 hover:underline">
                      {r.name}
                    </Link>
                    {r.company ? (
                      <p className="truncate text-sm text-muted-foreground">{r.company}</p>
                    ) : null}
                  </div>
                  {r.status === 'INACTIVE' ? <Badge variant="muted">Inactive</Badge> : null}
                </div>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  {r.phone ? (
                    <>
                      <dt className="text-muted-foreground">Phone</dt>
                      <dd>{r.phone}</dd>
                    </>
                  ) : null}
                  {r.email ? (
                    <>
                      <dt className="text-muted-foreground">Email</dt>
                      <dd className="truncate">{r.email}</dd>
                    </>
                  ) : null}
                  {r.city ? (
                    <>
                      <dt className="text-muted-foreground">City</dt>
                      <dd>{r.city}</dd>
                    </>
                  ) : null}
                </dl>
              </Card>
            ))}
          </div>

          <Card className="hidden overflow-hidden md:block" data-testid={`${kind}-table`}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  {kind === 'supplier' ? <TableHead>Company</TableHead> : null}
                  <TableHead>Phone</TableHead>
                  <TableHead className="hidden lg:table-cell">Email</TableHead>
                  <TableHead className="hidden xl:table-cell">City</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      <Link href={`/${plural}/${r.id}`} className="underline-offset-4 hover:underline">
                        {r.name}
                      </Link>
                    </TableCell>
                    {kind === 'supplier' ? (
                      <TableCell className="text-muted-foreground">{r.company ?? '—'}</TableCell>
                    ) : null}
                    <TableCell>{r.phone ?? '—'}</TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">
                      {r.email ?? '—'}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">{r.city ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === 'ACTIVE' ? 'success' : 'muted'}>
                        {r.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    {canManage ? (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void toggleStatus(r)}
                          disabled={pending}
                        >
                          {r.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      <ClientPagination
        basePath={`/${plural}`}
        page={page}
        pageSize={pageSize}
        total={total}
        noun={plural}
      />
    </div>
  )
}
