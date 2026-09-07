import { z } from 'zod'
import { globalSearch } from '@/server/services/search.service'
import { route } from '@/server/http'

const schema = z.object({ q: z.string().trim().max(120).default('') })

/**
 * PRD FR-30.1. One endpoint for the whole application.
 *
 * No permission of its own: every branch of the search checks the permission
 * for the thing it is about to return, so a user sees exactly the kinds of
 * record they could reach by navigating. Requiring one blanket permission here
 * would either lock out staff who legitimately search, or hand them rows they
 * cannot open.
 */
export const GET = route({ branchFrom: 'none', schema }, ({ user, body }) =>
  globalSearch(user, body.q),
)
