import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

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
    timeZone: "Asia/Kolkata",
  }).format(d)
}

/** Short form for narrow screens, where the full date does not fit. */
export function formatDateShort(value: Date | string | null | undefined): string {
  if (!value) return "—"
  const d = typeof value === "string" ? new Date(value) : value
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(d)
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
    timeZone: "Asia/Kolkata",
  }).format(d)
}
