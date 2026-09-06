import { describe, expect, it } from 'vitest'
import type { InvoiceData } from '@/components/invoice'
import { renderInvoicePdf } from '@/server/pdf/invoice-pdf'

function invoice(overrides: Partial<InvoiceData> = {}): InvoiceData {
  return {
    invoiceNumber: 'INV/MAIN/2026/000123',
    soldAt: new Date('2026-09-01T10:30:00Z'),
    pricesIncludedTax: true,
    business: {
      name: 'ECITY Mobiles',
      addressLine1: 'Main Road',
      city: 'Kochi',
      phone: '9876543210',
      gstin: '32AAAAA0000A1Z5',
    },
    branch: { name: 'Main Branch', code: 'MAIN' },
    gst: {
      placeOfSupplyCode: '32',
      placeOfSupplyName: 'Kerala',
      isInterState: false,
      cgstPaise: 572026n,
      sgstPaise: 572027n,
      igstPaise: 0n,
      hsnSummary: [
        {
          hsnCode: '8517',
          rateBasisPoints: 1800,
          quantity: 1,
          taxablePaise: 6355847n,
          taxPaise: 1144053n,
          cgstPaise: 572026n,
          sgstPaise: 572027n,
          igstPaise: 0n,
        },
      ],
    },
    customer: { name: 'Ramesh K', phone: '9000000000', gstin: null },
    items: [
      {
        id: 1,
        description: 'iPhone 15 128GB Black',
        identifierSnapshot: '355123456789012',
        hsnCodeSnapshot: '8517',
        mainTypeSnapshot: 'NEW',
        isNewCutSnapshot: false,
        quantity: 1,
        unitPricePaise: 7499900n,
        discountPaise: 0n,
        taxRateBasisPoints: 1800,
        taxablePaise: 6355847n,
        taxPaise: 1144053n,
        cgstPaise: 572026n,
        sgstPaise: 572027n,
        igstPaise: 0n,
        lineTotalPaise: 7499900n,
      },
    ],
    payments: [{ id: 1, methodName: 'Cash', amountPaise: 7499900n, reference: null }],
    subtotalPaise: 7499900n,
    discountPaise: 0n,
    taxablePaise: 6355847n,
    taxPaise: 1144053n,
    totalPaise: 7499900n,
    paidPaise: 7499900n,
    ...overrides,
  }
}

describe('invoice PDF', () => {
  it('renders a valid PDF file', async () => {
    const buffer = await renderInvoicePdf(invoice())
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(buffer.byteLength).toBeGreaterThan(1000)
  }, 30_000)

  it('renders a walk-in credit sale with a balance due', async () => {
    const buffer = await renderInvoicePdf(
      invoice({ customer: null, payments: [], paidPaise: 0n }),
    )
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  }, 30_000)

  it('renders a long multi-line bill across pages', async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({
      id: i + 1,
      description: `Tempered glass pack ${i + 1}`,
      identifierSnapshot: null,
      hsnCodeSnapshot: '3923',
      mainTypeSnapshot: null,
      isNewCutSnapshot: false,
      quantity: 2,
      unitPricePaise: 9900n,
      discountPaise: 0n,
      taxRateBasisPoints: 1800,
      taxablePaise: 16780n,
      taxPaise: 3020n,
      cgstPaise: 1510n,
      sgstPaise: 1510n,
      igstPaise: 0n,
      lineTotalPaise: 19800n,
    }))
    const buffer = await renderInvoicePdf(invoice({ items }))
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  }, 30_000)
})

describe('statutory GST on the PDF (OQ-4)', () => {
  it('renders an inter-state invoice with IGST', async () => {
    const buffer = await renderInvoicePdf(
      invoice({
        gst: {
          placeOfSupplyCode: '29',
          placeOfSupplyName: 'Karnataka',
          isInterState: true,
          cgstPaise: 0n,
          sgstPaise: 0n,
          igstPaise: 1144053n,
          hsnSummary: [
            {
              hsnCode: '8517',
              rateBasisPoints: 1800,
              quantity: 1,
              taxablePaise: 6355847n,
              taxPaise: 1144053n,
              cgstPaise: 0n,
              sgstPaise: 0n,
              igstPaise: 1144053n,
            },
          ],
        },
      }),
    )
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  }, 30_000)

  it('renders when a line has no HSN code recorded yet', async () => {
    // Existing products predate the field; the invoice must still print.
    const base = invoice()
    const buffer = await renderInvoicePdf({
      ...base,
      items: base.items.map((i) => ({ ...i, hsnCodeSnapshot: null })),
      gst: { ...base.gst, hsnSummary: [] },
    })
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  }, 30_000)
})
