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
