import { z } from 'zod'
import { GST_STATE_CODES } from '@/lib/gst'

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required.')
  .email('Enter a valid email address.')
  .transform((v) => v.toLowerCase())

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200, 'Use no more than 200 characters.')

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required.'),
})

export const forgotPasswordSchema = z.object({ email: emailSchema })

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  })

export const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Name is required.').max(120),
  email: emailSchema,
  phone: z.string().trim().max(20).optional().or(z.literal('')),
  roleId: z.coerce.number().int().positive('Choose a role.'),
  branchIds: z.array(z.coerce.number().int().positive()).default([]),
  password: passwordSchema,
})

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(20).optional().or(z.literal('')),
  roleId: z.coerce.number().int().positive().optional(),
  branchIds: z.array(z.coerce.number().int().positive()).optional(),
  isActive: z.boolean().optional(),
})

export const upsertRoleSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Z0-9_]+$/, 'Use capitals, digits and underscores only.'),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional().or(z.literal('')),
  permissions: z.array(z.string()).default([]),
})

export const auditQuerySchema = z.object({
  entityType: z.string().optional(),
  actorUserId: z.coerce.number().int().positive().optional(),
  action: z.string().optional(),
  branchId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})

export const switchBranchSchema = z.object({
  branchId: z.union([z.coerce.number().int().positive(), z.null()]),
})

/* ============================================================ M1 schemas === */

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal(''))

/** Indian GSTIN: 2 state digits, 10-char PAN, entity digit, Z, checksum. */
export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN.')
  .optional()
  .or(z.literal(''))

/**
 * Two-digit GST state code (PRD OQ-4). Blank is allowed - a shop that is not
 * registered has no state code to give, and the invoice simply omits the
 * place-of-supply line rather than printing a wrong one.
 */
export const stateCodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{2}$/, 'Choose a state.')
  .refine((v) => v in GST_STATE_CODES, 'That is not a valid GST state code.')
  .optional()
  .or(z.literal(''))

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^[0-9+\-\s()]{6,20}$/, 'Enter a valid phone number.')
  .optional()
  .or(z.literal(''))

export const businessProfileSchema = z.object({
  name: z.string().trim().min(2, 'Business name is required.').max(160),
  legalName: optionalText(160),
  email: z.string().trim().email('Enter a valid email address.').optional().or(z.literal('')),
  phone: phoneSchema,
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(80),
  state: optionalText(80),
  pincode: optionalText(12),
  gstin: gstinSchema,
  stateCode: stateCodeSchema,
  /**
   * PRD FR-38.1 / OQ-11. Which system bills NEW stock. Anything not NEW is
   * always sold here, so this only governs the NEW case.
   */
  newStockSalesChannel: z.enum(['EXTERNAL', 'ECITY', 'BOTH']).default('EXTERNAL'),
  /** PRD FR-7.2. Zero means "due immediately", which some shops do run. */
  defaultCreditDays: z.coerce
    .number()
    .int('Whole days only.')
    .min(0, 'Cannot be negative.')
    .max(365, 'A year is the longest sensible term.')
    .default(30),
  currency: z.string().trim().length(3).default('INR'),
  timezone: z.string().trim().min(3).default('Asia/Kolkata'),
  pricesIncludeTax: z.boolean().default(true),
  /**
   * Is the shop registered for GST? Off means no tax on any bill and no GST
   * field anywhere in the app. Nothing is deleted, so it can be switched back
   * on when the shop registers.
   */
  gstEnabled: z.boolean().default(true),
  invoicePrefix: z.string().trim().min(1).max(10).default('INV'),
  /**
   * PRD FR-4.11. How many IMEI inputs the device and purchase forms show.
   * It governs the UI only — the API, importer and reports always handle a
   * device's full identifier list whatever this is set to.
   */
  imeiSlots: z.coerce.number().int().min(1, 'At least one.').max(4, 'At most four.').default(1),
})

export const taxRateSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  name: z.string().trim().min(1, 'Name is required.').max(60),
  /** Percent in the UI, basis points in the database. 18 -> 1800. */
  ratePercent: z.coerce
    .number()
    .min(0, 'Cannot be negative.')
    .max(100, 'Cannot exceed 100%.')
    .refine((v) => Number.isInteger(v * 100), 'At most two decimal places.'),
  isDefault: z.boolean().default(false),
})

