'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * The bill being built at the counter (docs/03 §5, "Where state lives").
 *
 * This is the one piece of genuinely shared client state in the app: the
 * search box, the cart, the totals panel and the payment panel all read and
 * write it. Server data - stock, prices, customers - is never copied in here.
 *
 * Persisted to the browser, including the idempotency key, so a dropped
 * connection or an accidental refresh cannot lose a half-built bill and
 * re-submitting cannot bill the customer twice (PRD NFR §9.3).
 */

export type CartLine = {
  /** Stable per line, so React keys survive edits. */
  key: string
  productId: number
  productName: string
  /** Set only for a serialised line - the exact handset. */
  deviceId: number | null
  identifier: string | null
  mainType: string | null
  isNewCut: boolean
  quantity: number
  /** Rupees as typed. Converted to paise once, at submit. */
  unitPrice: string
  discount: string
  taxRateId: number | null
  taxRateBasisPoints: number
  /** Only for a counted line, so the till can warn before overselling. */
  availableQuantity: number | null
}

export type CartPayment = {
  key: string
  paymentMethodId: number
  methodName: string
  amount: string
  reference: string
}

type CartState = {
  branchId: number | null
  customerId: number | null
  customerName: string | null
  /**
   * PRD FR-9.2. A trade-in accepted against this bill. Held here rather than
   * in a second store so a reload recovers the whole counter state at once -
   * losing the trade-in but keeping the cart would be worse than losing both.
   */
  tradeIn: { id: number; deviceId: number; identifier: string; valuePaise: string } | null
  /** PRD FR-7.2. Only used when the bill leaves unpaid. */
  dueDate: string | null
  creditNotes: string
  lines: CartLine[]
  payments: CartPayment[]
  notes: string
  /** Generated once per bill and kept until the bill is saved. */
  idempotencyKey: string

  setBranch: (branchId: number | null) => void
  setCustomer: (id: number | null, name: string | null) => void
  setCredit: (dueDate: string | null, creditNotes: string) => void
  setTradeIn: (tradeIn: CartState['tradeIn']) => void
  addLine: (line: Omit<CartLine, 'key'>) => { added: boolean; reason?: string }
  updateLine: (key: string, patch: Partial<CartLine>) => void
  removeLine: (key: string) => void
  setPayments: (payments: CartPayment[]) => void
  setNotes: (notes: string) => void
  clear: () => void
}

let counter = 0
const nextKey = (prefix: string) => `${prefix}${Date.now().toString(36)}${counter++}`

function newIdempotencyKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const empty = () => ({
  branchId: null,
  customerId: null,
  customerName: null,
  tradeIn: null,
  dueDate: null,
  creditNotes: '',
  lines: [] as CartLine[],
  payments: [] as CartPayment[],
  notes: '',
  idempotencyKey: newIdempotencyKey(),
})

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      ...empty(),

      setBranch: (branchId) => set({ branchId }),
      setCustomer: (customerId, customerName) => set({ customerId, customerName }),
      setCredit: (dueDate, creditNotes) => set({ dueDate, creditNotes }),
      setTradeIn: (tradeIn) => set({ tradeIn }),

      addLine: (line) => {
        const state = get()

        // The same handset cannot be on the bill twice - there is only one of
        // it. Scanning a second time is a mistake worth naming.
        if (line.deviceId && state.lines.some((l) => l.deviceId === line.deviceId)) {
          return { added: false, reason: `${line.identifier ?? 'That device'} is already on this bill.` }
        }

        // A counted product scanned again just increments, which is what the
        // person at the till expects.
        if (!line.deviceId) {
          const existing = state.lines.find((l) => l.productId === line.productId && !l.deviceId)
          if (existing) {
            set({
              lines: state.lines.map((l) =>
                l.key === existing.key ? { ...l, quantity: l.quantity + line.quantity } : l,
              ),
            })
            return { added: true }
          }
        }

        set({ lines: [...state.lines, { ...line, key: nextKey('l') }] })
        return { added: true }
      },

      updateLine: (key, patch) =>
        set({ lines: get().lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }),

      removeLine: (key) => set({ lines: get().lines.filter((l) => l.key !== key) }),
      setPayments: (payments) => set({ payments }),
      setNotes: (notes) => set({ notes }),

      // A fresh key too: the next bill is a different bill.
      clear: () => set(empty()),
    }),
    {
      name: 'ecity-cart',
      version: 1,
      /*
       * Everything a half-built bill needs to survive a refresh.
       *
       * The trade-in, the due date and the credit note used to be left out.
       * That is worse than not persisting at all: the reload brought the cart
       * back but not the handset taken in part-exchange, so the bill was
       * completed at full price, the customer was charged for a phone they had
       * already handed over, and the trade-in row was left unattached - free to
       * be put against somebody else's bill.
       */
      partialize: (s) => ({
        branchId: s.branchId,
        customerId: s.customerId,
        customerName: s.customerName,
        tradeIn: s.tradeIn,
        dueDate: s.dueDate,
        creditNotes: s.creditNotes,
        lines: s.lines,
        payments: s.payments,
        notes: s.notes,
        idempotencyKey: s.idempotencyKey,
      }),
    },
  ),
)
