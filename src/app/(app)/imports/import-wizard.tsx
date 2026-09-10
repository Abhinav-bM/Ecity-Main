'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { FormError } from '@/components/form-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AppSelect } from '@/components/app-select'

const KINDS = [
  { value: 'PRODUCTS', label: 'Products', needsBranch: false },
  { value: 'DEVICES', label: 'Handsets (by IMEI)', needsBranch: true },
  { value: 'CUSTOMERS', label: 'Customers', needsBranch: false },
  { value: 'SUPPLIERS', label: 'Suppliers', needsBranch: false },
  { value: 'OPENING_STOCK', label: 'Opening stock (accessories)', needsBranch: true },
  { value: 'OPENING_CUSTOMER_DUES', label: 'Opening customer dues', needsBranch: false },
  { value: 'OPENING_SUPPLIER_DUES', label: 'Opening supplier dues', needsBranch: false },
] as const

type Staged = {
  id: number
  headers: string[]
  suggested: Record<string, string>
  rows: number
}

type Row = {
  rowNumber: number
  error: string | null
  raw: Record<string, string>
}

/**
 * Upload → map → check → import (PRD FR-33.1).
 *
 * Each step is server-backed: the file is staged in the database on upload,
 * so a browser that dies between mapping and committing loses nothing, and
 * the preview is of rows that really exist rather than of a guess held in a
 * tab.
 */