export const paymentMethodSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  /*
   * Optional: derived from the name by the service when absent. The add form
   * no longer asks for one - it is an identifier the app never branches on,
   * and a shop owner has no way to invent a good one. Still accepted, and
   * still validated, so the seed and any import can pin a known code.
   */
  code: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .regex(/^[A-Z0-9_]+$/, 'Use capitals, digits and underscores only.')
    .optional(),
  name: z.string().trim().min(2, 'Name is required.').max(60),
  type: z.enum(['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER']),
  affectsCashDrawer: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
})

export const expenseCategorySchema = z.object({
  name: z.string().trim().min(2, 'Name is required.').max(60),
})

export const setActiveSchema = z.object({ isActive: z.boolean() })

export const branchSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'Code is required.')
    .max(12)
    .regex(/^[A-Z0-9_-]+$/, 'Use capitals, digits, hyphen and underscore only.'),
  name: z.string().trim().min(2, 'Name is required.').max(120),
  phone: phoneSchema,
  email: z.string().trim().email('Enter a valid email address.').optional().or(z.literal('')),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(80),
  state: optionalText(80),
  pincode: optionalText(12),
  gstin: gstinSchema,
  stateCode: stateCodeSchema,
  invoicePrefix: optionalText(10),
  /**
   * An unselected <select> submits '', which z.coerce turns into 0 and then
   * fails .positive(). Normalise "no selection" to null before coercing.
   */
  managerUserId: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? null : v),
    z.coerce.number().int().positive().nullable(),
  ),
  notes: optionalText(500),
})

export const branchStatusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) })

/** Customers and suppliers share a shape; `company` is ignored for customers. */
export const partySchema = z.object({
  name: z.string().trim().min(2, 'Name is required.').max(160),
  company: optionalText(160),
  phone: phoneSchema,
  altPhone: phoneSchema,
  email: z.string().trim().email('Enter a valid email address.').optional().or(z.literal('')),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(80),
  state: optionalText(80),
  pincode: optionalText(12),
  gstin: gstinSchema,
  stateCode: stateCodeSchema,
  notes: optionalText(1000),
})

/**
 * A boolean from a query string.
 *
 * `z.coerce.boolean()` is JavaScript truthiness, so the string `"false"` -
 * which is what every client sends for false - arrives as **true**. Only the
 * `serialised=true` case was ever used in the app, so nothing broke; but
 * `?serialised=false` silently meaning "serialised only" is a trap the next
 * screen would fall into. This reads the words people actually send.
 */
export const queryBoolean = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const text = value.trim().toLowerCase()
  if (['false', '0', 'no', ''].includes(text)) return false
  if (['true', '1', 'yes'].includes(text)) return true
  return value
}, z.boolean())

export const partyStatusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) })

export const partyQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  includeInactive: queryBoolean.default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

/** Percent <-> basis points. The UI talks percent; the database stores integers. */
export const toBasisPoints = (percent: number): number => Math.trunc(percent * 100 + 0.5)
export const toPercent = (basisPoints: number): number => basisPoints / 100

/* ============================================================ M2 schemas === */

/**
 * The largest figure any money field accepts, in rupees (₹10 crore).
 *
 * Every amount in the app is bounded by this, for two reasons that both bite:
 * paise are stored in a bigint column, and a figure past ~₹9.2e16 overflows it
 * mid-transaction; and `Number` happily parses "1e400" and "Infinity" out of a
 * text box, which `BigInt()` then refuses outright.
 */
export const MAX_RUPEES = 100_000_000

/**
 * A money field, in rupees.
 *
 * `.finite()` is the part that matters: without it `z.coerce.number()` accepts
 * the strings "Infinity" and "1e400" as perfectly good numbers - they are only
 * rejected later, by `BigInt()`, as an unhandled RangeError and a 500. A price
 * that big is a typo or an attack either way, so it is refused at the edge
 * with a message rather than in the middle of writing a bill.
 */
export const rupeeAmount = (
  opts: { min?: number; minMessage?: string; max?: number } = {},
) =>
  z.coerce
    .number()
    .finite('Enter a real amount.')
    .min(opts.min ?? 0, opts.minMessage ?? 'Cannot be negative.')
    .max(opts.max ?? MAX_RUPEES, `Cannot exceed ₹${(opts.max ?? MAX_RUPEES).toLocaleString('en-IN')}.`)

