'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Paperclip, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { apiFetch } from '@/lib/api'

export type AttachmentRow = {
  id: number
  fileName: string
  contentType: string
  sizeBytes: number
  url: string
}

/**
 * Files against any record (PRD FR-5.13). Served through short-lived signed
 * URLs, never a public bucket.
 */
export function Attachments({
  entityType,
  entityId,
  rows,
  canManage,
  description,
}: {
  entityType: string
  entityId: number
  rows: AttachmentRow[]
  canManage: boolean
  description?: string
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [, startTransition] = useTransition()

  async function upload(file: File) {
    setBusy(true)
    const body = new FormData()
    body.append('file', file)
    body.append('entityType', entityType)
    body.append('entityId', String(entityId))
    const res = await apiFetch('/api/attachments', { method: 'POST', body })
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('File attached.')
    startTransition(() => router.refresh())
  }

  async function remove(id: number) {
    setBusy(true)
    const res = await apiFetch(`/api/attachments/${id}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    startTransition(() => router.refresh())
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Attachments</CardTitle>
        <CardDescription>
          {description ?? 'Bills, photos and PDFs. Images or PDF, up to 5 MB.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing attached yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {rows.map((a) => (
              <li key={a.id} className="flex items-center gap-3 p-3 text-sm">
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate underline-offset-4 hover:underline"
                >
                  {a.fileName}
                </a>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {Math.max(1, Math.ceil(a.sizeBytes / 1024))} KB
                </span>
                {canManage ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={`Remove ${a.fileName}`}
                    onClick={() => void remove(a.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canManage ? (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="image/*,application/pdf"
              className="sr-only"
              aria-label="Attachment file"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void upload(file)
                e.target.value = ''
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              <Paperclip className="size-4" />
              {busy ? 'Uploading…' : 'Attach a file'}
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
