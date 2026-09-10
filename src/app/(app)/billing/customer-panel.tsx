'use client'

import { useEffect, useState } from 'react'
import { UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { FormError } from '@/components/form-error'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PartyPicker } from '@/components/party-picker'
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

export type BillCustomer = { id: number; name: string; phone: string | null }

/*
 * What was typed into the search box, sorted into the right field.
 *
 * At a counter the search is nearly always a phone number, and putting it in
 * the name box would leave someone to cut and paste it across. Six digits is
 * the line: shorter than that and it is likelier a name than a number.
 */
function splitTypedTerm(term: string): { name: string; phone: string } {
  const digits = term.replace(/\D/g, '')
  const looksLikeNumber = digits.length >= 6 && /^[\d\s+()-]+$/.test(term)
  return looksLikeNumber ? { name: '', phone: term.trim() } : { name: term.trim(), phone: '' }
}

/**
 * Attach a customer to the bill, or create one without leaving it.
 *
 * A new customer buying on credit is common at a counter, and sending the
 * salesperson away to the customers screen would abandon a half-built bill
 * with someone standing there (PRD FR-6.6).
 */
export function CustomerPanel({
  canCreate,
  selectedId,
  selectedName,
  onSelect,
}: {
  /** customer.manage. Without it the create call would only 403. */
  canCreate: boolean
  selectedId: number | null
  /**
   * Carried alongside the id rather than looked up in a prefetched list: the
   * attached customer may have been created moments ago, or sit beyond any
   * page of results, and the box must still show their name after a reload.
   */
  selectedName: string | null
  onSelect: (id: number | null, name: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  // Seeded from whatever the search found nothing for.
  const [prefill, setPrefill] = useState({ name: '', phone: '' })

  function openBlank() {
    setPrefill({ name: '', phone: '' })
    setOpen(true)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="text-sm">Customer</CardTitle>
        {canCreate ? (
          <Button variant="ghost" size="sm" onClick={openBlank}>
            <UserPlus className="size-4" />
            New
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        <PartyPicker
          kind="customer"
          label="Customer"
          allowNone
          noneLabel="Walk-in (no record)"
          placeholder="Walk-in (no record)"
          value={selectedId ? { id: selectedId, name: selectedName ?? '', phone: null } : null}
          onSelect={(c) => onSelect(c?.id ?? null, c?.name ?? null)}
          onCreateNew={
            canCreate
              ? (query) => {
                  setPrefill(splitTypedTerm(query))
                  setOpen(true)
                }
              : undefined
          }
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Needed for credit, warranty and returns.
        </p>
      </CardContent>

      <NewCustomerDialog
        open={open}
        prefill={prefill}
        onOpenChange={setOpen}
        onCreated={(c) => onSelect(c.id, c.name)}
      />
    </Card>
  )
}

function NewCustomerDialog({
  open,
  prefill,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  /** What the search was for, when it found nobody. */
  prefill: { name: string; phone: string }
  onOpenChange: (open: boolean) => void
  onCreated: (customer: BillCustomer) => void
}) {
  const [name, setName] = useState(prefill.name)
  const [phone, setPhone] = useState(prefill.phone)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Each opening starts from what was typed this time, not last time.
  useEffect(() => {
    if (!open) return
    setName(prefill.name)
    setPhone(prefill.phone)
    setError(null)
  }, [open, prefill])

  async function create() {
    setError(null)
    setBusy(true)
    const res = await fetch('/api/customers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, phone }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      // Duplicate phone is the common one, and the message names who has it.
      setError(data.error ?? 'Could not create the customer.')
      return
    }
    const { id } = (await res.json()) as { id: number }
    onCreated({ id, name: name.trim(), phone: phone.trim() || null })
    toast.success(`${name.trim()} added to this bill.`)
    setName('')
    setPhone('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New customer</DialogTitle>
          <DialogDescription>
            Just a name and phone for now — the full profile can be filled in later.
          </DialogDescription>
        </DialogHeader>

        <FormError message={error} />

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-customer-name">Name</Label>
            <Input
              id="new-customer-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-customer-phone">Phone</Label>
            <Input
              id="new-customer-phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim().length >= 2) void create()
              }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || name.trim().length < 2} onClick={() => void create()}>
            {busy ? 'Saving…' : 'Add to bill'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