export function ImportWizard({
  branches,
  defaultKind = 'PRODUCTS',
}: {
  branches: { id: number; name: string }[]
  /** So the opening-balances screen can send someone straight to the right one. */
  defaultKind?: string
}) {
  const router = useRouter()
  const [kind, setKind] = useState<string>(
    KINDS.some((k) => k.value === defaultKind) ? defaultKind : 'PRODUCTS',
  )
  const [branchId, setBranchId] = useState(String(branches[0]?.id ?? ''))
  const [staged, setStaged] = useState<Staged | null>(null)
  const [columnMap, setColumnMap] = useState<Record<string, string>>({})
  const [fields, setFields] = useState<{ required: string[]; optional: string[] } | null>(null)
  const [checked, setChecked] = useState<{ valid: number; errors: number } | null>(null)
  const [preview, setPreview] = useState<Row[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const needsBranch = KINDS.find((k) => k.value === kind)?.needsBranch ?? false

  function reset() {
    setStaged(null)
    setColumnMap({})
    setChecked(null)
    setPreview([])
    setError(null)
  }

  async function upload(file: File) {
    setError(null)
    setBusy(true)
    /*
     * A spreadsheet is bytes, not text, so it goes base64. Done in chunks
     * because spreading a megabyte-long array into String.fromCharCode blows
     * the call stack - on the file that matters most, the big one.
     */
    const isWorkbook = /\.xlsx$/i.test(file.name)
    let content: string
    if (isWorkbook) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
      }
      content = btoa(binary)
    } else {
      content = await file.text()
    }

    const res = await fetch('/api/imports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind,
        fileName: file.name,
        content,
        encoding: isWorkbook ? 'base64' : 'text',
        branchId: needsBranch ? Number(branchId) : null,
      }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      return setError(data.error ?? 'That file could not be read.')
    }
    const data = (await res.json()) as Staged & {
      fields?: { required: string[]; optional: string[] }
    }
    setStaged(data)
    setColumnMap(data.suggested)
    setFields(FIELDS[kind] ?? null)
    setChecked(null)
  }

  async function check() {
    if (!staged) return
    setError(null)
    setBusy(true)
    const res = await fetch(`/api/imports/${staged.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'validate', columnMap }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      return setError(data.error ?? 'That did not check out.')
    }
    setChecked((await res.json()) as { valid: number; errors: number })

    const rows = await fetch(`/api/imports/${staged.id}?errorsOnly=true`)
    if (rows.ok) {
      const data = (await rows.json()) as { rows: Row[] }
      setPreview(data.rows.slice(0, 20))
    }
  }

  async function commit() {
    if (!staged) return
    setError(null)
    setBusy(true)
    const res = await fetch(`/api/imports/${staged.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'commit' }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      return setError(data.error ?? 'The import did not finish.')
    }
    const result = (await res.json()) as { committed: number; failed: number }
    toast.success(`Imported ${result.committed} row(s).`)
    reset()
    router.refresh()
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">
          {!staged ? 'Choose a file' : !checked ? 'Match the columns' : 'Check, then import'}
        </CardTitle>
        <CardDescription>
          A CSV, with the column headings on the first row. Export from Excel as CSV.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormError message={error} />

        {!staged ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="kind">What is in the file</Label>
              <AppSelect
                id="kind"
                label="What is in the file"
                value={kind}
                onValueChange={(v) => {
                  setKind(v)
                  reset()
                }}
                options={KINDS.map((k) => ({ value: k.value, label: k.label }))}
              />
            </div>
            {needsBranch ? (
              <div className="space-y-1.5">
                <Label htmlFor="branchId">Into which branch</Label>
                <AppSelect
                  id="branchId"
                  label="Into which branch"
                  value={branchId}
                  onValueChange={setBranchId}
                  options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
                />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="file">File</Label>
              <Input
                id="file"
                type="file"
                accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void upload(file)
                }}
              />
              <p className="text-xs text-muted-foreground">
                A CSV or an .xlsx. Only the first sheet is read — a workbook with
                several is a question about which one.
              </p>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground" data-testid="staged-summary">
              {staged.rows} row(s) read from the file. Nothing has been created yet.
            </p>

            {/*
              Their column on the left, our field on the right. The guess is a
              starting point - a mapping that could not be corrected would be
              worse than none.
            */}
            <div className="grid gap-3 sm:grid-cols-2" data-testid="column-map">
              {fields
                ? [...fields.required, ...fields.optional].map((field) => (
                    <div key={field} className="space-y-1.5">
                      <Label htmlFor={`map-${field}`}>
                        {field}
                        {fields.required.includes(field) ? (
                          <span className="text-destructive"> *</span>
                        ) : null}
                      </Label>
                      <AppSelect
                        id={`map-${field}`}
                        label={field}
                        allowEmpty
                        emptyLabel="Not in this file"
                        placeholder="Not in this file"
                        value={columnMap[field] ?? ''}
                        onValueChange={(v) =>
                          setColumnMap((m) => ({ ...m, [field]: v }))
                        }
                        options={staged.headers.map((h) => ({ value: h, label: h }))}
                      />
                    </div>
                  ))
                : null}
            </div>

            {checked ? (
              <div className="space-y-3" data-testid="check-result">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="success">{checked.valid} ready to import</Badge>
                  {checked.errors > 0 ? (
                    <Badge variant="destructive">{checked.errors} with problems</Badge>
                  ) : null}
                </div>

                {preview.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">
                      These rows will be skipped. Everything else still goes in.
                    </p>
                    <ul className="space-y-1 text-xs">
                      {preview.map((r) => (
                        <li key={r.rowNumber} className="rounded-md border px-2 py-1">
                          <span className="font-mono">Row {r.rowNumber}</span> — {r.error}
                        </li>
                      ))}
                    </ul>
                    <a
                      className="text-xs underline underline-offset-4"
                      href={`/api/imports/${staged.id}/errors?format=csv`}
                    >
                      Download the full list of problems
                    </a>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={reset} disabled={busy}>
                Start again
              </Button>
              <Button onClick={() => void check()} disabled={busy}>
                {busy ? 'Checking…' : 'Check the file'}
              </Button>
              {checked && checked.valid > 0 ? (
                <Button onClick={() => void commit()} disabled={busy}>
                  {busy ? 'Importing…' : `Import ${checked.valid} row(s)`}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** Mirrors IMPORT_FIELDS on the server; the wizard needs it to draw the mapping. */
const FIELDS: Record<string, { required: string[]; optional: string[] }> = {
  PRODUCTS: {
    required: ['name', 'category'],
    optional: ['brand', 'sku', 'barcode', 'hsnCode', 'purchasePrice', 'sellingPrice'],
  },
  DEVICES: {
    required: ['product', 'imei', 'mainType'],
    optional: [
      'imei2',
      'imei3',
      'imei4',
      'isNewCut',
      'variant',
      'storage',
      'colour',
      'batteryHealth',
      'purchasePrice',
      'sellingPrice',
      'receivedAt',
    ],
  },
  CUSTOMERS: {
    required: ['name'],
    optional: ['phone', 'altPhone', 'email', 'gstin', 'city', 'address'],
  },
  SUPPLIERS: {
    required: ['name'],
    optional: ['company', 'phone', 'email', 'gstin', 'city'],
  },
}