/**
 * Rupees in the UI, integer paise in the database (docs/03 §4.1).
 *
 * Refuses a value it cannot convert instead of letting `BigInt()` raise a bare
 * RangeError from somewhere deep in a transaction. Schemas above stop this at
 * the edge; this is the second line of defence, and it names the field.
 */
export const rupeesToPaise = (rupees: number): bigint => {
  if (!Number.isFinite(rupees)) {
    throw new RangeError(`Not a usable amount: ${rupees}.`)
  }
  if (Math.abs(rupees) > MAX_RUPEES) {
    throw new RangeError(`Amount out of range: ${rupees}.`)
  }
  return BigInt(Math.trunc(rupees * 100 + (rupees >= 0 ? 0.5 : -0.5)))
}

/**
 * What a user typed into a money box, as a number safe to compute with.
 *
 * The till recalculates its totals on every keystroke, so this runs inside a
 * render. Anything that is not a usable figure - blank, "abc", "1e400",
 * "Infinity" - becomes 0 rather than throwing: a half-typed number must not
 * take the screen down, and the real validation happens on the way out.
 */
export const parseRupees = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isFinite(n)) return 0
  if (n > MAX_RUPEES) return MAX_RUPEES
  if (n < -MAX_RUPEES) return -MAX_RUPEES
  return n
}

/** The most units one line may carry. Matches the purchase line rule. */
export const MAX_QUANTITY = 9999

/**
 * A whole count typed into a quantity box, clamped to something sane.
 *
 * Same reasoning as `parseRupees`: `computeLine` throws on a fractional or
 * infinite quantity, and it is called from a render. "1.5" and "1e400" are
 * both things a keyboard can produce.
 */
export const parseQuantity = (value: unknown, opts: { min?: number; max?: number } = {}): number => {
  const min = opts.min ?? 1
  const max = opts.max ?? MAX_QUANTITY
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

export const paiseToRupees = (paise: bigint | number | null | undefined): number =>
  paise == null ? 0 : Number(paise) / 100

const optionalMoney = z.union([rupeeAmount(), z.literal('')]).optional()

export const MAIN_TYPES = ['NEW', 'USED', 'ER', 'ACT', 'GLOBAL'] as const

export const categorySchema = z.object({
  name: z.string().trim().min(2, 'Name is required.').max(60),
  isSerialised: z.boolean().default(false),
  /** IMEI for phones, SERIAL for laptops and other electronics. */
  identifierType: z.enum(['IMEI', 'SERIAL', 'NONE']).default('NONE'),
  /** Whether a phone also carries the serial printed on its box. */
  capturesSerial: z.boolean().default(false),
})

export const brandSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(60),
})

export const productSchema = z.object({
  name: z.string().trim().min(2, 'Name is required.').max(160),
  categoryId: z.coerce.number().int().positive('Choose a category.'),
  brandId: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? null : v),
    z.coerce.number().int().positive().nullable(),
  ),
  model: optionalText(80),
  sku: optionalText(40),
  barcode: optionalText(60),
  /**
   * HSN (goods) or SAC (services). GST allows 4, 6 or 8 digits depending on
   * turnover, so the length is not pinned - only that it is digits.
   */
  hsnCode: z
    .string()
    .trim()
    .regex(/^[0-9]{4,8}$/, 'HSN is 4 to 8 digits.')
    .optional()
    .or(z.literal('')),
  description: optionalText(500),
  purchasePrice: optionalMoney,
  sellingPrice: optionalMoney,
  taxRateId: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? null : v),
    z.coerce.number().int().positive().nullable(),
  ),
  defaultSupplierId: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? null : v),
    z.coerce.number().int().positive().nullable(),
  ),
})

/**
 * A device carries a LIST of identifiers (PRD FR-4.8) — IMEIs for a phone, a
 * serial number for a laptop or speaker. The form may render one input today,
 * but the payload is always an array, so raising `imeiSlots` never requires a
 * schema change. Format is validated server-side against the category's type.
 */
