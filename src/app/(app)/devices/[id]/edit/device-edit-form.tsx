'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/form-field'
import { Input } from '@/components/ui/input'
import { AppSelect } from '@/components/app-select'
import { MAIN_TYPES } from '@/lib/validation'
import type { MainType } from '@/server/db/schema'

export type DeviceEditValues = {
  mainType: MainType
  isNewCut: boolean
  newCutNotes: string
  variant: string
  ram: string
  storage: string
  colour: string
  batteryHealthPercent: string
  purchasePrice: string
  sellingPrice: string
  taxRateId: string
  supplierId: string
  warrantyMonths: string
  warrantyProvider: string
  salesChannel: 'ECITY' | 'EXTERNAL' | 'BOTH'
  notes: string
}

/**
 * Correcting a device (M6, raised during M5).
 *
 * The identifiers are shown but not editable. Changing an IMEI is not a
 * correction — it is a different handset — and the uniqueness and history
 * rules exist to stop exactly that.
 */
export function DeviceEditForm({
  deviceId,
  identifiers,
  initial,
  taxRates,
  gstEnabled,
  suppliers,
}: {
  deviceId: number
  identifiers: string[]
  initial: DeviceEditValues
  taxRates: { id: number; name: string }[]
  gstEnabled: boolean
  suppliers: { id: number; name: string }[]
}) {
  const router = useRouter()
  const [v, setV] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof DeviceEditValues>(key: K, value: DeviceEditValues[K]) =>
    setV((prev) => ({ ...prev, [key]: value }))

  async function submit() {
    setError(null)
    if (v.isNewCut && v.mainType !== 'GLOBAL') {
      setError('NEW CUT applies only to a GLOBAL device.')
      return
    }

    setBusy(true)
    const res = await fetch(`/api/devices/${deviceId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(v),
    })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      setError(data.error ?? 'Could not save the changes.')
      return
    }
    toast.success('Device updated.')
    router.push(`/devices/${deviceId}`)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {error ? <Alert variant="destructive">{error}</Alert> : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Classification</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="mainType" label="Main type" required>
            <AppSelect
              id="mainType"
              label="Main type"
              value={v.mainType}
              onValueChange={(x) => set('mainType', x as MainType)}
              options={MAIN_TYPES.map((t) => ({ value: t, label: t }))}
            />
          </Field>

          <Field
            id="salesChannel"
            label="Billed in"
            hint="Which system may sell this handset"
          >
            <AppSelect
              id="salesChannel"
              label="Billed in"
              value={v.salesChannel}
              onValueChange={(x) => set('salesChannel', x as DeviceEditValues['salesChannel'])}
              options={[
                { value: 'ECITY', label: 'ECITY — sold here' },
                { value: 'EXTERNAL', label: 'The other billing system' },
                { value: 'BOTH', label: 'Both systems' },
              ]}
            />
          </Field>

          {v.mainType === 'GLOBAL' ? (
            <>
              <div className="flex items-center gap-2">
                <input
                  id="isNewCut"
                  type="checkbox"
                  className="size-4"
                  checked={v.isNewCut}
                  onChange={(e) => set('isNewCut', e.target.checked)}
                />
                <label htmlFor="isNewCut" className="text-sm">
                  NEW CUT
                </label>
              </div>
              <Field id="newCutNotes" label="NEW CUT notes">
                <Input
                  id="newCutNotes"
                  value={v.newCutNotes}
                  onChange={(e) => set('newCutNotes', e.target.value)}
                />
              </Field>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">The handset</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="variant" label="Variant">
            <Input id="variant" value={v.variant} onChange={(e) => set('variant', e.target.value)} />
          </Field>
          <Field id="ram" label="RAM">
            <Input id="ram" value={v.ram} onChange={(e) => set('ram', e.target.value)} />
          </Field>
          <Field id="storage" label="Storage">
            <Input id="storage" value={v.storage} onChange={(e) => set('storage', e.target.value)} />
          </Field>
          <Field id="colour" label="Colour">
            <Input id="colour" value={v.colour} onChange={(e) => set('colour', e.target.value)} />
          </Field>
          <Field id="batteryHealthPercent" label="Battery health (%)">
            <Input
              id="batteryHealthPercent"
              inputMode="numeric"
              value={v.batteryHealthPercent}
              onChange={(e) => set('batteryHealthPercent', e.target.value)}
            />
          </Field>
          <Field id="warrantyMonths" label="Warranty (months)">
            <Input
              id="warrantyMonths"
              inputMode="numeric"
              value={v.warrantyMonths}
              onChange={(e) => set('warrantyMonths', e.target.value)}
            />
          </Field>
          <Field id="warrantyProvider" label="Warranty by" hint="Who honours it">
            <Input
              id="warrantyProvider"
              value={v.warrantyProvider}
              onChange={(e) => set('warrantyProvider', e.target.value)}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Money and origin</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="purchasePrice" label="Purchase price (₹)">
            <Input
              id="purchasePrice"
              inputMode="decimal"
              value={v.purchasePrice}
              onChange={(e) => set('purchasePrice', e.target.value)}
            />
          </Field>
          <Field id="sellingPrice" label="Selling price (₹)">
            <Input
              id="sellingPrice"
              inputMode="decimal"
              value={v.sellingPrice}
              onChange={(e) => set('sellingPrice', e.target.value)}
            />
          </Field>
          {gstEnabled ? (
            <Field id="taxRateId" label="Tax rate">
              <AppSelect
                id="taxRateId"
                label="Tax rate"
                allowEmpty
                emptyLabel="Use the product default"
                placeholder="Use the product default"
                value={v.taxRateId}
                onValueChange={(x) => set('taxRateId', x)}
                options={taxRates.map((t) => ({ value: String(t.id), label: t.name }))}
              />
            </Field>
          ) : null}
          <Field id="supplierId" label="Supplier">
            <AppSelect
              id="supplierId"
              label="Supplier"
              allowEmpty
              emptyLabel="Not recorded"
              placeholder="Not recorded"
              value={v.supplierId}
              onValueChange={(x) => set('supplierId', x)}
              options={suppliers.map((s) => ({ value: String(s.id), label: s.name }))}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field id="notes" label="Notes">
              <Input id="notes" value={v.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4">
          <p className="text-xs text-muted-foreground">
            Identifiers cannot be changed here: {identifiers.join(', ')}. Changing an IMEI would
            make this a different handset, so register that one separately.
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" asChild className="w-full sm:w-auto">
          <Link href={`/devices/${deviceId}`}>Cancel</Link>
        </Button>
        <Button disabled={busy} onClick={() => void submit()} className="w-full sm:w-auto">
          {busy ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  )
}
