'use client'

import { useRef, useState, useTransition } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { ImageOff, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { apiFetch } from '@/lib/api'

/**
 * A product's picture (PRD FR-4.2). Uploads through the same storage layer and
 * short-lived signed URLs as every other attachment - never a public bucket.
 *
 * Only offered once the product exists, because an attachment needs something
 * to attach to.
 */
export function ProductImage({
  productId,
  imageUrl,
  canManage,
}: {
  productId: number
  imageUrl: string | null
  canManage: boolean
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [, startTransition] = useTransition()

  async function upload(file: File) {
    setBusy(true)
    const body = new FormData()
    body.append('file', file)
    const res = await apiFetch(`/api/products/${productId}/image`, { method: 'POST', body })
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Image updated.')
    startTransition(() => router.refresh())
  }

  async function remove() {
    setBusy(true)
    const res = await apiFetch(`/api/products/${productId}/image`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    startTransition(() => router.refresh())
  }

  return (
    <Card className="mx-auto max-w-3xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Image</CardTitle>
        <CardDescription>
          Shown on the product list and at the counter. JPEG, PNG, WebP or HEIC,
          up to 5 MB.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-4">
        <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
          {imageUrl ? (
            // Signed URLs are short-lived and host-relative, so serve them
            // unoptimised rather than through the image CDN pipeline.
            <Image
              src={imageUrl}
              alt=""
              width={96}
              height={96}
              unoptimized
              className="size-24 object-cover"
            />
          ) : (
            <ImageOff className="size-6 text-muted-foreground" aria-hidden="true" />
          )}
        </div>

        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              aria-label="Product image file"
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
              <Upload className="size-4" />
              {busy ? 'Uploading…' : imageUrl ? 'Replace image' : 'Upload image'}
            </Button>
            {imageUrl ? (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void remove()}>
                Remove
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {imageUrl ? 'An image is set.' : 'No image set.'}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
