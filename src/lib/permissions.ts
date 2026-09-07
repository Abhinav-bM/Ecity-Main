/**
 * The permission catalogue.
 *
 * This file is the single source of truth. `db:seed` writes these rows into
 * the `permission` table, so code and database can never drift.
 *
 * Naming: <area>.<action>. Keep areas aligned with the module breakdown so
 * later modules (M1-M14) add to this list rather than reshaping it.
 */
export const PERMISSIONS = {
  // --- M0 foundations ---
  'user.view': { group: 'Users & access', label: 'View users' },
  'user.manage': { group: 'Users & access', label: 'Create and edit users' },
  'role.view': { group: 'Users & access', label: 'View roles' },
  'role.manage': { group: 'Users & access', label: 'Create and edit roles' },
  'audit.view': { group: 'Users & access', label: 'View the audit log' },
  'session.revoke': { group: 'Users & access', label: 'Revoke other users’ sessions' },

  // --- branch scope ---
  'branch.view': { group: 'Branches', label: 'View branches' },
  'branch.manage': { group: 'Branches', label: 'Create and edit branches' },
  'branch.view_all': {
    group: 'Branches',
    label: 'View all branches (consolidated)',
    description: 'Bypasses per-branch assignment. Owner/Admin only.',
  },

  // --- M1 master data ---
  'business.view': { group: 'Setup', label: 'View business settings' },
  'business.manage': {
    group: 'Setup',
    label: 'Edit business profile, tax and payment settings',
    description: 'Covers the business profile, tax rates, payment methods and expense categories.',
  },
  'customer.view': { group: 'Master data', label: 'View customers' },
  'customer.manage': { group: 'Master data', label: 'Create and edit customers' },
  'supplier.view': { group: 'Master data', label: 'View suppliers' },
  'supplier.manage': {
    group: 'Master data',
    label: 'Create and edit suppliers',
    description: 'Suppliers are shared across every branch.',
  },
  'attachment.upload': { group: 'Master data', label: 'Upload files and photos' },

  // --- M2 inventory ---
  'product.view': { group: 'Inventory', label: 'View products and categories' },
  'product.manage': { group: 'Inventory', label: 'Create and edit products' },
  'inventory.view': { group: 'Inventory', label: 'View stock and devices' },
  'inventory.view_cost': {
    group: 'Inventory',
    label: 'See purchase prices and margins',
    description: 'Counter staff normally should not see what stock cost.',
  },
  // --- M3 purchases ---
  'purchase.view': { group: 'Purchases', label: 'View purchases' },
  'purchase.manage': { group: 'Purchases', label: 'Record purchases' },
  'purchase.reverse': {
    group: 'Purchases',
    label: 'Reverse a purchase',
    description: 'Undoes stock and the supplier debt. Blocked once any unit has moved on.',
  },
  'return.view': { group: 'Sales', label: 'View returns' },
  'return.create': { group: 'Sales', label: 'Take a return' },
  'return.inspect': { group: 'Sales', label: 'Classify a returned device' },
  'return.refund': { group: 'Sales', label: 'Refund money on a return' },
  'device.edit': { group: 'Inventory', label: 'Correct a device after it is created' },
  'customer_payment.view': { group: 'Sales', label: 'View customer dues and receipts' },
  'customer_payment.manage': { group: 'Sales', label: 'Collect customer payments' },
  'customer_payment.void': { group: 'Sales', label: 'Void a customer receipt' },
  'supplier_payment.view': { group: 'Purchases', label: 'View supplier payments and dues' },
  'supplier_payment.manage': { group: 'Purchases', label: 'Pay suppliers' },

  // --- M4 sales ---
  'sale.view': { group: 'Sales', label: 'View sales and invoices' },
  'sale.create': { group: 'Sales', label: 'Bill a customer' },
  'sale.discount': { group: 'Sales', label: 'Give a discount on a bill' },

  'device.manage': {
    group: 'Inventory',
    label: 'Create and edit devices (IMEI)',
    description: 'Registering handsets outside a purchase. Most devices arrive via M3.',
  },

  // --- M7 money, cash drawer and daily closing ---
  'expense.view': { group: 'Money', label: 'View expenses' },
  'expense.manage': { group: 'Money', label: 'Record expenses' },
  'expense.void': {
    group: 'Money',
    label: 'Void an expense',
    description: 'An expense is never edited or deleted — it is voided, and that is recorded.',
  },
  'cash.view': { group: 'Money', label: 'View the cash drawer' },
  'account.view': { group: 'Money', label: 'View bank and UPI accounts' },
  'account.manage': {
    group: 'Money',
    label: 'Create accounts, transfer and reconcile',
    description: 'Adding accounts, moving money between them, and confirming a statement balance.',
  },
  'closing.view': { group: 'Money', label: 'View daily closings' },
  'closing.create': { group: 'Money', label: 'Close the day' },
  'closing.correct': {
    group: 'Money',
    label: 'Post into a day that is already closed',
    description:
      'PRD OQ-5. The closing itself is never rewritten — the correction is a new entry, and the difference from the signed figures stays visible.',
  },
  'closing.void': {
    group: 'Money',
    label: 'Void a closing and reopen the day',
    description:
      'For a day closed too early. Refused once a later day for that branch has been closed.',
  },
  // --- M8 transfers and adjustments ---
  'transfer.view': { group: 'Inventory', label: 'View branch transfers' },
  'transfer.request': { group: 'Inventory', label: 'Request a transfer' },
  'transfer.approve': {
    group: 'Inventory',
    label: 'Approve and dispatch a transfer',
    description: 'Sending stock out of a branch is a manager’s decision.',
  },
  'transfer.receive': { group: 'Inventory', label: 'Receive a transfer' },
  'transfer.cancel': { group: 'Inventory', label: 'Cancel a transfer before receipt' },
  'adjustment.view': { group: 'Inventory', label: 'View stock adjustments' },
  'adjustment.create': {
    group: 'Inventory',
    label: 'Adjust stock',
    description:
      'Correcting the system to match the shelf. Always recorded with a reason and never edited.',
  },

  'purchase.edit': {
    group: 'Purchases',
    label: 'Correct a purchase’s invoice number, date or notes',
    description: 'Lines, quantities and costs stay uneditable — reversal handles those.',
  },
} as const satisfies Record<string, { group: string; label: string; description?: string }>

