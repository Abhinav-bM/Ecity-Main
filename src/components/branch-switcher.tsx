'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function BranchSwitcher({
  branches,
  activeBranchId,
  canViewAll,
}: {
  branches: { id: number; code: string; name: string }[]
  activeBranchId: number | null
  canViewAll: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const active = branches.find((b) => b.id === activeBranchId)
  const label = active ? active.name : canViewAll ? 'All branches' : 'No branch'
  const shortLabel = active ? active.code : canViewAll ? 'All' : '—'

  async function select(branchId: number | null) {
    const res = await fetch('/api/session/branch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ branchId }),
    })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      toast.error(data.error ?? 'Could not switch branch.')
      return
    }
    startTransition(() => router.refresh())
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          className="gap-1.5 px-2 sm:gap-2 sm:px-3"
          aria-label={`Active branch: ${label}. Change branch`}
        >
          <Building2 className="size-4 shrink-0 text-muted-foreground" />
          {/* Code only on a phone; full name once there is room. */}
          <span className="font-mono text-xs sm:hidden">{shortLabel}</span>
          <span className="hidden max-w-[12rem] truncate sm:inline">{label}</span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 sm:align-start">
        <DropdownMenuLabel>Working in</DropdownMenuLabel>
        {canViewAll ? (
          <>
            <DropdownMenuItem onSelect={() => void select(null)}>
              All branches (consolidated)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {branches.length === 0 ? (
          <DropdownMenuItem disabled>No branches assigned</DropdownMenuItem>
        ) : (
          branches.map((b) => (
            <DropdownMenuItem key={b.id} onSelect={() => void select(b.id)} className="gap-2">
              <span className="font-mono text-xs text-muted-foreground">{b.code}</span>
              <span className="truncate">{b.name}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
