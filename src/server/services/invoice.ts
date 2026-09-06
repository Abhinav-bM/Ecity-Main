import type { InvoiceData } from '@/components/invoice'
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
