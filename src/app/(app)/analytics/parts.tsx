import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatMoney } from '@/lib/money'
import { RankChart, ShareChart, TrendChart } from '@/components/charts'
import { formatBp } from './shared'

/** A headline figure, optionally with how it compares to the period before. */
export function Figure({
  label,
  value,
  hint,
  changeBp,
  href,
}: {
  label: string
  value: string
  hint?: string
  changeBp?: number | null
  href?: string
}) {
  const body = (
    <Card className={href ? 'h-full transition-colors hover:bg-accent' : 'h-full'}>
      <CardContent className="py-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="tabular text-xl font-semibold">{value}</p>
        {changeBp !== undefined ? (
          <p
            className={
              changeBp === null
                ? 'text-xs text-muted-foreground'
                : changeBp >= 0
                  ? 'text-xs text-success'
                  : 'text-xs text-destructive'
            }
          >
            {changeBp === null ? 'nothing to compare' : `${formatBp(changeBp)} vs before`}
          </p>
        ) : null}
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  )
  return href ? <Link href={href}>{body}</Link> : body
}

export type Column = {
  header: string
  align?: 'right'
  /** Rendered per row. */
  cell: (row: Record<string, unknown>) => React.ReactNode
}

/**
 * The table every analytics area shows under its chart.
 *
 * Scrolls inside its own box: an analytics table is wide by nature and the
 * page must never scroll sideways.
 */
export function DataTable({
  title,
  description,
  columns,
  rows,
  empty = 'Nothing in this period.',
  testId,
}: {
  title: string
  description?: string
  columns: Column[]
  rows: Record<string, unknown>[]
  empty?: string
  testId?: string
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c) => (
                    <TableHead key={c.header} className={c.align === 'right' ? 'text-right' : ''}>
                      {c.header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => (
                  <TableRow key={i} data-testid="analytics-row">
                    {columns.map((c) => (
                      <TableCell
                        key={c.header}
                        className={c.align === 'right' ? 'tabular text-right' : ''}
                      >
                        {c.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * A bar chart drawn with divs.
 *
 * No charting library: this is one bar per row against the largest value, it
 * works without JavaScript, and it costs nothing to ship. A real library earns
 * its place when a chart needs axes and interaction, which none of these do.
 */
export function BarChart({
  title,
  rows,
  testId,
}: {
  title: string
  rows: { label: string; valuePaise: bigint; href?: string }[]
  testId?: string
}) {
  const max = rows.reduce((m, r) => (r.valuePaise > m ? r.valuePaise : m), 0n)

  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing in this period.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => {
              // Integer percentage in basis points, so no float touches money.
              const pct = max > 0n ? Number((r.valuePaise * 100n) / max) : 0
              const label = (
                <>
                  <span className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate">{r.label}</span>
                    <span className="tabular shrink-0 text-muted-foreground">
                      {formatMoney(r.valuePaise)}
                    </span>
                  </span>
                  <span className="mt-1 block h-2 rounded-full bg-muted">
                    <span
                      className="block h-2 rounded-full bg-primary"
                      style={{ width: `${Math.max(pct, 1)}%` }}
                    />
                  </span>
                </>
              )
              return (
                <li key={r.label}>
                  {r.href ? (
                    <Link href={r.href} className="block hover:opacity-80">
                      {label}
                    </Link>
                  ) : (
                    label
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * A chart in a card, with the right chart for the question.
 *
 * `BarChart` above stays for rankings — a list of five products with a bar
 * behind each is honest and needs no library. This is for the two shapes it
 * could never show: a trend over time, and a share of a whole.
 */
export function ChartCard({
  title,
  description,
  kind,
  rows,
  testId,
}: {
  title: string
  description?: string
  kind: 'trend' | 'rank' | 'share'
  rows: { label: string; valuePaise: bigint }[]
  testId?: string
}) {
  // bigint cannot cross the server/client boundary, so it goes as a string
  // and is parsed back inside the chart — never converted to a float here.
  const data = rows.map((r) => ({ label: r.label, valuePaise: r.valuePaise.toString() }))

  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing in this period.</p>
        ) : kind === 'trend' ? (
          <TrendChart data={data} />
        ) : kind === 'share' ? (
          <ShareChart data={data} />
        ) : (
          <RankChart data={data} />
        )}
      </CardContent>
    </Card>
  )
}
