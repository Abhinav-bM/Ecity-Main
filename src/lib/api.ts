'use client'

/**
 * The one way the browser talks to this app's API.
 *
 * Every screen used to call `fetch` directly and read `res.json()`. Three
 * things went wrong with that, on every screen, and all three are invisible
 * until the day they matter:
 *
 *   1. `fetch` REJECTS on a network failure - it does not return a bad
 *      response. An unguarded `await fetch(...)` in a click handler therefore
 *      threw straight past the `setSaving(false)` below it, so the button sat
 *      on "Saving…" for ever and the person at the counter was told nothing.
 *      That is the exact case - a dropped connection mid-sale - that the
 *      idempotency key exists to make safe, and it was the one case where the
 *      screen could not offer to retry.
 *
 *   2. `res.json()` throws when the body is not JSON. A 502 from the proxy
 *      while the app restarts is an HTML page, and reading it as JSON threw a
 *      second error on top of the first, again with nothing shown.
 *
 *   3. A 401 - the session expired, which it does on a fixed schedule - was
 *      rendered as the words "Not signed in." inside a form, leaving the user
 *      stuck on a screen that would never work again.
 *
 * So this returns a result instead of throwing, always resolves, and never
 * invents data: a failure is a failure, it just says which kind.
 */

export type ApiFailure = {
  ok: false
  /** Sentence to show the user. Always set. */
  error: string
  /** The server's machine-readable code, where there was one. */
  code?: string
  /** 0 when the request never reached the server. */
  status: number
  /** Zod field errors from a 422, for forms that highlight inputs. */
  fieldErrors?: Record<string, string[] | undefined>
}

export type ApiResult<T> = { ok: true; data: T } | ApiFailure

type ErrorBody = {
  error?: string
  code?: string
  fieldErrors?: Record<string, string[] | undefined>
}

const NETWORK_MESSAGE =
  'Could not reach the server. Check the connection and try again — nothing has been saved.'

/**
 * Is this 401 a lost session, or an endpoint's own answer?
 *
 * Not every 401 means "sign in again". `/api/auth/login` returns one for a
 * wrong password, and treating that as an expiry replaced "Email or password
 * is incorrect" with "Your session has expired" - telling someone who had
 * simply mistyped their password to sign in again, on the page they were
 * already signing in on.
 *
 * The server already separates the two: the route wrapper answers a missing
 * session with `UNAUTHENTICATED`, while a rejected credential is
 * `INVALID_CREDENTIALS`. Key on that, not on the status.
 */
function isSessionExpiry(status: number, code: string | undefined): boolean {
  return status === 401 && (code === undefined || code === 'UNAUTHENTICATED')
}

/**
 * The session is gone. Bouncing to the login page is the only useful thing
 * left to do, and `next` brings the person back to the screen they were on
 * once they are signed in again.
 */
function goToLogin(): void {
  if (typeof window === 'undefined') return
  const here = window.location.pathname + window.location.search
  if (window.location.pathname === '/login') return
  /*
   * A full document load on purpose, not `router.push`.
   *
   * The session this tab was rendered for is gone. The Next router cache still
   * holds RSC payloads produced for that session - a soft navigation would
   * keep them, and the user would be shown fragments of a signed-in app they
   * are no longer signed in to. Reloading the document is what actually clears
   * that state.
   */
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- see above: the client state must be discarded, not reused.
  window.location.assign(`/login?next=${encodeURIComponent(here)}`)
}

/** Read a body as JSON without throwing when it is not JSON. */
async function readJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '')
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

export async function apiFetch<T = unknown>(
  input: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(input, init)
  } catch {
    // Offline, DNS, connection reset, or the request was aborted. There is no
    // status because nothing answered.
    return { ok: false, error: NETWORK_MESSAGE, code: 'NETWORK', status: 0 }
  }

  const body = (await readJson(res)) as ErrorBody | T | null

  if (!res.ok) {
    const e = (body ?? {}) as ErrorBody
    if (isSessionExpiry(res.status, e.code)) {
      goToLogin()
      return {
        ok: false,
        error: 'Your session has expired. Taking you to the sign-in page…',
        code: 'UNAUTHENTICATED',
        status: 401,
      }
    }
    return {
      ok: false,
      // A proxy error or a crash has no JSON body to quote, so say something
      // true about the status rather than "undefined".
      error: e.error ?? fallbackMessage(res.status),
      code: e.code,
      status: res.status,
      fieldErrors: e.fieldErrors,
    }
  }

  return { ok: true, data: body as T }
}

/** Convenience for the many call sites that only need "did it work?". */
export async function apiSend(input: string, init?: RequestInit): Promise<ApiResult<unknown>> {
  return apiFetch<unknown>(input, init)
}

/** POST/PATCH/PUT/DELETE with a JSON body, which is nearly every mutation here. */
export async function apiJson<T = unknown>(
  input: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<ApiResult<T>> {
  return apiFetch<T>(input, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/**
 * The same guarantees for a response that is not JSON - the invoice PDF.
 *
 * `apiFetch` reads every body as JSON, which would quietly turn a perfectly
 * good PDF into `null`. This keeps the bytes, and keeps the network and
 * session handling that a bare `fetch` here would have thrown away.
 */
export async function apiBlob(
  input: string,
  init?: RequestInit,
): Promise<{ ok: true; blob: Blob } | ApiFailure> {
  let res: Response
  try {
    res = await fetch(input, init)
  } catch {
    return { ok: false, error: NETWORK_MESSAGE, code: 'NETWORK', status: 0 }
  }

  if (!res.ok) {
    const e = ((await readJson(res)) ?? {}) as ErrorBody
    if (isSessionExpiry(res.status, e.code)) {
      goToLogin()
      return {
        ok: false,
        error: 'Your session has expired. Taking you to the sign-in page…',
        code: 'UNAUTHENTICATED',
        status: 401,
      }
    }
    return { ok: false, error: e.error ?? fallbackMessage(res.status), code: e.code, status: res.status }
  }

  try {
    return { ok: true, blob: await res.blob() }
  } catch {
    return { ok: false, error: 'The file could not be read.', code: 'BAD_BODY', status: res.status }
  }
}

function fallbackMessage(status: number): string {
  if (status === 403) return 'You do not have permission to do that.'
  if (status === 404) return 'That record no longer exists.'
  if (status === 409) return 'Someone else changed this a moment ago. Reload and try again.'
  if (status === 413) return 'That file is too large.'
  if (status === 429) return 'Too many attempts. Wait a moment and try again.'
  if (status >= 500) return 'The server had a problem. Nothing has been saved — please try again.'
  return 'That did not work. Please try again.'
}
