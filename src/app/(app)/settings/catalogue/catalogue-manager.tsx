'use client'

import { useState } from 'react'
import { trackingLabel } from '@/lib/tracking'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { FormError } from '@/components/form-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AppSelect } from '@/components/app-select'

type Brand = { id: number; name: string; isActive: boolean; productCount: number }
type Category = Brand & {
  isSerialised: boolean
  identifierType: string
  capturesSerial: boolean
}

/*
 * The three ways a tracked item is identified, as one choice.
 *
 * Underneath, "IMEI and serial" is an IMEI category with a flag - a serial is
 * not a third kind of identifier, it is an extra fact about a handset the
 * IMEI already identifies. But a shop does not think in flags: it thinks
 * "phones, and I want their box serials too". So one list of three.
 */
const TRACKING_OPTIONS = [
  { value: 'IMEI', label: 'IMEI (phones)' },
  { value: 'IMEI_SERIAL', label: 'IMEI and serial number (phones)' },
  { value: 'SERIAL', label: 'Serial number only (laptops, speakers)' },
]

/** The stored pair, as the single value the list above offers. */
function trackingValue(identifierType: string, capturesSerial: boolean): string {
  if (identifierType === 'IMEI' && capturesSerial) return 'IMEI_SERIAL'
  return identifierType === 'SERIAL' ? 'SERIAL' : 'IMEI'
}

/** And back again, for the two columns the server keeps. */
function trackingFields(value: string): { identifierType: string; capturesSerial: boolean } {
  if (value === 'SERIAL') return { identifierType: 'SERIAL', capturesSerial: false }
  return { identifierType: 'IMEI', capturesSerial: value === 'IMEI_SERIAL' }
}

/**
 * Managing the catalogue's two lists.
 *
 * Nothing here deletes. A category is referenced by products and products by
 * invoices already issued, so removing one would break a bill somebody has
 * already been given. Deactivating keeps history readable and takes the entry
 * out of new work, which is what "delete" actually means to a shop.
 */
export function CatalogueManager({
  brands,
  categories,
}: {
  brands: Brand[]
  categories: Category[]
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Catalogue</h1>
        <p className="text-sm text-muted-foreground">
          The brands and categories the product pickers offer. Entries are deactivated, never
          deleted — invoices already issued refer to them.
        </p>
      </div>

      <Tabs defaultValue="brands">
        <TabsList>
          <TabsTrigger value="brands">Brands</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>

        <TabsContent value="brands" className="mt-4 space-y-4">
          <NewBrand />
          <List
            kind="brand"
            rows={brands}
            testId="brand-list"
            describe={(r) => `${r.productCount} product${r.productCount === 1 ? '' : 's'}`}
          />
        </TabsContent>

        <TabsContent value="categories" className="mt-4 space-y-4">
          <NewCategory />
          <List
            kind="category"
            rows={categories}
            testId="category-list"
            describe={(r) => {
              const c = r as Category
              const tracking = trackingLabel(c)
              return `${tracking} · ${c.productCount} product${c.productCount === 1 ? '' : 's'}`
            }}
          />
        </TabsContent>
      </Tabs>

      <p className="text-xs text-muted-foreground">
        <strong>Main types</strong> (NEW, USED, ER, ACT, GLOBAL) are not managed here. A main type
        is not a label: it decides which handsets reach the till, what the invoice prints, how
        GLOBAL carries NEW CUT, and how the dashboards group. A sixth one would carry none of that
        behaviour, so adding one is a code change — and the question to answer first is what it
        would <em>mean</em>.
      </p>
    </div>
  )
}

