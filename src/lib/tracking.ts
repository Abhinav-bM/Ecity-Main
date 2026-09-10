/**
 * How a category identifies its units, in words.
 *
 * Three screens describe this - the catalogue that sets it, the product form
 * that shows what was chosen, and the purchase line that acts on it - and
 * they were drifting apart. "IMEI and serial" is stored as an IMEI category
 * with a flag, because a serial is not a third kind of identifier; the naming
 * lives here so nowhere has to reassemble that pair for itself.
 */
export type Tracking = { isSerialised: boolean; identifierType: string; capturesSerial: boolean }

/** Short, for a badge or a bracket after a category name. */
export function trackingLabel(c: Tracking): string {
  if (!c.isSerialised) return 'counted'
  if (c.identifierType === 'SERIAL') return 'serial number'
  return c.capturesSerial ? 'IMEI + serial' : 'IMEI'
}

/** A sentence, for a form explaining what it is about to ask for. */
export function trackingDescription(c: Tracking): string {
  if (!c.isSerialised) return 'Counted per branch.'
  if (c.identifierType === 'SERIAL') {
    return 'Each unit is registered individually, by serial number.'
  }
  return c.capturesSerial
    ? 'Each unit is registered individually by IMEI, and can carry the serial from its box as well.'
    : 'Each unit is registered individually, by IMEI.'
}