export const deviceSchema = z
  .object({
    productId: z.coerce.number().int().positive('Choose a product.'),
    identifiers: z
      .array(z.string().trim())
      .min(1, 'At least one identifier is required.')
      .transform((list) => list.map((i) => i.trim()).filter(Boolean)),
    /** Optional, and only where the category asks for one beside the IMEI. */
    serialNumber: optionalText(50),
    mainType: z.enum(MAIN_TYPES, { message: 'Choose a main type.' }),
    isNewCut: z.boolean().default(false),
    newCutNotes: optionalText(300),
    variant: optionalText(60),
    ram: optionalText(20),
    storage: optionalText(20),
    colour: optionalText(40),
    /** Whole percent, 1-100. Blank for sealed NEW stock. */
    batteryHealth: z
      .union([z.coerce.number().int().min(1, 'Between 1 and 100.').max(100, 'Between 1 and 100.'), z.literal('')])
      .optional(),
    purchasePrice: optionalMoney,
    sellingPrice: optionalMoney,
    taxRateId: z.preprocess(
      (v) => (v === '' || v === undefined || v === null ? null : v),
      z.coerce.number().int().positive().nullable(),
    ),
    supplierId: z.preprocess(
      (v) => (v === '' || v === undefined || v === null ? null : v),
      z.coerce.number().int().positive().nullable(),
    ),
    purchaseDate: z.string().trim().optional().or(z.literal('')),
    warrantyMonths: z
      .union([z.coerce.number().int().min(0).max(120), z.literal('')])
      .optional(),
    /** PRD FR-29.1. Who honours it — the brand, the shop, or a third party. */
    warrantyProvider: optionalText(60),
    branchId: z.coerce.number().int().positive('Choose a branch.'),
  })
  .refine((v) => v.identifiers.length > 0, {
    message: 'At least one identifier is required.',
    path: ['identifiers'],
  })
  // PRD FR-5.2 — the rule the whole classification hangs on.
  .refine((v) => !v.isNewCut || v.mainType === 'GLOBAL', {
    message: 'NEW CUT applies only to GLOBAL devices.',
    path: ['isNewCut'],
  })

export const deviceQuerySchema = z.object({
  search: z.string().trim().max(60).optional(),
  branchId: z.coerce.number().int().positive().optional(),
  mainType: z.enum(MAIN_TYPES).optional(),
  globalVariant: z.enum(['NEW_CUT', 'PLAIN']).optional(),
  status: z
    .enum([
      'IN_STOCK',
      'RESERVED',
      'SOLD',
      'SOLD_PENDING_IMPORT',
      'RETURNED',
      'DAMAGED',
      'LOST',
      'REPAIR',
      'IN_TRANSIT',
    ])
    .optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  brandId: z.coerce.number().int().positive().optional(),
  supplierId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

export const productQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  brandId: z.coerce.number().int().positive().optional(),
  branchId: z.coerce.number().int().positive().optional(),
  serialised: queryBoolean.optional(),
  includeInactive: queryBoolean.default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

export const minQuantitySchema = z.object({
  productId: z.coerce.number().int().positive(),
  branchId: z.coerce.number().int().positive(),
  minQuantity: z.coerce.number().int().min(0).max(100000),
})

/* ============================================================ M3 schemas === */

/**
 * One purchase line. A serialised line carries its identifiers and the
 * classification that every unit it creates will inherit; a counted line
 * carries neither. The server re-checks all of this against the product.
 */
export const purchaseLineSchema = z.object({
  productId: z.coerce.number().int().positive('Choose a product.'),
  quantity: z.coerce.number().int().min(1, 'At least 1.').max(9999),
  unitCost: z.coerce.number().min(0, 'Cannot be negative.').max(100_000_000),
  discount: z.coerce.number().min(0).max(100_000_000).default(0),
  taxRateId: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? null : v),
    z.coerce.number().int().positive().nullable(),
  ),
  identifiers: z.array(z.string().trim()).default([]),
  /**
   * The same units with their own specs. A batch is usually uniform, so the
   * line carries the specs and a unit only says how it differs.
   */
  units: z
    .array(
      z.object({
        identifier: z.string().trim(),
        /** Only where the category asks for one alongside the IMEI. */
        serialNumber: optionalText(50),
        variant: optionalText(60),
        ram: optionalText(30),
        storage: optionalText(30),
        colour: optionalText(40),
        batteryHealthPercent: z.preprocess(
          (v) => (v === '' || v === undefined || v === null ? null : v),
          z.coerce.number().int().min(0).max(100).nullable(),
        ),
      }),
    )
    .default([]),
  mainType: z.enum(MAIN_TYPES).optional(),
  isNewCut: z.boolean().default(false),
  newCutNotes: optionalText(300),
  /** Line specs, stamped onto every unit that does not override them. */
  variant: optionalText(60),
  ram: optionalText(30),
  storage: optionalText(30),
  colour: optionalText(40),
  /**
   * How long the cover runs. Kept for the importer and for anything already
   * sending months; the purchase screen now asks for the date instead.
   */
  warrantyMonths: z
    .union([z.coerce.number().int().min(0).max(120), z.literal('')])
    .optional(),
  /**
   * The day cover ends, as the shop was told it (PRD FR-29.1).
   *
   * A period only answers the question after arithmetic, and the arithmetic
   * needs a start date the buyer has to agree with. A used handset is sold
   * with "covered until the 14th", so that is what is recorded. Where both
   * arrive, this wins - it is the figure a person actually stated.
   */
  warrantyUntil: z.string().trim().optional().or(z.literal('')),
  warrantyProvider: optionalText(60),
  /** What it will be sold for. Blank leaves the product's list price to stand. */
  sellingPrice: z.union([z.coerce.number().min(0).max(100_000_000), z.literal('')]).optional(),
})

