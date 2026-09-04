import { z } from 'zod'

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
  currency: z.string().trim().length(3).default('INR'),
  timezone: z.string().trim().min(3).default('Asia/Kolkata'),
  pricesIncludeTax: z.boolean().default(true),
  invoicePrefix: z.string().trim().min(1).max(10).default('INV'),
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
  code: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .regex(/^[A-Z0-9_]+$/, 'Use capitals, digits and underscores only.'),
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
  notes: optionalText(1000),
})

export const partyStatusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) })

export const partyQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  includeInactive: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

/** Percent <-> basis points. The UI talks percent; the database stores integers. */
export const toBasisPoints = (percent: number): number => Math.trunc(percent * 100 + 0.5)
export const toPercent = (basisPoints: number): number => basisPoints / 100

/* ============================================================ M2 schemas === */

/** Rupees in the UI, integer paise in the database (docs/03 §4.1). */
export const rupeesToPaise = (rupees: number): bigint =>
  BigInt(Math.trunc(rupees * 100 + (rupees >= 0 ? 0.5 : -0.5)))

export const paiseToRupees = (paise: bigint | number | null | undefined): number =>
  paise == null ? 0 : Number(paise) / 100

const optionalMoney = z
  .union([z.coerce.number().min(0, 'Cannot be negative.').max(100_000_000), z.literal('')])
  .optional()

export const MAIN_TYPES = ['NEW', 'USED', 'ER', 'ACT', 'GLOBAL'] as const

export const categorySchema = z.object({
  name: z.string().trim().min(2, 'Name is required.').max(60),
  isSerialised: z.boolean().default(false),
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
 * A device carries a LIST of IMEIs (PRD FR-4.8). The form may render one
 * input today, but the payload is always an array — raising `imeiSlots` must
 * never require a schema change.
 */
export const deviceSchema = z
  .object({
    productId: z.coerce.number().int().positive('Choose a product.'),
    imeis: z
      .array(z.string().trim())
      .min(1, 'At least one IMEI is required.')
      .transform((list) => list.map((i) => i.replace(/[\s-]/g, '')).filter(Boolean)),
    mainType: z.enum(MAIN_TYPES, { message: 'Choose a main type.' }),
    isNewCut: z.boolean().default(false),
    newCutNotes: optionalText(300),
    variant: optionalText(60),
    ram: optionalText(20),
    storage: optionalText(20),
    colour: optionalText(40),
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
    branchId: z.coerce.number().int().positive('Choose a branch.'),
  })
  .refine((v) => v.imeis.length > 0, {
    message: 'At least one IMEI is required.',
    path: ['imeis'],
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
  serialised: z.coerce.boolean().optional(),
  includeInactive: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

export const minQuantitySchema = z.object({
  productId: z.coerce.number().int().positive(),
  branchId: z.coerce.number().int().positive(),
  minQuantity: z.coerce.number().int().min(0).max(100000),
})
