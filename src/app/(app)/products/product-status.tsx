'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'

/**
 * Retire a product from the catalogue, or bring it back.
 *
 * Deliberately not a delete. A product that has been bought or sold is
 * referred to by that purchase, that bill and every stock movement between
 * them; removing the row would leave all of them pointing at nothing. Marking
 * it inactive takes it out of the pickers and the till while every record that
 * mentions it still reads correctly — and it is reversible, which a delete is
 * not, so this asks for no confirmation.
 */
export function ProductStatusButton({
  id,
  name,
  isActive,
}: {
  id: number
  name: string
  isActive: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [, startTransition] = useTransition()

  async function toggle() {
    setBusy(true)
    const res = await apiFetch(`/api/products/${id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isActive: !isActive }),
    })
    setBusy(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(`${name} ${isActive ? 'deactivated' : 'reactivated'}.`)
    startTransition(() => router.refresh())
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={() => void toggle()}
      /* Named, because a row of identical "Deactivate" buttons tells a screen
         reader nothing about which product it is on. */
      aria-label={`${isActive ? 'Deactivate' : 'Reactivate'} ${name}`}
    >
      {busy ? '…' : isActive ? 'Deactivate' : 'Reactivate'}
    </Button>
  )
}
