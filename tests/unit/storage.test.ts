import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_UPLOAD_BYTES, uploadProblems } from '@/server/storage'

/**
 * Uploads: what is accepted, and what happens when the bucket is not
 * configured.
 *
 * The round trip against a real bucket cannot be tested here — that needs
 * credentials — so what is covered is everything around it: the rules, and
 * the failure a half-filled `.env` produces. That second one matters most,
 * because the alternative is writing a shop's bill photos into a container
 * that is replaced on the next deploy.
 */
describe('what may be uploaded', () => {
  const photo = { size: 2 * 1024 * 1024, type: 'image/jpeg' }

  it('accepts a phone photo', () => {
    expect(uploadProblems(photo)).toEqual([])
  })

  it('accepts the formats a shop actually has', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']) {
      expect(uploadProblems({ size: 1000, type }), type).toEqual([])
    }
  })

  it('refuses a file over the limit, and says how big it was', () => {
    const problems = uploadProblems({ size: MAX_UPLOAD_BYTES + 1, type: 'image/jpeg' })
    expect(problems).toHaveLength(1)
    // "too large" alone leaves someone guessing whether to try again.
    expect(problems[0]).toMatch(/6 MB/)
    expect(problems[0]).toMatch(/limit is 5 MB/)
  })

  it('refuses an empty file', () => {
    // A failed camera capture arrives as zero bytes and would otherwise be
    // stored as a valid attachment nobody can open.
    expect(uploadProblems({ size: 0, type: 'image/jpeg' })).toContain('File is empty.')
  })

  it('refuses anything that is not an image or a PDF', () => {
    for (const type of ['application/zip', 'text/html', 'application/x-msdownload', '']) {
      expect(uploadProblems({ size: 1000, type }), type).not.toEqual([])
    }
  })

  it('holds the limit at 5 MB', () => {
    // Pinned: the number appears in six places in the UI, and they have to
    // agree with the rule.
    expect(MAX_UPLOAD_BYTES).toBe(5 * 1024 * 1024)
  })
})

describe('when the bucket is not configured', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  it('names the variable that is missing, rather than failing at Cloudflare', async () => {
    vi.stubEnv('STORAGE_DRIVER', 's3')
    vi.stubEnv('S3_BUCKET', '')
    vi.stubEnv('S3_ACCESS_KEY_ID', '')
    vi.stubEnv('S3_SECRET_ACCESS_KEY', '')
    vi.stubEnv('R2_ACCOUNT_ID', '')

    const { storage } = await import('@/server/storage')
    await expect(storage().put('k', Buffer.from('x'), 'image/jpeg')).rejects.toThrow(
      /S3_BUCKET|S3_ENDPOINT/,
    )
  })

  it('never falls back to the local disk when s3 was asked for', async () => {
    /*
     * The whole point. A silent fallback writes a shop's photos into a
     * container that the next deploy replaces — and it looks like it worked.
     */
    vi.stubEnv('STORAGE_DRIVER', 's3')
    vi.stubEnv('S3_BUCKET', '')

    const { storage } = await import('@/server/storage')
    expect(storage().name).toBe('s3')
    await expect(storage().put('k', Buffer.from('x'), 'image/jpeg')).rejects.toThrow()
  })
})
