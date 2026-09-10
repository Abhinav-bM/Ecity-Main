'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AppSelect } from '@/components/app-select'
import { apiFetch } from '@/lib/api'

type Named = { id: number; name: string }

/** Adding an account, moving money between two, and confirming a statement. */
export function AccountActions({ accounts, branches }: { accounts: Named[]; branches: Named[] }) {
  const [open, setOpen] = useState<'new' | 'transfer' | 'reconcile' | null>(null)

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => setOpen('new')}>
        Add account
      </Button>
      <Button size="sm" variant="outline" disabled={accounts.length < 2} onClick={() => setOpen('transfer')}>
        Transfer
      </Button>
      <Button size="sm" variant="outline" disabled={accounts.length === 0} onClick={() => setOpen('reconcile')}>
        Reconcile
      </Button>

      <NewAccountDialog
        open={open === 'new'}
        onOpenChange={(v) => setOpen(v ? 'new' : null)}
        branches={branches}
      />
      <TransferDialog
        open={open === 'transfer'}
        onOpenChange={(v) => setOpen(v ? 'transfer' : null)}
        accounts={accounts}
      />
      <ReconcileDialog
        open={open === 'reconcile'}
        onOpenChange={(v) => setOpen(v ? 'reconcile' : null)}
        accounts={accounts}
      />
    </div>
  )
}

const TYPES = ['BANK', 'UPI', 'CARD', 'WALLET', 'OTHER'] as const

function NewAccountDialog({
  open,
  onOpenChange,
  branches,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  branches: Named[]
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [type, setType] = useState<string>('BANK')
  const [branchId, setBranchId] = useState('')
  const [bankName, setBankName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [opening, setOpening] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError(null)
    if (!name.trim()) return setError('Give the account a name.')
    setBusy(true)
    const res = await apiFetch('/api/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        type,
        branchId: branchId ? Number(branchId) : null,
        bankName,
        accountNumber,
        openingBalance: Number(opening) || 0,
      }),
    })
    setBusy(false)
    if (!res.ok) {
      return setError(res.error)
    }
    onOpenChange(false)
    setName('')
    setOpening('')
    toast.success('Account added.')
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an account</DialogTitle>
          <DialogDescription>
            The opening balance is the starting point every later figure is built on, so it cannot
            be edited afterwards — a real difference is corrected with a visible adjustment.
          </DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="acc-name">Name</Label>
            <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc-type">Type</Label>
            <AppSelect
              id="acc-type"
              label="Type"
              value={type}
              onValueChange={setType}
              options={TYPES.map((t) => ({ value: t, label: t }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc-branch">Branch</Label>
            <AppSelect
              id="acc-branch"
              label="Branch"
              allowEmpty
              emptyLabel="All branches"
              placeholder="All branches"
              value={branchId}
              onValueChange={setBranchId}
              options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc-bank">Bank</Label>
            <Input id="acc-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc-number">Account number</Label>
            <Input
              id="acc-number"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc-opening">Opening balance (₹)</Label>
            <Input
              id="acc-opening"
              inputMode="decimal"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? 'Saving…' : 'Add account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TransferDialog({
  open,
  onOpenChange,
  accounts,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  accounts: Named[]
}) {
  const router = useRouter()
  const [from, setFrom] = useState(String(accounts[0]?.id ?? ''))
  const [to, setTo] = useState(String(accounts[1]?.id ?? ''))
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError(null)
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) return setError('Enter an amount.')
    setBusy(true)
    const res = await apiFetch('/api/accounts/transfer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fromAccountId: Number(from),
        toAccountId: Number(to),
        amount: value,
        note,
      }),
    })
    setBusy(false)
    if (!res.ok) {
      return setError(res.error)
    }
    onOpenChange(false)
    setAmount('')
    toast.success('Transfer recorded.')
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move money between accounts</DialogTitle>
          <DialogDescription>
            Both sides are written together, so a transfer can never leave one account without
            reaching the other.
          </DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="tr-from">From</Label>
            <AppSelect
              id="tr-from"
              label="From"
              value={from}
              onValueChange={setFrom}
              options={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tr-to">To</Label>
            <AppSelect
              id="tr-to"
              label="To"
              value={to}
              onValueChange={setTo}
              options={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tr-amount">Amount (₹)</Label>
            <Input
              id="tr-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tr-note">Note</Label>
            <Input id="tr-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? 'Saving…' : 'Transfer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReconcileDialog({
  open,
  onOpenChange,
  accounts,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  accounts: Named[]
}) {
  const router = useRouter()
  const [accountId, setAccountId] = useState(String(accounts[0]?.id ?? ''))
  const [balance, setBalance] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError(null)
    const value = Number(balance)
    if (!Number.isFinite(value)) return setError('Enter the statement balance.')
    setBusy(true)
    const res = await apiFetch(`/api/accounts/${accountId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'reconcile', statementBalance: value }),
    })
    setBusy(false)
    if (!res.ok) {
      return setError(res.error)
    }
    onOpenChange(false)
    setBalance('')
    toast.success('Statement balance recorded.')
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm a statement balance</DialogTitle>
          <DialogDescription>
            This records what the statement says and when you checked. It does not move any money:
            if the two disagree, that difference is real and wants an explanation.
          </DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rec-account">Account</Label>
            <AppSelect
              id="rec-account"
              label="Account"
              value={accountId}
              onValueChange={setAccountId}
              options={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rec-balance">Statement balance (₹)</Label>
            <Input
              id="rec-balance"
              inputMode="decimal"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? 'Saving…' : 'Record balance'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