function List({
  kind,
  rows,
  testId,
  describe,
}: {
  kind: 'brand' | 'category'
  rows: Brand[]
  testId: string
  describe: (row: Brand) => string
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<number | null>(null)
  const [name, setName] = useState('')
  /*
   * How a category tracks its items, while it is being edited.
   *
   * Only meaningful for categories, and only changeable while the category
   * still has no products - the server refuses otherwise, and rightly:
   * whether items carry identifiers decides whether their stock is a count
   * or a row per handset, so flipping it later would reinterpret stock that
   * already exists. The form says so rather than letting someone try and
   * meet a 409.
   */
  const [isSerialised, setIsSerialised] = useState(false)
  const [tracking, setTracking] = useState('IMEI')
  const [error, setError] = useState<string | null>(null)

  async function save(id: number, body: Record<string, unknown>) {
    setError(null)
    const res = await fetch(`/api/${kind === 'brand' ? 'brands' : 'categories'}/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      setError(data.error ?? 'That did not work.')
      return
    }
    setEditing(null)
    toast.success('Saved.')
    router.refresh()
  }

  return (
    <Card>
      <CardContent className="space-y-2 py-3">
        <FormError message={error} />
        <ul className="space-y-1.5" data-testid={testId}>
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              data-testid={`${kind}-row`}
            >
              {editing === r.id ? (
                <div className="w-full space-y-3">
                  <Input
                    className="h-8 max-w-xs"
                    aria-label={`Rename ${r.name}`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />

                  {kind === 'category' ? (
                    <TrackingFields
                      locked={r.productCount > 0}
                      isSerialised={isSerialised}
                      tracking={tracking}
                      onSerialisedChange={setIsSerialised}
                      onTrackingChange={setTracking}
                    />
                  ) : null}

                  <span className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() =>
                        void save(r.id, {
                          name,
                          // A category in use can still gain the serial box:
                          // the server keeps the rest as it was.
                          ...(kind === 'category'
                            ? r.productCount === 0
                              ? { isSerialised, ...trackingFields(tracking) }
                              : { capturesSerial: trackingFields(tracking).capturesSerial }
                            : {}),
                        })
                      }
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </span>
                </div>
              ) : (
                <>
                  <span className="min-w-0">
                    <span className="font-medium">{r.name}</span>
                    {!r.isActive ? (
                      <Badge variant="secondary" className="ml-2">
                        Inactive
                      </Badge>
                    ) : null}
                    <span className="block text-xs text-muted-foreground">{describe(r)}</span>
                  </span>
                  <span className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(r.id)
                        setName(r.name)
                        const c = r as Category
                        setIsSerialised(c.isSerialised ?? false)
                        setTracking(trackingValue(c.identifierType ?? 'IMEI', c.capturesSerial))
                      }}
                    >
                      {kind === 'category' ? 'Edit' : 'Rename'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void save(r.id, { isActive: !r.isActive })}
                    >
                      {r.isActive ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function NewBrand() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError(null)
    if (!name.trim()) return setError('Give the brand a name.')
    setBusy(true)
    const res = await fetch('/api/brands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      return setError(data.error ?? 'Could not add it.')
    }
    setName('')
    toast.success('Brand added.')
    router.refresh()
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Add a brand</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-2">
        <FormError message={error} />
        <div className="space-y-1.5">
          <Label htmlFor="brand-name">Name</Label>
          <Input id="brand-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Button disabled={busy} onClick={() => void submit()}>
          {busy ? 'Adding…' : 'Add brand'}
        </Button>
      </CardContent>
    </Card>
  )
}

/**
 * How a category tracks its items.
 *
 * The same pair of controls the add form uses, so the two cannot describe the
 * same decision differently. On an existing category they are read-only once
 * it has products: whether items carry identifiers decides whether their
 * stock is a count or a row per handset, and flipping that afterwards would
 * reinterpret stock that already exists. The server refuses it; this says why
 * before anyone tries.
 */
function TrackingFields({
  locked,
  isSerialised,
  tracking,
  onSerialisedChange,
  onTrackingChange,
}: {
  locked: boolean
  isSerialised: boolean
  tracking: string
  onSerialisedChange: (value: boolean) => void
  onTrackingChange: (value: string) => void
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={isSerialised}
          disabled={locked}
          onCheckedChange={(c) => onSerialisedChange(c === true)}
          aria-label="Tracked individually"
        />
        Tracked individually
      </label>
      {isSerialised ? (
        <div className="space-y-1.5">
          <Label htmlFor="edit-identifier-type" className="text-xs">
            Identified by
          </Label>
          <AppSelect
            id="edit-identifier-type"
            label="Identified by"
            // Not locked with the rest: adding the serial box does not
            // reinterpret anything, so a shop can decide it wants them later.
            disabled={locked && tracking !== 'IMEI' && tracking !== 'IMEI_SERIAL'}
            className="w-72"
            value={tracking}
            onValueChange={onTrackingChange}
            options={TRACKING_OPTIONS.map((o) => ({
              ...o,
              // Moving between IMEI and serial IS a tracking change.
              disabled:
                locked && o.value !== 'IMEI' && o.value !== 'IMEI_SERIAL',
            }))}
          />
        </div>
      ) : null}
      {locked ? (
        <p className="w-full text-xs text-muted-foreground">
          This category already has products, so whether items are tracked individually and
          whether they carry an IMEI or a serial are fixed — their stock is recorded that way.
          Asking for the serial alongside the IMEI can still be turned on: it adds a box to the
          purchase form and leaves existing handsets alone.
        </p>
      ) : null}
    </div>
  )
}

function NewCategory() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [isSerialised, setIsSerialised] = useState(false)
  const [tracking, setTracking] = useState('IMEI')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError(null)
    if (!name.trim()) return setError('Give the category a name.')
    setBusy(true)
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, isSerialised, ...trackingFields(tracking) }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      return setError(data.error ?? 'Could not add it.')
    }
    setName('')
    toast.success('Category added.')
    router.refresh()
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Add a category</CardTitle>
        <CardDescription>
          How its items are tracked is fixed once the category has products — it decides whether
          they carry identifiers at all.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <FormError message={error} />
        <div className="space-y-1.5">
          <Label htmlFor="category-name">Name</Label>
          <Input id="category-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <Checkbox
            checked={isSerialised}
            onCheckedChange={(c) => setIsSerialised(c === true)}
            aria-label="Tracked individually"
          />
          Tracked individually
        </label>
        {isSerialised ? (
          <div className="space-y-1.5">
            <Label htmlFor="identifier-type">Identified by</Label>
            <AppSelect
              id="identifier-type"
              label="Identified by"
              className="w-72"
              value={tracking}
              onValueChange={setTracking}
              options={TRACKING_OPTIONS}
            />
          </div>
        ) : null}
        <Button disabled={busy} onClick={() => void submit()}>
          {busy ? 'Adding…' : 'Add category'}
        </Button>
      </CardContent>
    </Card>
  )
}
