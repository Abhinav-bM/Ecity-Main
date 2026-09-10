'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Alert } from '@/components/ui/alert'
import { AppSelect } from '@/components/app-select'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { PickedProduct } from '@/components/product-picker'
import { apiFetch } from '@/lib/api'

type Category = { id: number; name: string; isSerialised: boolean; identifierType: string }

/**
 * Add a product without leaving the form that needed it.
 *
 * Stock arrives before the catalogue catches up: a delivery is being booked
 * in, one line is for something the shop has never stocked, and the only way
 * on was to abandon a half-typed purchase for the products screen. This asks
 * for the little that cannot be guessed - a name and what kind of thing it
 * is - and leaves the rest of the profile for later.
 */
export function NewProductDialog({
  open,
  onOpenChange,
  prefillName = '',
  onCreated,
  taxRates,
  gstEnabled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Whatever the search found nothing for. */
  prefillName?: string
  onCreated: (product: PickedProduct) => void
  /** Active rates only. Empty is a real state - the shop may have set none up. */
  taxRates: { id: number; name: string }[]
  gstEnabled: boolean
}) {
  const [categories, setCategories] = useState<Category[]>([])
  const [name, setName] = useState(prefillName)
  const [categoryId, setCategoryId] = useState('')
  const [sellingPrice, setSellingPrice] = useState('')
  /*
   * Optional, and deliberately not defaulted.
   *
   * This was briefly made mandatory - the dialog once sent `taxRateId: null`
   * outright, so a product added mid-delivery was saved with no rate and the
   * first bill for it quietly fell back to the shop default. The fix went too
   * far: it forced a buyer with a half-typed delivery on screen to go and set
   * up a 0% rate in Settings before a genuinely untaxed product could be
   * booked in at all. Untaxed is a real answer, and `product.tax_rate_id` is
   * nullable precisely so it can be given.
   *
   * So the choice is offered, "No tax rate" included, and left unset if that
   * is the truth. The product screen shows the same field, so a rate nobody
   * chose is still a rate somebody can go back and correct.
   */
  const [taxRateId, setTaxRateId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(prefillName)
    setSellingPrice('')
    setTaxRateId('')
    setError(null)
    let cancelled = false
    void (async () => {
      const res = await apiFetch('/api/categories')
      if (cancelled || !res.ok) return
      setCategories((res.data) as Category[])
    })()
    return () => {
      cancelled = true
    }
  }, [open, prefillName])

  async function create() {
    setError(null)
    setBusy(true)
    const res = await apiFetch('/api/products', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        categoryId,
        sellingPrice,
        brandId: null,
        // '' is the "No tax rate" row, and must reach the API as null.
        taxRateId: gstEnabled && taxRateId ? taxRateId : null,
      }),
    })
    if (!res.ok) {
      setBusy(false)
      setError(res.error)
      return
    }
    const { id } = (res.data) as { id: number }

    /*
     * The create call answers with an id and nothing else, and the caller
     * needs the whole product - whether it is serialised decides what the
     * purchase line asks for next. So it is read back through the same search
     * the picker uses, which is the one shape every caller already handles.
     */
    const found = await apiFetch(`/api/products/search?q=${encodeURIComponent(name.trim())}`)
    const rows = found.ok ? ((found.data) as PickedProduct[]) : []
    const product = rows.find((p) => p.id === id)
    setBusy(false)

    if (!product) {
      setError('The product was created, but could not be read back. Search for it by name.')
      return
    }
    onCreated(product)
    toast.success(`${product.name} added to the catalogue.`)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New product</DialogTitle>
          <DialogDescription>
            Enough to book it in. Prices, HSN and the rest can be filled in on the product later.
          </DialogDescription>
        </DialogHeader>

        {error ? <Alert variant="destructive">{error}</Alert> : null}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="np-name">Name</Label>
            <Input
              id="np-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="np-category">Category</Label>
            <AppSelect
              id="np-category"
              label="Category"
              value={categoryId}
              onValueChange={setCategoryId}
              placeholder="Choose a category"
              // Labelled exactly as the products screen does: a shop needs to
              // see that "Mobiles" means IMEI-tracked before choosing it.
              options={categories.map((c) => ({
                value: String(c.id),
                label: `${c.name}${c.isSerialised ? ` (${c.identifierType})` : ''}`,
              }))}
            />
            {/* Serialised or not is the category's answer, not a choice here. */}
            <p className="text-xs text-muted-foreground">
              The category decides whether each unit is tracked by IMEI or serial.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="np-price">Selling price (₹)</Label>
            <Input
              id="np-price"
              inputMode="decimal"
              placeholder="Optional"
              value={sellingPrice}
              onChange={(e) => setSellingPrice(e.target.value)}
            />
          </div>
          {gstEnabled ? (
            <div className="space-y-1.5">
              <Label htmlFor="np-tax">Tax rate</Label>
              {taxRates.length === 0 ? (
                <Alert variant="warning">
                  This shop has no tax rates set up, so this product will be saved untaxed. Add
                  them under Settings → Business → Tax, then set the rate on the product.
                </Alert>
              ) : (
                <>
                  <AppSelect
                    id="np-tax"
                    label="Tax rate"
                    value={taxRateId}
                    onValueChange={setTaxRateId}
                    placeholder="No tax rate"
                    allowEmpty
                    emptyLabel="No tax rate"
                    options={taxRates.map((t) => ({ value: String(t.id), label: t.name }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional. Left unset the product is untaxed, and the rate can be set on the
                    product later.
                  </p>
                </>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || name.trim().length < 2 || !categoryId}
            onClick={() => void create()}
          >
            {busy ? 'Saving…' : 'Create and use'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
