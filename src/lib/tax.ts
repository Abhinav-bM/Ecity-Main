/**
 * Tax arithmetic for a bill line (PRD FR-2.3).
 *
 * Everything is integer paise and integer basis points. No floats anywhere:
 * a rounding error here is money the shop cannot reconcile at closing.
 *
 * Two modes, set once per business:
 *   EXCLUSIVE - the price typed is before tax; tax is added on top.
 *   INCLUSIVE - the price typed already contains tax; tax is extracted.
 */

import { splitTax, type TaxSplit } from '@/lib/gst'

export type LineInput = {
  /** HSN (goods) or SAC (services) code, required on a statutory invoice. */
  hsnCode?: string | null
  /** Price of one unit, in paise. */
  unitPricePaise: bigint
  quantity: number
  /** Line-level discount in paise, applied before tax. */
  discountPaise?: bigint
  /** 1800 = 18%. */
  taxRateBasisPoints: number
}

export type LineTax = TaxSplit & {
  /** Price x quantity, before discount. */
  grossPaise: bigint
  discountPaise: bigint
  /** The amount tax is computed on. */
  taxablePaise: bigint
  taxPaise: bigint
  /** What the customer pays for this line. */
  totalPaise: bigint
}

/**
 * Divide and round half-up, staying in integers throughout.
 * BigInt division truncates, which would quietly lose a paisa per line.
 */
function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n
  const negative = numerator < 0n !== denominator < 0n
  const n = numerator < 0n ? -numerator : numerator
  const d = denominator < 0n ? -denominator : denominator
  const result = (n + d / 2n) / d
  return negative ? -result : result
}

const BP = 10_000n

export function computeLine(
  input: LineInput,
  pricesIncludeTax: boolean,
  interState = false,
): LineTax {
  if (!Number.isInteger(input.quantity) || input.quantity < 0) {
    throw new Error('Quantity must be a whole number.')
  }
  const rate = BigInt(Math.trunc(input.taxRateBasisPoints))
  if (rate < 0n || rate > BP) throw new Error('Tax rate must be between 0% and 100%.')

  const gross = input.unitPricePaise * BigInt(input.quantity)
  const discount = input.discountPaise ?? 0n
  if (discount > gross) throw new Error('Discount cannot exceed the line value.')
  const net = gross - discount

  if (pricesIncludeTax) {
    // The net already contains tax:  taxable = net x 10000 / (10000 + rate)
    const taxable = divRound(net * BP, BP + rate)
    // Derived by subtraction, so taxable + tax always equals the total
    // exactly - no rounding gap the customer could spot.
    const inclusiveTax = net - taxable
    return {
      grossPaise: gross,
      discountPaise: discount,
      taxablePaise: taxable,
      taxPaise: inclusiveTax,
      totalPaise: net,
      ...splitTax(inclusiveTax, interState),
    }
  }

  const tax = divRound(net * rate, BP)
  return {
    grossPaise: gross,
    discountPaise: discount,
    taxablePaise: net,
    taxPaise: tax,
    totalPaise: net + tax,
    ...splitTax(tax, interState),
  }
}

export type BillTotals = TaxSplit & {
  subtotalPaise: bigint
  discountPaise: bigint
  taxablePaise: bigint
  taxPaise: bigint
  totalPaise: bigint
  /** Per-rate breakdown, which is what a GST invoice has to show. */
  taxByRate: ({ rateBasisPoints: number; taxablePaise: bigint; taxPaise: bigint } & TaxSplit)[]
  /**
   * HSN-wise summary. A statutory tax invoice must carry one, and it is
   * summed from the line figures so it agrees with the body of the invoice.
   */
  hsnSummary: ({
    hsnCode: string
    rateBasisPoints: number
    quantity: number
    taxablePaise: bigint
    taxPaise: bigint
  } & TaxSplit)[]
}

/**
 * Sum lines into a bill.
 *
 * Tax is summed from the already-rounded line figures rather than recomputed
 * on the total: the invoice must add up line by line, or a customer checking
 * the arithmetic finds it wrong.
 */
export function computeBill(
  lines: (LineInput & { taxRateBasisPoints: number })[],
  pricesIncludeTax: boolean,
  billDiscountPaise: bigint = 0n,
  interState = false,
): BillTotals {
  type Bucket = { taxablePaise: bigint; taxPaise: bigint } & TaxSplit
  const zero = (): Bucket => ({
    taxablePaise: 0n,
    taxPaise: 0n,
    cgstPaise: 0n,
    sgstPaise: 0n,
    igstPaise: 0n,
  })

  const byRate = new Map<number, Bucket>()
  const byHsn = new Map<string, Bucket & { hsnCode: string; rateBasisPoints: number; quantity: number }>()
  let subtotal = 0n
  let discount = billDiscountPaise
  let taxable = 0n
  let tax = 0n
  let cgst = 0n
  let sgst = 0n
  let igst = 0n

  for (const line of lines) {
    const computed = computeLine(line, pricesIncludeTax, interState)
    subtotal += computed.grossPaise
    discount += computed.discountPaise
    taxable += computed.taxablePaise
    tax += computed.taxPaise
    cgst += computed.cgstPaise
    sgst += computed.sgstPaise
    igst += computed.igstPaise

    const bucket = byRate.get(line.taxRateBasisPoints) ?? zero()
    bucket.taxablePaise += computed.taxablePaise
    bucket.taxPaise += computed.taxPaise
    bucket.cgstPaise += computed.cgstPaise
    bucket.sgstPaise += computed.sgstPaise
    bucket.igstPaise += computed.igstPaise
    byRate.set(line.taxRateBasisPoints, bucket)

    // Lines sharing an HSN code can still sit at different rates, so the
    // summary is keyed by both - that is how GSTR-1 expects it.
    if (line.hsnCode) {
      const key = `${line.hsnCode}|${line.taxRateBasisPoints}`
      const h =
        byHsn.get(key) ??
        Object.assign(zero(), {
          hsnCode: line.hsnCode,
          rateBasisPoints: line.taxRateBasisPoints,
          quantity: 0,
        })
      h.quantity += line.quantity
      h.taxablePaise += computed.taxablePaise
      h.taxPaise += computed.taxPaise
      h.cgstPaise += computed.cgstPaise
      h.sgstPaise += computed.sgstPaise
      h.igstPaise += computed.igstPaise
      byHsn.set(key, h)
    }
  }

  const total = pricesIncludeTax ? taxable + tax - billDiscountPaise : taxable + tax - billDiscountPaise

  return {
    subtotalPaise: subtotal,
    discountPaise: discount,
    taxablePaise: taxable,
    taxPaise: tax,
    totalPaise: total,
    cgstPaise: cgst,
    sgstPaise: sgst,
    igstPaise: igst,
    taxByRate: [...byRate.entries()]
      .map(([rateBasisPoints, v]) => ({ rateBasisPoints, ...v }))
      .sort((a, b) => a.rateBasisPoints - b.rateBasisPoints),
    hsnSummary: [...byHsn.values()].sort(
      (a, b) => a.hsnCode.localeCompare(b.hsnCode) || a.rateBasisPoints - b.rateBasisPoints,
    ),
  }
}
