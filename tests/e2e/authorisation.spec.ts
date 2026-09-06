import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * The M0 acceptance criterion that matters most:
 *
 *   "An Admin can create a Manager restricted to Branch A, and that Manager
 *    cannot read Branch B data - verified by calling the API directly, not
 *    just by the hidden menu."
 *
 * These tests hit the JSON API, bypassing the UI entirely.
 */
const PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe!2026'

// Pure API checks - no rendering involved, so one viewport is enough.
test.describe.configure({ mode: 'serial' })

async function signIn(request: APIRequestContext, email: string) {
  const res = await request.post('/api/auth/login', { data: { email, password: PASSWORD } })
  expect(res.ok(), `sign-in failed for ${email}`).toBe(true)
}

test.describe('API authorisation', () => {
  // These hit JSON endpoints with no rendering, so one viewport is enough.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'viewport-independent')
  })

  test('an unauthenticated request is refused', async ({ request }) => {
    const res = await request.get('/api/users')
    expect(res.status()).toBe(401)
  })

  test('staff cannot list users even though admins can', async ({ request }) => {
    await signIn(request, 'staff@ecity.local')
    const res = await request.get('/api/users')
    expect(res.status()).toBe(403)
    expect((await res.json()).code).toBe('FORBIDDEN')
  })

  test('staff cannot create a user', async ({ request }) => {
    await signIn(request, 'staff@ecity.local')
    const res = await request.post('/api/users', {
      data: {
        name: 'Sneaky Admin',
        email: 'sneaky@example.local',
        roleId: 1,
        password: 'long-enough-password',
        branchIds: [],
      },
    })
    expect(res.status()).toBe(403)
  })

  test('staff cannot read the audit log', async ({ request }) => {
    await signIn(request, 'staff@ecity.local')
    expect((await request.get('/api/audit')).status()).toBe(403)
  })

  test('a branch-limited user cannot switch to a branch they are not assigned to', async ({
    request,
  }) => {
    await signIn(request, 'manager@ecity.local')

    const branches = await (await request.get('/api/branches')).json()
    const visible = (branches as { id: number; code: string }[]).map((b) => b.code)
    expect(visible).toContain('MAIN')
    expect(visible).not.toContain('NORTH')

    // Try to force it anyway, by id, straight at the API.
    const res = await request.post('/api/session/branch', { data: { branchId: 9999 } })
    expect(res.status()).toBe(403)
  })

  test('a branch-limited user cannot request the consolidated all-branch view', async ({
    request,
  }) => {
    await signIn(request, 'manager@ecity.local')
    const res = await request.post('/api/session/branch', { data: { branchId: null } })
    expect(res.status()).toBe(403)
  })

  test('an admin can do all of the above', async ({ request }) => {
    await signIn(request, 'admin@ecity.local')
    expect((await request.get('/api/users')).status()).toBe(200)
    expect((await request.get('/api/audit')).status()).toBe(200)
    expect((await request.post('/api/session/branch', { data: { branchId: null } })).status()).toBe(
      200,
    )
  })

  /*
   * M5. Money leaving and entering the shop is the most abusable surface, so
   * every one of these is checked at the API rather than by whether a button
   * is rendered.
   */
  test('an unauthenticated request cannot record a collection', async ({ request }) => {
    const res = await request.post('/api/customer-payments', {
      data: { customerId: 1, branchId: 1, paymentMethodId: 1, amountPaise: '100' },
    })
    expect(res.status()).toBe(401)
  })

  test('staff can collect a payment but cannot void one', async ({ request }) => {
    await signIn(request, 'staff@ecity.local')

    // Collecting is the counter's job, so this must not be a 403. It may well
    // be a 404 or 422 on made-up ids - anything except "you may not".
    const collect = await request.post('/api/customer-payments', {
      data: { customerId: 999999, branchId: 1, paymentMethodId: 1, amountPaise: '100' },
    })
    expect(collect.status()).not.toBe(403)

    // Voiding erases money already recorded as received. Not the counter's.
    const voidAttempt = await request.post('/api/customer-payments/1/void', {
      data: { reason: 'trying it on' },
    })
    expect(voidAttempt.status()).toBe(403)
  })

  test('an admin may void a receipt', async ({ request }) => {
    await signIn(request, 'admin@ecity.local')
    const res = await request.post('/api/customer-payments/999999/void', {
      data: { reason: 'permission check' },
    })
    // No such receipt, but the permission gate let it through to find that out.
    expect(res.status()).toBe(404)
  })

  test('a payment cannot be booked to a branch the user cannot access', async ({ request }) => {
    await signIn(request, 'manager@ecity.local')
    const res = await request.post('/api/customer-payments', {
      data: { customerId: 1, branchId: 9999, paymentMethodId: 1, amountPaise: '100' },
    })
    expect(res.status()).toBe(403)
  })

  test('health check reports the database', async ({ request }) => {
    const res = await request.get('/api/health')
    expect(res.status()).toBe(200)
    expect((await res.json()).database).toBe('up')
  })
})
