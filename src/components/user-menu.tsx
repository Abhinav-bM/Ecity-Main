'use client'

import { useRouter } from 'next/navigation'
import { LogOut, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { apiFetch } from '@/lib/api'

export function UserMenu({ name, email }: { name: string; email: string }) {
  const router = useRouter()

  async function signOut() {
    await apiFetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
    router.refresh()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 px-2 sm:px-3"
          aria-label={`Account menu for ${name}`}
        >
          <UserRound className="size-4 shrink-0" />
          <span className="hidden max-w-[10rem] truncate md:inline">{name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate font-normal">\n          <span className="block font-medium md:hidden">{name}</span>\n          <span className="block truncate text-xs text-muted-foreground">{email}</span>\n        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
