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

export type LineInput = {
  /** Price of one unit, in paise. */
  unitPricePaise: bigint
  quantity: number
  /** Line-level discount in paise, applied before tax. */
  discountPaise?: bigint
  /** 1800 = 18%. */
  taxRateBasisPoints: number
}

export type LineTax = {
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

export function computeLine(input: LineInput, pricesIncludeTax: boolean): LineTax {
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
    return {
      grossPaise: gross,
      discountPaise: discount,
      taxablePaise: taxable,
      // Derived by subtraction, so taxable + tax always equals the total
      // exactly - no rounding gap the customer could spot.
      taxPaise: net - taxable,
      totalPaise: net,
    }
  }

  const tax = divRound(net * rate, BP)
  return {
    grossPaise: gross,
    discountPaise: discount,
    taxablePaise: net,
    taxPaise: tax,
    totalPaise: net + tax,
  }
}

export type BillTotals = {
  subtotalPaise: bigint
  discountPaise: bigint
  taxablePaise: bigint
  taxPaise: bigint
  totalPaise: bigint
  /** Per-rate breakdown, which is what a GST invoice has to show. */
  taxByRate: { rateBasisPoints: number; taxablePaise: bigint; taxPaise: bigint }[]
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
): BillTotals {
  const byRate = new Map<number, { taxablePaise: bigint; taxPaise: bigint }>()
  let subtotal = 0n
  let discount = billDiscountPaise
  let taxable = 0n
  let tax = 0n

  for (const line of lines) {
    const computed = computeLine(line, pricesIncludeTax)
    subtotal += computed.grossPaise
    discount += computed.discountPaise
    taxable += computed.taxablePaise
    tax += computed.taxPaise

    const bucket = byRate.get(line.taxRateBasisPoints) ?? { taxablePaise: 0n, taxPaise: 0n }
    bucket.taxablePaise += computed.taxablePaise
    bucket.taxPaise += computed.taxPaise
    byRate.set(line.taxRateBasisPoints, bucket)
  }

  const total = pricesIncludeTax ? taxable + tax - billDiscountPaise : taxable + tax - billDiscountPaise

  return {
    subtotalPaise: subtotal,
    discountPaise: discount,
    taxablePaise: taxable,
    taxPaise: tax,
    totalPaise: total,
    taxByRate: [...byRate.entries()]
      .map(([rateBasisPoints, v]) => ({ rateBasisPoints, ...v }))
      .sort((a, b) => a.rateBasisPoints - b.rateBasisPoints),
  }
}
