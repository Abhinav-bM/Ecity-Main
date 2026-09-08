import { z } from 'zod'
import { auditContextFromRequest } from '@/server/db/audit'
import { createImportJob, listImports } from '@/server/services/import.service'
import { route } from '@/server/http'

const KINDS = [
  'PRODUCTS',
  'DEVICES',
  'CUSTOMERS',
  'SUPPLIERS',
  'OPENING_STOCK',
  'OPENING_CUSTOMER_DUES',
  'OPENING_SUPPLIER_DUES',
] as const

/**
 * PRD FR-33.1. Upload and stage — nothing is created yet.
 *
 * The file arrives in the JSON body rather than as multipart: a shop's whole
 * history is small enough to send in one request. A CSV goes as text; a
 * spreadsheet goes base64, which costs a third more bytes and saves the
 * person a conversion at the one moment the data has to be right.
 */
const schema = z.object({
  kind: z.enum(KINDS),
  fileName: z.string().trim().min(1).max(200),
  content: z.string().min(1, 'That file is empty.').max(12_000_000),
  /** A spreadsheet is bytes, so it arrives base64-encoded. */
  encoding: z.enum(['text', 'base64']).default('text'),
  branchId: z.coerce.number().int().positive().nullable().optional(),
})

export const GET = route({ permission: 'product.manage', branchFrom: 'none' }, ({ user }) =>
  listImports(user),
)

export const POST = route(
  { permission: 'product.manage', branchFrom: 'none', schema },
  async ({ user, body }) => {
    const audit = await auditContextFromRequest(user, user.businessId, body.branchId ?? null)
    return createImportJob(user, audit, {
      kind: body.kind,
      fileName: body.fileName,
      content: body.content,
      encoding: body.encoding,
      branchId: body.branchId ?? null,
    })
  },
)
