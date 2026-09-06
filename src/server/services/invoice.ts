import type { InvoiceData } from '@/components/invoice'
import { stateName } from '@/lib/gst'
import type { AuthUser } from '@/server/auth/permissions'
import { getBusiness } from '@/server/services/business.service'
import { getSale } from '@/server/services/sale.service'

/**
 * Assemble the invoice for one sale.
 *
 * Both the on-screen invoice and the PDF download read this, so the printed
 * copy and the downloaded copy cannot drift apart (PRD FR-26.1, FR-26.4).
 */
export async function getInvoiceData(actor: AuthUser, saleId: number): Promise<InvoiceData> {
  const [detail, business] = await Promise.all([getSale(actor, saleId), getBusiness(actor)])

  return {
    invoiceNumber: detail.sale.invoiceNumber,
    soldAt: detail.sale.soldAt,
    pricesIncludedTax: detail.sale.pricesIncludedTax,
    business: {
      name: business.name,
      addressLine1: business.addressLine1,
      city: business.city,
      phone: business.phone,
      gstin: business.gstin,
    },
    branch: { name: detail.branchName, code: detail.branchCode },
    gst: {
      placeOfSupplyCode: detail.sale.placeOfSupplyCode,
      placeOfSupplyName: stateName(detail.sale.placeOfSupplyCode),
      isInterState: detail.sale.isInterState,
      cgstPaise: detail.sale.cgstPaise,
      sgstPaise: detail.sale.sgstPaise,
      igstPaise: detail.sale.igstPaise,
      // Summed from the stored line figures, so the statutory summary can
      // never disagree with the body of the invoice it sits under.
      hsnSummary: hsnSummary(detail.items),
    },
    customer: detail.sale.customerId
      ? {
          name: detail.customerName ?? '',
          phone: detail.customerPhone,
          gstin: detail.customerGstin,
        }
      : null,
    items: detail.items,
    payments: detail.payments,
    subtotalPaise: detail.sale.subtotalPaise,
    discountPaise: detail.sale.discountPaise,
    taxablePaise: detail.sale.taxablePaise,
    taxPaise: detail.sale.taxPaise,
    totalPaise: detail.sale.totalPaise,
    paidPaise: detail.paidPaise,
  }
}


/**
 * HSN-wise summary, required on a statutory tax invoice.
 *
 * Keyed by HSN *and* rate: the same code can appear at two rates on one bill,
 * and GSTR-1 expects those as separate rows.
 */
function hsnSummary(
  items: {
    hsnCodeSnapshot: string | null
    taxRateBasisPoints: number
    quantity: number
    taxablePaise: bigint
    taxPaise: bigint
    cgstPaise: bigint
    sgstPaise: bigint
    igstPaise: bigint
  }[],
) {
  const byKey = new Map<
    string,
    {
      hsnCode: string
      rateBasisPoints: number
      quantity: number
      taxablePaise: bigint
      taxPaise: bigint
      cgstPaise: bigint
      sgstPaise: bigint
      igstPaise: bigint
    }
  >()

  for (const item of items) {
    if (!item.hsnCodeSnapshot) continue
    const key = `${item.hsnCodeSnapshot}|${item.taxRateBasisPoints}`
    const row = byKey.get(key) ?? {
      hsnCode: item.hsnCodeSnapshot,
      rateBasisPoints: item.taxRateBasisPoints,
      quantity: 0,
      taxablePaise: 0n,
      taxPaise: 0n,
      cgstPaise: 0n,
      sgstPaise: 0n,
      igstPaise: 0n,
    }
    row.quantity += item.quantity
    row.taxablePaise += item.taxablePaise
    row.taxPaise += item.taxPaise
    row.cgstPaise += item.cgstPaise
    row.sgstPaise += item.sgstPaise
    row.igstPaise += item.igstPaise
    byKey.set(key, row)
  }

  return [...byKey.values()].sort(
    (a, b) => a.hsnCode.localeCompare(b.hsnCode) || a.rateBasisPoints - b.rateBasisPoints,
  )
}
