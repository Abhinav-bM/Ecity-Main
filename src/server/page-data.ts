import { notFound } from 'next/navigation'
import { AppError } from '@/server/http'

/**
 * Run a page's data load, turning "no such record" into a real 404.
 *
 * Services signal a missing (or out-of-scope) record by throwing `AppError`
 * with status 404 — the shape the API routes need. A server component that
 * simply awaited one of those threw it on into React, which had no boundary
 * for it, so a link to a deleted bill produced the generic error screen rather
 * than "not found". Both are "you cannot see this", but only one of them is
 * honest about why, and only one leaves the person a way onward.
 *
 * Anything that is NOT a 404 is rethrown untouched: a database that is down
 * must not be reported as a missing record.
 */
export async function orNotFound<T>(work: Promise<T>): Promise<T> {
  try {
    return await work
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound()
    throw error
  }
}
