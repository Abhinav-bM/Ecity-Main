import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
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
 * Deliberately not implemented until it is needed. Failing loudly at startup
 * beats silently writing a customer's bill photos to a laptop in production.
 */
const s3Driver: StorageDriver = {
  name: 's3',
  async put() {
    throw new Error('S3 storage driver not implemented yet. Set STORAGE_DRIVER=local.')
  },
  async get() {
    throw new Error('S3 storage driver not implemented yet. Set STORAGE_DRIVER=local.')
  },
  async delete() {
    throw new Error('S3 storage driver not implemented yet. Set STORAGE_DRIVER=local.')
  },
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

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

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
    problems.push(`File must be under ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`)
  }
  if (file.size === 0) problems.push('File is empty.')
  if (!(ALLOWED_UPLOAD_TYPES as readonly string[]).includes(file.type)) {
    problems.push('Only JPEG, PNG, WebP, HEIC images and PDF files are accepted.')
  }
  return problems
}
