import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { SHOP_TIME_ZONE } from "@/lib/date"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Money is bigint paise. This is the only place it becomes a string. */
export function formatPaise(paise: bigint | number, currency = "INR"): string {
  const value = Number(paise) / 100
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—"
  const d = typeof value === "string" ? new Date(value) : value
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: SHOP_TIME_ZONE,
  }).format(d)
}

/**
 * Short form for narrow screens, where the full date does not fit.
 *
 * Pinned to the shop's zone, like every other formatter here. Without the
 * `timeZone` this used the machine's own, which is the browser's on the client
 * and the SERVER's when a page renders on the server - and a production box is
 * conventionally UTC. A business date is stored as midnight in India, which is
 * 18:30 UTC the day before, so on a UTC server every bill date, invoice date
 * and statement line rendered a day early.
 */
export function formatDateShort(value: Date | string | null | undefined): string {
  if (!value) return "—"
  const d = typeof value === "string" ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return "—"
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: SHOP_TIME_ZONE,
  }).format(d)
}

/**
 * Clock time at the shop.
 *
 * An expense carries two moments: the day it belongs to, which is the shop's
 * business date, and the moment someone keyed it in. The first is what the
 * books balance on; the second is what settles an argument about who entered
 * what and when.
 */
export function formatTimeShort(value: Date | string | null | undefined): string {
  if (!value) return "—"
  const d = typeof value === "string" ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return "—"
  return new Intl.DateTimeFormat("en-IN", {
    timeStyle: "short",
    timeZone: SHOP_TIME_ZONE,
  }).format(d)
}
