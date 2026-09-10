'use client'

import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PartyPicker } from '@/components/party-picker'
import { NewPartyDialog, splitTypedTerm } from '@/components/new-party-dialog'

export type BillCustomer = { id: number; name: string; phone: string | null }

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

      <NewPartyDialog
        kind="customer"
        open={open}
        prefill={prefill}
        onOpenChange={setOpen}
        onCreated={(c) => onSelect(c.id, c.name)}
        submitLabel="Add to bill"
        successMessage={(name) => `${name} added to this bill.`}
      />
    </Card>
  )
}
