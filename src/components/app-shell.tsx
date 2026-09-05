'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Boxes,
  Building2,
  LayoutDashboard,
  Menu,
  ScrollText,
  Settings,
  ShieldCheck,
  Smartphone,
  Truck,
  UserRound,
  Users,
} from 'lucide-react'
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

type NavGroup = { heading?: string; items: NavItem[] }

const NAV: NavGroup[] = [
  {
    items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    heading: 'Inventory',
    items: [
      { href: '/devices', label: 'Devices', icon: Smartphone, permission: 'inventory.view' },
      { href: '/products', label: 'Products', icon: Boxes, permission: 'product.view' },
    ],
  },
  {
    heading: 'Master data',
    items: [
      { href: '/customers', label: 'Customers', icon: UserRound, permission: 'customer.view' },
      { href: '/suppliers', label: 'Suppliers', icon: Truck, permission: 'supplier.view' },
    ],
  },
  {
    heading: 'Settings',
    items: [
      { href: '/settings/business', label: 'Business', icon: Settings, permission: 'business.view' },
      {
        href: '/settings/branches',
        label: 'Branches',
        icon: Building2,
        // branch.view exists so the header switcher works for everyone.
        // Reaching the settings screen needs the management permission.
        permission: 'branch.manage',
      },
      { href: '/settings/users', label: 'Users', icon: Users, permission: 'user.view' },
      { href: '/settings/roles', label: 'Roles', icon: ShieldCheck, permission: 'role.view' },
      { href: '/settings/audit', label: 'Audit log', icon: ScrollText, permission: 'audit.view' },
    ],
  },
]

export type ShellUser = {
  name: string
  email: string
  permissions: string[]
  canViewAllBranches: boolean
}

function NavLinks({
  groups,
  pathname,
  onNavigate,
}: {
  groups: NavGroup[]
  pathname: string
  onNavigate?: () => void
}) {
  return (
    <nav className="space-y-4" aria-label="Main">
      {groups.map((group, i) => (
        <div key={group.heading ?? i} className="space-y-1">
          {group.heading ? (
            <p className="px-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {group.heading}
            </p>
          ) : null}
          {group.items.map((item) => {
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
        </div>
      ))}
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
  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.permission || permitted.has(i.permission)),
  })).filter((g) => g.items.length > 0)

  const footnote = (
    <p className="text-[11px] leading-relaxed text-muted-foreground">
      Modules M0–M2 complete.
      <br />
      Purchases, billing and reporting arrive in M3 onward.
    </p>
  )

  return (
    <div className="flex min-h-screen">
      {/*
        Desktop sidebar. Hidden below md, where the Sheet takes over.

        `sticky top-0 h-screen self-start` is what pins it. Without them the
        aside is a stretched flex child as tall as the whole document, so it
        scrolls away with the page and its own overflow-y never engages.
        `self-start` stops flex stretching from overriding the height.
      */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col self-start border-r bg-sidebar md:flex">
        <div className="flex h-14 items-center border-b px-4">
          <span className="font-semibold tracking-tight text-primary">ECITY</span>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <NavLinks groups={groups} pathname={pathname} />
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
                  groups={groups}
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
