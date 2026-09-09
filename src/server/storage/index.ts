import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { env } from '@/server/env'

/**
 * File storage behind a small interface (docs/03 §6.5, rule 3).
 *
 * Two drivers:
 *   - `local`  writes under .storage/ - development only
 *   - `s3`     any S3-compatible bucket (Cloudflare R2 in production)
 *
 * Nothing outside this folder knows which is in use. Swapping providers is a
 * config change, which is the whole point.
 */

export type StoredFile = {
  key: string
  fileName: string
  contentType: string
  sizeBytes: number
}

export interface StorageDriver {
  readonly name: string
  put(key: string, body: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
}

/* ------------------------------------------------------------ local ------ */

const LOCAL_ROOT = path.join(process.cwd(), '.storage')

const localDriver: StorageDriver = {
  name: 'local',
  async put(key, body) {
    const target = path.join(LOCAL_ROOT, key)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, body)
  },
  async get(key) {
    return readFile(path.join(LOCAL_ROOT, key))
  },
  async delete(key) {
    await unlink(path.join(LOCAL_ROOT, key)).catch(() => undefined)
  },
}

/* --------------------------------------------------------------- s3 ------ */

/**
 * Object storage over the S3 protocol — Cloudflare R2 in production.
 *
 * "S3" names the *protocol*, not Amazon. R2 speaks it, and is what this shop
 * uses: storage is charged, reading files back is not, and a shop whose staff
 * open bill photos all day would pay for every one of those reads on AWS.
 * Moving to Backblaze or MinIO is a change of endpoint.
 *
 * The alternative to a bucket is the container's own disk, which is what the
 * local driver does — and a container is replaced on every deploy, taking
 * three months of supplier invoices with it. That is the failure this exists
 * to prevent.
 */
type S3Config = {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

/**
 * Read the configuration, or say exactly what is missing.
 *
 * Checked when the driver is first used rather than at import, so a developer
 * on the local driver never trips over it — but a server set to `s3` with a
 * half-filled `.env` fails on the first upload with the name of the variable
 * it wants, not a 403 from Cloudflare.
 */
function s3Config(): S3Config {
  const e = env()
  const endpoint =
    e.S3_ENDPOINT ??
    (e.R2_ACCOUNT_ID ? `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined)

  const missing = [
    !endpoint && 'S3_ENDPOINT (or R2_ACCOUNT_ID)',
    !e.S3_BUCKET && 'S3_BUCKET',
    !e.S3_ACCESS_KEY_ID && 'S3_ACCESS_KEY_ID',
    !e.S3_SECRET_ACCESS_KEY && 'S3_SECRET_ACCESS_KEY',
  ].filter(Boolean)

  if (missing.length) {
    throw new Error(
      `STORAGE_DRIVER is 's3' but ${missing.join(', ')} ${
        missing.length === 1 ? 'is' : 'are'
      } not set. Uploads cannot be stored.`,
    )
  }

  return {
    endpoint: endpoint!,
    bucket: e.S3_BUCKET!,
    accessKeyId: e.S3_ACCESS_KEY_ID!,
    secretAccessKey: e.S3_SECRET_ACCESS_KEY!,
  }
}

/**
 * One client for the process.
 *
 * Built on first use and kept: it holds a connection pool, and making a new
 * one per upload would open a fresh TLS handshake for every bill photo.
 */
let client: S3Client | null = null
let clientBucket = ''

function s3(): { client: S3Client; bucket: string } {
  if (!client) {
    const config = s3Config()
    client = new S3Client({
      // R2 has no regions in the AWS sense, but the protocol requires one.
      region: 'auto',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    })
    clientBucket = config.bucket
  }
  return { client, bucket: clientBucket }
}

const s3Driver: StorageDriver = {
  name: 's3',

  async put(key, body, contentType) {
    const { client, bucket } = s3()
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    )
  },

  async get(key) {
    const { client, bucket } = s3()
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    if (!result.Body) throw new Error(`Stored file ${key} came back empty.`)
    // The SDK hands back a stream; the callers want the bytes.
    return Buffer.from(await result.Body.transformToByteArray())
  },

  async delete(key) {
    const { client, bucket } = s3()
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  },
}

/** For tests: forget the cached client so a changed config is picked up. */
export function resetStorageClient(): void {
  client = null
  clientBucket = ''
}

export function storage(): StorageDriver {
  return env().STORAGE_DRIVER === 's3' ? s3Driver : localDriver
}

/* ------------------------------------------------------------- keys ------ */

/** Opaque, unguessable, and namespaced so a bucket listing stays readable. */
export function newStorageKey(businessId: number, entityType: string, fileName: string): string {
  const ext = path.extname(fileName).toLowerCase().slice(0, 10)
  const now = new Date()
  const yyyymm = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  return `${businessId}/${entityType}/${yyyymm}/${randomUUID()}${ext}`
}

/* ---------------------------------------------------- signed access ------ */

/**
 * Short-lived signed URLs. Files are never served from a public path
 * (PRD NFR §9.4) - the app mints a token, and the download route verifies it.
 */
export function signKey(key: string, expiresAt: number): string {
  return createHmac('sha256', env().AUTH_SECRET)
    .update(`${key}:${expiresAt}`)
    .digest('base64url')
}

export function signedUrl(key: string, ttlSeconds = 300): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds
  const signature = signKey(key, expiresAt)
  const params = new URLSearchParams({ key, expires: String(expiresAt), sig: signature })
  return `/api/files?${params.toString()}`
}

export function verifySignature(key: string, expires: string, signature: string): boolean {
  const expiresAt = Number(expires)
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return false
  const expected = Buffer.from(signKey(key, expiresAt))
  const given = Buffer.from(signature)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/* -------------------------------------------------------- validation ----- */

/**
 * The ceiling on one upload.
 *
 * A phone photo is 2–5 MB, so this fits one with a little room. It is also
 * what keeps the shop inside R2's free 10 GB — about two thousand photos —
 * and what stops a single upload from being a memory problem on a 1 GB
 * server.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

export const ALLOWED_UPLOAD_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
] as const

export function uploadProblems(file: { size: number; type: string }): string[] {
  const problems: string[] = []
  if (file.size > MAX_UPLOAD_BYTES) {
    problems.push(
      `That file is ${Math.ceil(file.size / 1024 / 1024)} MB. The limit is ${
        MAX_UPLOAD_BYTES / 1024 / 1024
      } MB — a photo taken on a phone is usually well under it.`,
    )
  }
  if (file.size === 0) problems.push('File is empty.')
  if (!(ALLOWED_UPLOAD_TYPES as readonly string[]).includes(file.type)) {
    problems.push('Only JPEG, PNG, WebP, HEIC images and PDF files are accepted.')
  }
  return problems
}
