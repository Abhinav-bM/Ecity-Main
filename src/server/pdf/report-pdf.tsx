import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'

/**
 * A plain, printable table (PRD FR-33.2).
 *
 * Deliberately unlike the invoice renderer: an invoice is a statutory document
 * with a fixed shape, this is whatever columns the report happened to have.
 * Landscape, because a report with eight columns is unreadable in portrait.
 */
const s = StyleSheet.create({
  page: { padding: 24, fontSize: 8, color: '#111827' },
  title: { fontSize: 13, marginBottom: 2 },
  subtitle: { fontSize: 8, color: '#6b7280', marginBottom: 10 },
  head: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: '#111827',
    paddingBottom: 3,
    marginBottom: 3,
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderColor: '#e5e7eb',
    paddingVertical: 2.5,
  },
  cell: { flex: 1, paddingRight: 6 },
  right: { textAlign: 'right' },
  footer: {
    position: 'absolute',
    bottom: 14,
    left: 24,
    right: 24,
    fontSize: 7,
    color: '#6b7280',
    textAlign: 'center',
  },
})

export type ReportPdf = {
  title: string
  subtitle?: string
  columns: { header: string; align?: 'right' }[]
  rows: string[][]
}

export async function renderReportPdf(report: ReportPdf): Promise<Buffer> {
  return renderToBuffer(
    <Document title={report.title}>
      <Page size="A4" orientation="landscape" style={s.page}>
        <Text style={s.title}>{report.title}</Text>
        {report.subtitle ? <Text style={s.subtitle}>{report.subtitle}</Text> : null}

        {/* `fixed` repeats the header on every page, which is what makes a
            multi-page table readable at all. */}
        <View style={s.head} fixed>
          {report.columns.map((c) => (
            <Text
              key={c.header}
              style={c.align === 'right' ? [s.cell, s.right] : s.cell}
            >
              {c.header}
            </Text>
          ))}
        </View>

        {report.rows.map((row, i) => (
          <View key={i} style={s.row} wrap={false}>
            {row.map((value, j) => (
              <Text
                key={j}
                style={report.columns[j]?.align === 'right' ? [s.cell, s.right] : s.cell}
              >
                {value}
              </Text>
            ))}
          </View>
        ))}

        <Text
          style={s.footer}
          render={({ pageNumber, totalPages }) =>
            `${report.title} · page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>,
  )
}