export type PermissionCode = keyof typeof PERMISSIONS

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionCode[]

export function isPermissionCode(value: string): value is PermissionCode {
  return Object.hasOwn(PERMISSIONS, value)
}

/**
 * Seed roles. Admin gets everything; Manager runs a branch; Staff sells.
 * These are starting points - an Admin can edit any of them in the UI.
 */
export const SYSTEM_ROLES = {
  ADMIN: {
    name: 'Admin / Owner',
    description: 'Full access to every branch and every setting.',
    permissions: ALL_PERMISSIONS,
  },
  MANAGER: {
    name: 'Branch Manager',
    description: 'Full operations for the branches they are assigned to.',
    permissions: [
      'user.view',
      'audit.view',
      'branch.view',
      'business.view',
      'customer.view',
      'customer.manage',
      'supplier.view',
      'supplier.manage',
      'attachment.upload',
      'product.view',
      'product.manage',
      'inventory.view',
      'inventory.view_cost',
      'device.manage',
      'purchase.view',
      'purchase.manage',
      'sale.view',
      'sale.create',
      'sale.discount',
      'return.view',
      'return.create',
      'return.inspect',
      'return.refund',
      'device.edit',
      'customer_payment.view',
      'customer_payment.manage',
      'customer_payment.void',
      'supplier_payment.view',
      'supplier_payment.manage',
      'purchase.edit',
      'expense.view',
      'expense.manage',
      'expense.void',
      'cash.view',
      'account.view',
      'account.manage',
      'closing.view',
      'closing.create',
      'transfer.view',
      'transfer.request',
      'transfer.approve',
      'transfer.receive',
      'transfer.cancel',
      'adjustment.view',
      'adjustment.create',
    ],
  },
  STAFF: {
    name: 'Staff / Salesperson',
    description: 'Counter staff. No cost prices, no settings, no deletions.',
    permissions: [
      'branch.view',
      'customer.view',
      'customer.manage',
      'supplier.view',
      'product.view',
      // Staff can see what is in stock, but not what it cost.
      'inventory.view',
      // Billing is the counter's whole job.
      'sale.view',
      'sale.create',
      /*
       * Counter staff take money against old bills - a customer walking in to
       * clear their tab is the counter's job. They cannot VOID a receipt,
       * which would erase money already recorded as received.
       */
      'customer_payment.view',
      'customer_payment.manage',
      /*
       * The counter takes returns, but three decisions are not theirs:
       * releasing a handset back to sellable (return.inspect), handing money
       * back (return.refund), and correcting a device record (device.edit).
       */
      'return.view',
      'return.create',
      /*
       * Staff see the drawer they are responsible for, and the expenses that
       * explain it - but they do not RECORD one. Letting the person who counts
       * the till also book money out of it is how a shortage gets papered over
       * ("I spent it on transport"), which is the same reasoning that keeps a
       * closed day uneditable (PRD OQ-5).
       */
      'expense.view',
      'cash.view',
      /*
       * Staff ask for stock and take delivery of it - both are counter work.
       * Approving a transfer out of a branch, cancelling one, and adjusting
       * stock to match the shelf are decisions about what the shop owns, so
       * they stay with a manager.
       */
      'transfer.view',
      'transfer.request',
      'transfer.receive',
      'adjustment.view',
    ],
  },
} as const satisfies Record<
  string,
  { name: string; description: string; permissions: readonly PermissionCode[] }
>

export type SystemRoleCode = keyof typeof SYSTEM_ROLES
