'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Menu, ScrollText, ShieldCheck, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PermissionCode } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { BranchSwitcher } from './branch-switcher'
import { UserMenu } from './user-menu'

type NavItem = {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  permission?: PermissionCode
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/settings/users', label: 'Users', icon: Users, permission: 'user.view' },
  { href: '/settings/roles', label: 'Roles', icon: ShieldCheck, permission: 'role.view' },
  { href: '/settings/audit', label: 'Audit log', icon: ScrollText, permission: 'audit.view' },
]

export type ShellUser = {
  name: string
  email: string
  permissions: string[]
  canViewAllBranches: boolean
}

function NavLinks({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[]
  pathname: string
  onNavigate?: () => void
}) {
  return (
    <nav className="space-y-1" aria-label="Main">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors md:py-2',
              active
                ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            )}
          >
            <item.icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

export function AppShell({
  user,
  branches,
  activeBranchId,
  children,
}: {
  user: ShellUser
  branches: { id: number; code: string; name: string }[]
  activeBranchId: number | null
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const permitted = new Set(user.permissions)
  const items = NAV.filter((i) => !i.permission || permitted.has(i.permission))

  const footnote = (
    <p className="text-[11px] leading-relaxed text-muted-foreground">
      Module M0 — Foundations.
      <br />
      Inventory, billing and reporting arrive in M2 onward.
    </p>
  )

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar. Hidden below md, where the Sheet takes over. */}
      <aside className="hidden w-56 shrink-0 flex-col border-r bg-sidebar md:flex">
        <div className="flex h-14 items-center border-b px-4">
          <span className="font-semibold tracking-tight text-primary">ECITY</span>
        </div>
        <div className="flex-1 p-2">
          <NavLinks items={items} pathname={pathname} />
        </div>
        <div className="p-3">{footnote}</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-4">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label="Open navigation menu"
              >
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[17rem] bg-sidebar p-0">
              <SheetHeader className="border-b px-4 py-3.5 text-left">
                <SheetTitle className="text-primary">ECITY</SheetTitle>
              </SheetHeader>
              <div className="p-2">
                <NavLinks
                  items={items}
                  pathname={pathname}
                  onNavigate={() => setMobileNavOpen(false)}
                />
              </div>
              <div className="mt-auto p-3">{footnote}</div>
            </SheetContent>
          </Sheet>

          <span className="font-semibold tracking-tight text-primary md:hidden">ECITY</span>

          <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
            <BranchSwitcher
              branches={branches}
              activeBranchId={activeBranchId}
              canViewAll={user.canViewAllBranches}
            />
            <UserMenu name={user.name} email={user.email} />
          </div>
        </header>

        <main className="min-w-0 flex-1 p-3 sm:p-4 lg:p-6">{children}</main>
      </div>
    </div>
  )
}
