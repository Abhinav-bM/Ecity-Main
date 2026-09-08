import { z } from 'zod'
import { globalSearch } from '@/server/services/search.service'
import { route } from '@/server/http'
import { consume, SEARCH_LIMIT } from '@/server/rate-limit'

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
export const GET = route({ branchFrom: 'none', schema }, ({ user, body }) => {
  /*
   * Authenticated, so this is about load rather than intrusion: one search
   * touches every table at once, and a loop would put a shop's whole database
   * under a scan. Keyed on the user, not the address — several staff behind
   * one shop router are one address.
   */
  consume('search', String(user.id), SEARCH_LIMIT)
  return globalSearch(user, body.q)
})
