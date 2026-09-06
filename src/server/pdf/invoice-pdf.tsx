import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'
import { MAIN_TYPE_LABEL } from '@/components/main-type-badge'
import type { InvoiceData } from '@/components/invoice'

/**
 * Amounts for the PDF, without the currency symbol.
 *
 * The built-in Helvetica that react-pdf uses has no glyph for the rupee sign,
 * and an unmapped glyph prints as a blank box on a customer-facing invoice.
 * The document says "All amounts in INR" once in the header instead, so the
 * numbers are unambiguous without needing an embedded font.
 */
function money(paise: bigint): string {
  const negative = paise < 0n
  const abs = negative ? -paise : paise
  const rupees = abs / 100n
  const fraction = abs % 100n
  const grouped = new Intl.NumberFormat('en-IN').format(rupees)
  return `${negative ? '-' : ''}${grouped}.${fraction.toString().padStart(2, '0')}`
}

function dateTime(value: Date | string): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value))
}

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: 'Helvetica', color: '#111827' },
  shopName: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  muted: { color: '#6b7280' },
  mono: { fontFamily: 'Courier' },
  header: { borderBottomWidth: 1, borderBottomColor: '#111827', paddingBottom: 8 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  right: { textAlign: 'right' },
  bold: { fontFamily: 'Helvetica-Bold' },
  tableHead: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#111827',
    paddingVertical: 4,
    marginTop: 14,
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingVertical: 4,
  },
  cItem: { flex: 1, paddingRight: 6 },
  cQty: { width: 34, textAlign: 'right' },
  cPrice: { width: 62, textAlign: 'right' },
  cTax: { width: 58, textAlign: 'right' },
  cAmount: { width: 70, textAlign: 'right' },
  totals: { marginTop: 12, marginLeft: 'auto', width: 210 },
  totalLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1.5 },
  grand: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#111827',
    paddingTop: 3,
    marginTop: 3,
    fontFamily: 'Helvetica-Bold',
  },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 36,
    right: 36,
    textAlign: 'center',
    fontSize: 8,
    color: '#6b7280',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 6,
  },
})

/**
 * PRD FR-26.4 - the downloadable invoice.
 *
 * It renders from the same InvoiceData the on-screen invoice uses, so the
 * printed copy and the downloaded copy can never disagree about a figure.
 */
export function InvoiceDocument({ data }: { data: InvoiceData }) {
  const taxByRate = new Map<number, bigint>()
  for (const i of data.items) {
    taxByRate.set(i.taxRateBasisPoints, (taxByRate.get(i.taxRateBasisPoints) ?? 0n) + i.taxPaise)
  }
  const due = data.totalPaise - data.paidPaise

  return (
    <Document title={`Invoice ${data.invoiceNumber}`} author={data.business.name}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <Text style={s.shopName}>{data.business.name}</Text>
          {data.business.addressLine1 ? <Text>{data.business.addressLine1}</Text> : null}
          <Text style={s.muted}>
            {[data.business.city, data.business.phone].filter(Boolean).join('  |  ')}
          </Text>
          {data.business.gstin ? (
            <Text style={s.mono}>GSTIN {data.business.gstin}</Text>
          ) : null}
          <Text style={[s.muted, { marginTop: 3 }]}>
            {data.branch.name} ({data.branch.code})  |  All amounts in INR
          </Text>
        </View>

        <View style={s.metaRow}>
          <View>
            <Text style={[s.mono, s.bold]}>{data.invoiceNumber}</Text>
            <Text style={s.muted}>{dateTime(data.soldAt)}</Text>
          </View>
          <View style={s.right}>
            <Text style={s.bold}>{data.customer?.name ?? 'Walk-in customer'}</Text>
            {data.customer?.phone ? <Text style={s.muted}>{data.customer.phone}</Text> : null}
            {data.customer?.gstin ? (
              <Text style={s.mono}>GSTIN {data.customer.gstin}</Text>
            ) : null}
          </View>
        </View>

        <View style={s.tableHead} fixed>
          <Text style={s.cItem}>ITEM</Text>
          <Text style={s.cQty}>QTY</Text>
          <Text style={s.cPrice}>PRICE</Text>
          <Text style={s.cTax}>TAX</Text>
          <Text style={s.cAmount}>AMOUNT</Text>
        </View>

        {data.items.map((i) => (
          <View key={i.id} style={s.row} wrap={false}>
            <View style={s.cItem}>
              <Text>{i.description}</Text>
              {i.identifierSnapshot ? (
                <Text style={[s.mono, s.muted, { fontSize: 7.5 }]}>{i.identifierSnapshot}</Text>
              ) : null}
              {i.mainTypeSnapshot ? (
                <Text style={[s.muted, { fontSize: 7.5 }]}>
                  {MAIN_TYPE_LABEL[i.mainTypeSnapshot]}
                  {i.isNewCutSnapshot ? ' - NEW CUT' : ''}
                </Text>
              ) : null}
            </View>
            <Text style={s.cQty}>{i.quantity}</Text>
            <Text style={s.cPrice}>{money(i.unitPricePaise)}</Text>
            <Text style={s.cTax}>{money(i.taxPaise)}</Text>
            <Text style={s.cAmount}>{money(i.lineTotalPaise)}</Text>
          </View>
        ))}

        <View style={s.totals}>
          <View style={s.totalLine}>
            <Text style={s.muted}>Taxable</Text>
            <Text>{money(data.taxablePaise)}</Text>
          </View>
          {data.discountPaise > 0n ? (
            <View style={s.totalLine}>
              <Text style={s.muted}>Discount</Text>
              <Text>-{money(data.discountPaise)}</Text>
            </View>
          ) : null}
          {[...taxByRate.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([bp, tax]) => (
              <View key={bp} style={s.totalLine}>
                <Text style={s.muted}>GST {bp / 100}%</Text>
                <Text>{money(tax)}</Text>
              </View>
            ))}
          <View style={s.grand}>
            <Text>Total</Text>
            <Text>{money(data.totalPaise)}</Text>
          </View>
          {data.payments.map((p) => (
            <View key={p.id} style={s.totalLine}>
              <Text style={s.muted}>
                {p.methodName}
                {p.reference ? ` (${p.reference})` : ''}
              </Text>
              <Text>{money(p.amountPaise)}</Text>
            </View>
          ))}
          {due > 0n ? (
            <View style={[s.totalLine, s.bold]}>
              <Text>Balance due</Text>
              <Text>{money(due)}</Text>
            </View>
          ) : null}
        </View>

        <Text style={s.footer} fixed>
          {data.pricesIncludedTax ? 'Prices include GST.' : 'GST added as shown.'} Thank you.
        </Text>
      </Page>
    </Document>
  )
}

export function renderInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument data={data} />)
}
