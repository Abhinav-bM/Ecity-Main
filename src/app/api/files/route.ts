import { NextResponse } from 'next/server'
import { findByStorageKey } from '@/server/services/attachment.service'
import { getSessionContext } from '@/server/auth/session'
import { storage, verifySignature } from '@/server/storage'
import { logger } from '@/server/logger'

export const dynamic = 'force-dynamic'

/**
 * Signed file download. Two independent checks, both required:
 *   1. the URL signature is valid and unexpired
 *   2. the caller has a session in the business that owns the file
 *
 * A leaked link is therefore useless to an outsider, and useless to anyone
 * once it expires (PRD NFR §9.4).
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const key = url.searchParams.get('key')
  const expires = url.searchParams.get('expires')
  const sig = url.searchParams.get('sig')

  if (!key || !expires || !sig || !verifySignature(key, expires, sig)) {
    return NextResponse.json({ error: 'This link is invalid or has expired.' }, { status: 403 })
  }

  const session = await getSessionContext()
  if (!session) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const row = await findByStorageKey(key)
  if (!row || row.businessId !== session.user.businessId) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  try {
    const body = await storage().get(key)
    return new NextResponse(new Uint8Array(body), {
      headers: {
        'content-type': row.contentType,
        'content-length': String(row.sizeBytes),
        'content-disposition': `inline; filename="${encodeURIComponent(row.fileName)}"`,
        'cache-control': 'private, max-age=60',
      },
    })
  } catch (error) {
    logger.error({ err: error, key }, 'Failed to read stored file')
    return NextResponse.json({ error: 'File could not be read.' }, { status: 500 })
  }
}