export const purchaseSchema = z.object({
  supplierId: z.coerce.number().int().positive('Choose a supplier.'),
  branchId: z.coerce.number().int().positive('Choose a branch.'),
  /** The date on the supplier's bill. */
  purchaseDate: z.string().trim().optional().or(z.literal('')),
  /** The day the goods reached the shop; falls back to the bill's date. */
  arrivedAt: z.string().trim().optional().or(z.literal('')),
  supplierInvoiceNumber: optionalText(60),
  notes: optionalText(1000),
  lines: z.array(purchaseLineSchema).min(1, 'Add at least one line.'),
  /**
   * Settling the bill as it is entered. Absent means unpaid, which is what
   * every purchase was until now.
   */
  payment: z
    .object({
      paymentMethodId: z.coerce.number().int().positive('Choose a payment method.'),
      /*
       * Blank is the whole bill, as the server totals it - not as the form did.
       *
       * The empty literal comes FIRST on purpose, and this cannot use
       * `optionalMoney`. That puts `z.coerce.number()` first, which happily
       * turns '' into 0 and passes `min(0)` - so a blank box arrived as a
       * zero-rupee payment and the whole purchase was refused with "A payment
       * must be more than zero." A union returns its first matching branch.
       */
      amount: z
        .union([
          z.literal(''),
          rupeeAmount({ min: 0.01, minMessage: 'A payment must be more than zero.' }),
        ])
        .optional(),
      reference: optionalText(80),
    })
    .optional(),
})

export const reversePurchaseSchema = z.object({
  reason: z.string().trim().min(3, 'Give a reason — it goes on the audit trail.').max(300),
})

export const supplierPaymentSchema = z.object({
  supplierId: z.coerce.number().int().positive('Choose a supplier.'),
  branchId: z.coerce.number().int().positive('Choose a branch.'),
  paymentMethodId: z.coerce.number().int().positive('Choose a payment method.'),
  amount: z.coerce.number().positive('Enter an amount.').max(100_000_000),
  paidOn: z.string().trim().optional().or(z.literal('')),
  reference: optionalText(80),
  notes: optionalText(500),
  /** Empty means allocate oldest-first. */
  allocations: z
    .array(
      z.object({
        purchaseId: z.coerce.number().int().positive(),
        amount: rupeeAmount(),
      }),
    )
    .default([]),
})

export const voidPaymentSchema = z.object({
  reason: z.string().trim().min(3, 'Give a reason.').max(300),
})

export const purchaseQuerySchema = z.object({
  search: z.string().trim().max(80).optional(),
  supplierId: z.coerce.number().int().positive().optional(),
  branchId: z.coerce.number().int().positive().optional(),
  status: z.enum(['DRAFT', 'CONFIRMED', 'REVERSED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})
