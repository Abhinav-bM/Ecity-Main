'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FormError } from '@/components/form-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { PickedParty } from '@/components/party-picker'
import { apiFetch } from '@/lib/api'

/**
 * What was typed into the search box, sorted into the right field.
 *
 * At a counter the search is nearly always a phone number, and putting it in
 * the name box would leave someone to cut and paste it across. Six digits is
 * the line: shorter than that and it is likelier a name than a number.
 */
export function splitTypedTerm(term: string): { name: string; phone: string } {
  const digits = term.replace(/\D/g, '')
  const looksLikeNumber = digits.length >= 6 && /^[\d\s+()-]+$/.test(term)
  return looksLikeNumber ? { name: '', phone: term.trim() } : { name: term.trim(), phone: '' }
}

/**
 * Add a customer or a supplier without leaving the form that needed them.
 *
 * A new customer buying on credit, or a delivery from a supplier nobody has
 * bought from before: both turn up mid-form, and sending the person away to
 * another screen abandons half-built work with someone standing there
 * (PRD FR-6.6). One dialog for both, so the two cannot drift apart.
 */
export function NewPartyDialog({
  kind,
  open,
  onOpenChange,
  prefill = { name: '', phone: '' },
  onCreated,
  successMessage,
  submitLabel = 'Create and use',
}: {
  kind: 'customer' | 'supplier'
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What the search was for, when it found nobody. */
  prefill?: { name: string; phone: string }
  onCreated: (party: PickedParty) => void
  /** Defaults to naming the party; the bill says "added to this bill". */
  successMessage?: (name: string) => string
  /** The counter says "Add to bill", which is what it is actually doing. */
  submitLabel?: string
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
    const res = await apiFetch(`/api/${kind}s`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, phone }),
    })
    setBusy(false)
    if (!res.ok) {
      // Duplicate phone is the common one, and the message names who has it.
      setError(res.error)
      return
    }
    const { id } = (res.data) as { id: number }
    const created = { id, name: name.trim(), phone: phone.trim() || null }
    onCreated(created)
    toast.success(successMessage?.(created.name) ?? `${created.name} added.`)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New {kind}</DialogTitle>
          <DialogDescription>
            Just a name and phone for now — the full profile can be filled in later.
          </DialogDescription>
        </DialogHeader>

        <FormError message={error} />

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`new-${kind}-name`}>Name</Label>
            <Input
              id={`new-${kind}-name`}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`new-${kind}-phone`}>Phone</Label>
            <Input
              id={`new-${kind}-phone`}
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
            {busy ? 'Saving…' : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
