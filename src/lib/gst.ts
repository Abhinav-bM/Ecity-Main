/**
 * GST identity and tax-split rules (PRD FR-2.3, FR-26.1; resolves OQ-4).
 *
 * A tax invoice is a legal document. Two things decide how the tax is shown:
 *
 *   Intra-state supply (place of supply == the branch's state)
 *     tax splits into CGST + SGST, each half.
 *   Inter-state supply
 *     the whole tax is IGST.
 *
 * The split is presentational — the customer pays the same either way — but
 * getting it wrong makes the invoice non-compliant and the shop's returns
 * disagree with its books.
 */

/** The official GST state codes: the first two digits of every GSTIN. */
export const GST_STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
}

/**
 * Coerce anything stored or submitted into a real state code, or null.
 *
 * A form submits '' for "not set", and '' is truthy enough to defeat a `??`
 * fallback chain - which would leave a blank place of supply on an invoice
 * that could have derived one from the GSTIN.
 */
export function normaliseStateCode(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed in GST_STATE_CODES ? trimmed : null
}

export function stateName(code: string | null | undefined): string | null {
  if (!code) return null
  return GST_STATE_CODES[code] ?? null
}

/** The state code carried in a GSTIN's first two digits, if it is a real one. */
export function stateCodeFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin) return null
  const code = gstin.trim().slice(0, 2)
  return code in GST_STATE_CODES ? code : null
}

export type TaxSplit = {
  cgstPaise: bigint
  sgstPaise: bigint
  igstPaise: bigint
}

/**
 * Split a line's tax into its statutory components.
 *
 * CGST takes the floor and SGST the remainder, so the two always add back to
 * exactly the tax charged. Halving 3 paise as 1.5 + 1.5 and rounding both up
 * would invent a paisa the customer was never charged.
 */
export function splitTax(taxPaise: bigint, interState: boolean): TaxSplit {
  if (interState) return { cgstPaise: 0n, sgstPaise: 0n, igstPaise: taxPaise }
  const cgst = taxPaise / 2n
  return { cgstPaise: cgst, sgstPaise: taxPaise - cgst, igstPaise: 0n }
}

/**
 * Where the supply is taxed.
 *
 * A registered customer's own state governs. A walk-in with no GSTIN is
 * treated as buying at the counter, which is where they are standing - the
 * branch's state - so an ordinary shop sale stays intra-state.
 */
export function placeOfSupply(
  branchStateCode: string | null,
  customerStateCode: string | null,
): string | null {
  return customerStateCode ?? branchStateCode
}

export function isInterState(
  branchStateCode: string | null,
  placeOfSupplyCode: string | null,
): boolean {
  // Unknown state is treated as intra-state: CGST/SGST is the overwhelmingly
  // common case for a counter sale, and guessing IGST would be worse.
  if (!branchStateCode || !placeOfSupplyCode) return false
  return branchStateCode !== placeOfSupplyCode
}
