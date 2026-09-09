'use client'

import {
  Area,
  AreaChart,
  Bar,
  BarChart as RechartsBar,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

/**
 * The charts, matched to what the data is.
 *
 * Everything on the analytics pages used to be one component: a list of
 * `<span>`s with a percentage width. That is fine for a ranking — "which
 * five products sold most" is a list, and a list is honest about it — and
 * wrong for everything else. Sales-by-day in particular is a *time series*
 * rendered as ninety stacked rows, where a trend, a spike and a weekly
 * rhythm are all invisible.
 *
 * So: a line for time, a donut for a composition, bars for a ranking. Shape
 * follows the question being asked.
 *
 * Money arrives in **paise** and is divided by 100 exactly once, here at the
 * display edge (docs/03 §4.1). Recharts needs a JavaScript number to compute
 * a pixel height; nothing upstream of this ever sees one.
 */

const AXIS = 'var(--muted-foreground)'
const GRID = 'var(--border)'

/**
 * Rupees, short enough for an axis: ₹1.2L, ₹45k, ₹900.
 *
 * `Math.round` is banned in src/ because rounding usually means float money
 * (docs/03 §4.1), and the rule is right to be blunt about it. This is the
 * exception the rule cannot see: an axis caption is *deliberately* lossy —
 * "₹1.2L" is a label, not an amount. Every figure the shop acts on comes
 * from the exact bigint, and the tooltip below shows it in full.
 */
/* eslint-disable no-restricted-syntax */
function shortMoney(rupees: number): string {
  if (Math.abs(rupees) >= 10_000_000) return `₹${(rupees / 10_000_000).toFixed(1)}Cr`
  if (Math.abs(rupees) >= 100_000) return `₹${(rupees / 100_000).toFixed(1)}L`
  if (Math.abs(rupees) >= 1_000) return `₹${Math.round(rupees / 1_000)}k`
  return `₹${Math.round(rupees)}`
}
/* eslint-enable no-restricted-syntax */

/** Full rupees with separators, for a tooltip where there is room. */
function fullMoney(rupees: number): string {
  return `₹${rupees.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

/** Recharts hands the formatter a loose value type; pin it down once. */
const asNumber = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0))

const tooltipStyle = {
  backgroundColor: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: '0.5rem',
  color: 'var(--popover-foreground)',
  fontSize: '0.75rem',
  padding: '0.5rem 0.75rem',
}

/**
 * A trend over time.
 *
 * An area rather than bare bars: what matters in a day-by-day series is the
 * *shape* — whether takings are climbing, and which days are dead — and an
 * area reads as one continuous quantity rather than as ninety separate
 * things that happen to be adjacent.
 */
export function TrendChart({
  data,
  height = 220,
}: {
  data: { label: string; valuePaise: string }[]
  height?: number
}) {
  const points = data.map((d) => ({
    label: d.label,
    value: Number(BigInt(d.valuePaise)) / 100,
  }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: AXIS, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          tick={{ fill: AXIS, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={shortMoney}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v) => [fullMoney(asNumber(v)), 'Revenue']}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#trendFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

/**
 * A ranking: which branches, products or brands sold most.
 *
 * Horizontal, because the labels are names — "Samsung Galaxy A15 128GB" does
 * not fit under a vertical bar, and a chart that has to rotate its labels
 * forty-five degrees has chosen the wrong axis.
 */
export function RankChart({
  data,
  height = 240,
}: {
  data: { label: string; valuePaise: string }[]
  height?: number
}) {
  const points = data.map((d) => ({
    label: d.label,
    value: Number(BigInt(d.valuePaise)) / 100,
  }))

  return (
    <ResponsiveContainer width="100%" height={Math.max(height, points.length * 34 + 20)}>
      <RechartsBar data={points} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: AXIS, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={shortMoney}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fill: AXIS, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={120}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)' }}
          contentStyle={tooltipStyle}
          formatter={(v) => [fullMoney(asNumber(v)), 'Total']}
        />
        <Bar dataKey="value" fill="var(--chart-1)" radius={[0, 4, 4, 0]} />
      </RechartsBar>
    </ResponsiveContainer>
  )
}

/**
 * A composition: parts that add up to a whole.
 *
 * Payment mix and the main-type split are shares of one total, and a share is
 * the one thing a ranked list cannot show — you can see that cash is the
 * biggest without seeing that it is most of the shop.
 */
export function ShareChart({
  data,
  height = 240,
}: {
  data: { label: string; valuePaise: string }[]
  height?: number
}) {
  const points = data
    .map((d) => ({ label: d.label, value: Number(BigInt(d.valuePaise)) / 100 }))
    .filter((d) => d.value > 0)

  const total = points.reduce((sum, p) => sum + p.value, 0)

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={points}
          dataKey="value"
          nameKey="label"
          innerRadius="55%"
          outerRadius="80%"
          paddingAngle={2}
          stroke="var(--background)"
        >
          {points.map((_, i) => (
            <Cell key={i} fill={`var(--chart-${(i % 5) + 1})`} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v, name) => {
            const value = asNumber(v)
            // A percentage for a legend, not a figure anyone reconciles.
            // eslint-disable-next-line no-restricted-syntax
            const share = total > 0 ? Math.round((value / total) * 100) : 0
            return [`${fullMoney(value)} (${share}%)`, String(name)]
          }}
        />
        <Legend
          verticalAlign="bottom"
          height={36}
          formatter={(value) => (
            <span style={{ color: 'var(--foreground)', fontSize: 12 }}>{String(value)}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
