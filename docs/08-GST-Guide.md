# GST Guide

How tax is decided, calculated, stamped and reported in ECITY — from the shop's
settings down to a single line on a bill, and what happens to every kind of
product in every scenario.

Everything here is traced from the code, not from intent. Where the behaviour
differs from what you would expect, §10 says so plainly.

---

## 1. The three switches that decide everything

Before any line is priced, three business-level settings govern the outcome.
All three live on the `business` row (`src/server/db/schema.ts`).

| Setting | Column | Default | What it decides |
|---|---|---|---|
| **Registered for GST?** | `gst_enabled` | `true` | Whether *any* tax is charged at all |
| **Prices include tax?** | `prices_include_tax` | `true` | Whether tax is extracted from the price or added on top |
| **Shop's state** | `state_code` / `gstin` | — | Whether a sale is CGST+SGST or IGST |

### 1.1 `gst_enabled` — the master switch

A used-phone dealer trading below the registration threshold is not registered
and must not issue a tax invoice. When this is off:

- Every line is **forced to 0%** on the server (`sale.service.ts`), not merely
  hidden in the UI. A stale browser tab still holding a tax rate cannot put tax
  on a bill.
- `place_of_supply_code` and `supply_state_code` are stored as `NULL`.
- `hsn_code_snapshot` is `NULL` on every line — HSN is a GST code and has no
  meaning outside one.
- The printed document is headed **"INVOICE"**, not "TAX INVOICE".
- The HSN summary table is omitted entirely.

**The switch is stamped onto each sale**, in `sale.gst_enabled`. This matters:
nothing archives the invoice PDF, so every reprint is a fresh render. Without
the stamp, a bill issued while unregistered would reprint as a tax invoice the
day the shop registers.

### 1.2 `prices_include_tax` — inclusive or exclusive

This changes every total in the system, which is why it is a business-level
setting and not a per-document choice.

- **Inclusive (the default, and the Indian retail norm).** The price typed on
  the bill is what the customer pays. Tax is *extracted* from it.
- **Exclusive.** The price typed is pre-tax. Tax is *added* on top.

The arithmetic is in §3.

### 1.3 The shop's state

Used to decide intra-state versus inter-state supply. See §4.

---

## 2. Where a line's tax rate comes from

A tax rate is a row in `tax_rate`: a name, and `rate_basis_points` where
**1800 = 18.00%**. Basis points are integers — there are no floats anywhere in
this system.

Rates can be attached at three levels. This is the resolution order at the
till:

```
1. The device's own rate        device_unit.tax_rate_id
2. else the product's rate      product.tax_rate_id
3. else                         0% — untaxed
```

Steps 1–2 happen **in the browser**, in `billing-screen.tsx`, when an item is
added to the cart:

```ts
taxRateId: gstEnabled ? hit.taxRateId : null,
```

**There is no fall back to the shop's default rate.** A product with no rate is
untaxed, and bills untaxed. The `is_default` flag on a tax rate only preselects
it on forms; it never silently attaches itself to a sale.

### 2.1 The server never looks up the product's rate

This is the single most surprising thing in the GST flow, and worth stating
clearly:

> **`sale.service.ts` never reads `product.tax_rate_id`.** The rate used on a
> bill is whatever the till posted on the cart line. The server validates only
> that the rate belongs to this business — not that it matches the product.

```ts
// sale.service.ts — the rate comes from the request, not the product
const bp = gstEnabled && line.taxRateId ? (rateById.get(line.taxRateId) ?? 0) : 0
```

Two consequences:

- The per-product rate is a **default, not a rule**. Whatever the till sends is
  what gets charged.
- Correcting a product's rate does **not** change bills already issued — which
  is correct, and deliberate (see §2.2).

### 2.2 The rate is snapshotted onto the line

Every `sale_item` stores both `tax_rate_id` **and** `tax_rate_basis_points`,
plus `hsn_code_snapshot`. Editing or deactivating a tax rate later never
rewrites history: an invoice reprinted in two years shows the rate it was
issued at.

---

## 3. The arithmetic

All of it is in `src/lib/tax.ts`. Integer paise and integer basis points
throughout — a rounding error here is money the shop cannot reconcile at
closing.

### 3.1 One line

```
gross     = unit_price × quantity
net       = gross − line_discount
```

**Inclusive mode** — the net already contains the tax:

```
taxable = round(net × 10000 / (10000 + rate))
tax     = net − taxable          ← by subtraction, never recomputed
total   = net
```

Deriving the tax by subtraction guarantees `taxable + tax == total` exactly.
There is no rounding gap a customer could spot.

**Exclusive mode** — tax goes on top:

```
taxable = net
tax     = round(net × rate / 10000)
total   = net + tax
```

Rounding is **half-up**, implemented as integer arithmetic (`divRound`), because
BigInt division truncates and would quietly lose a paisa per line.

### 3.2 Worked examples

A ₹10,000 line at 18%:

| Mode | Taxable | Tax | Customer pays |
|---|---|---|---|
| Inclusive | ₹8,474.58 | ₹1,525.42 | **₹10,000.00** |
| Exclusive | ₹10,000.00 | ₹1,800.00 | **₹11,800.00** |

At 0%, both modes give taxable ₹10,000, tax ₹0, total ₹10,000.

### 3.3 The whole bill

`computeBill` sums the **already-rounded line figures** rather than recomputing
tax on the total. The invoice has to add up line by line, or a customer checking
the arithmetic finds it wrong.

It also produces two breakdowns a statutory invoice requires:

- **By rate** — taxable and tax per distinct rate.
- **By HSN** — keyed on `hsn_code + rate`, because lines sharing an HSN code can
  still sit at different rates, which is how GSTR-1 expects it.

---

## 4. CGST + SGST, or IGST

The split is presentational — the customer pays the same either way — but
getting it wrong makes the invoice non-compliant and the shop's returns
disagree with its books.

```
Intra-state (place of supply == branch state)  →  CGST + SGST, each half
Inter-state                                    →  IGST, the whole amount
```

**CGST takes the floor, SGST the remainder**, so the two always add back to
exactly the tax charged. Halving 3 paise as 1.5 + 1.5 and rounding both up would
invent a paisa the customer was never charged.

### 4.1 How the two states are resolved

**The branch's state** — first match wins:

```
branch.state_code → branch.gstin (first 2 digits)
                  → business.state_code → business.gstin (first 2 digits)
```

**The place of supply:**

```
customer.state_code → customer.gstin (first 2 digits) → else the branch's state
```

A walk-in with no GSTIN is treated as buying at the counter, which is where they
are standing — so an ordinary shop sale stays intra-state.

**Unknown state is treated as intra-state.** CGST/SGST is overwhelmingly the
common case for a counter sale, and guessing IGST would be worse.

---

## 5. Scenario by scenario, by product type

The shop runs **two separate businesses** (FR-38.1). This is the first thing
that decides whether GST is calculated here at all.

### 5.1 NEW handsets — never billed in ECITY

A device registered as `mainType = NEW` gets `sales_channel = EXTERNAL` by
default (`defaultSalesChannel`, `stock.service.ts`). An EXTERNAL device is
**refused at the till**, at save time:

```ts
// sale.service.ts — FR-38.2
if (channel === 'EXTERNAL') throw new AppError(…, 'EXTERNAL_CHANNEL')
```

> **NEW stock is bought, stocked and billed entirely in the other system.**
> ECITY never calculates GST on it. It appears in stock and reports, but no
> invoice is raised here and no output tax is recorded.

This is a business setting, not a hard-coded rule —
`business.new_stock_sales_channel` can be set to `ECITY` or `BOTH`, at which
point NEW handsets bill here like anything else. Anything that is not NEW is
always `ECITY`.

### 5.2 USED, ER, ACT, GLOBAL handsets

All four are `sales_channel = ECITY` and bill here normally. Each is a serialised
device, so:

- The rate resolves device → product → shop default (§2).
- A device can carry **its own** `tax_rate_id`, set on the device form or the
  purchase line, overriding the product's.
- The IMEI is snapshotted onto the sale line (`identifier_snapshot`).

Nothing about the main type changes the tax arithmetic. `USED` vs `GLOBAL` is a
stock classification, not a tax one — if used goods should attract a different
rate (e.g. a margin scheme), that is expressed by giving those products or
devices a different tax rate, not by the main type.

### 5.3 Accessories and other counted stock

Non-serialised products bill by quantity. The rate resolves product → shop
default; there is no device level. Otherwise identical.

### 5.4 A product with no tax rate at all

`product.tax_rate_id` is nullable, and "no tax rate" is a legitimate answer for
genuinely untaxed goods. It means exactly what it says: **0%, no tax charged.**

The line is billed with the full price as the taxable value and nil tax. The
invoice still prints a `CGST 0% / SGST 0%` row at ₹0.00, which is the honest
thing for a zero-rated line.

> This used not to work. The till substituted the shop's default rate whenever
> an item had none of its own, so a product deliberately saved as untaxed was
> billed at the default rate anyway and nothing on screen said so. The server
> always handled a null rate correctly as 0% — it was only the till filling the
> gap. Fixed; see §10.1.

### 5.5 An unregistered shop

Everything in §1.1 applies. Every line is 0%, whatever the product says.

### 5.6 A trade-in (part-exchange)

A handset taken in part-exchange is **not a discount**. The bill and its GST stay
at the **full selling price**, and the agreed value settles part of what is owed,
exactly like a payment.

This is the correct treatment: reducing the taxable value by the trade-in would
understate output tax.

### 5.7 A returned item

`return.service.ts` refunds the line at **what the customer actually paid**,
pro rata for a partial quantity:

```
share = value × returned_quantity / original_quantity
```

The tax component is prorated the same way and stored on the return
(`sales_return.tax_paise`). Tax is **never recomputed** on a return — it is
carried back from the original line, so a rate change between sale and return
cannot create a discrepancy.

### 5.8 An inter-state sale

A customer with a GSTIN or state code from another state flips the whole bill to
IGST. Nothing else changes: same rate, same taxable value, same total.

---

## 6. Purchases — the input side

`purchase_item` has `tax_rate_id` and `tax_paise` columns, and
`createPurchase` will use them if supplied:

```ts
const tax = input.lines.reduce((sum, l) => sum + (l.taxPaise ?? 0n), 0n)
const total = subtotal - discount + tax
```

**However, nothing ever supplies them.** The purchase form has no per-line tax
field, and `purchaseLineSchema` carries no `taxPaise`. In practice:

> **Input GST is not tracked.** Every purchase is recorded tax-inclusive as a
> single cost figure, `tax_paise` is always 0, and the shop's input tax credit
> cannot be derived from ECITY.

The supplier's GSTIN *is* stored (`supplier.gstin`) and appears on the supplier
report, so the counterparty is recorded even though the tax is not.

---

## 7. What gets stored

### On the sale (`sale`)

| Column | Meaning |
|---|---|
| `gst_enabled` | Was the shop registered when this was issued |
| `prices_included_tax` | Which mode this bill was priced under |
| `place_of_supply_code` | Where the supply was taxed |
| `supply_state_code` | The branch's state |
| `is_inter_state` | Drives CGST/SGST vs IGST |
| `taxable_paise`, `tax_paise` | Bill totals |
| `cgst_paise`, `sgst_paise`, `igst_paise` | The statutory split |

### On each line (`sale_item`)

`tax_rate_id`, `tax_rate_basis_points`, `hsn_code_snapshot`, `taxable_paise`,
`tax_paise`, `cgst_paise`, `sgst_paise`, `igst_paise`, `line_total_paise`.

Every one of these is a snapshot. Reports read them back rather than
recalculating, so a report can never disagree with an invoice already issued.

---

## 8. The invoice document

`src/server/pdf/invoice-pdf.tsx`, driven by `invoice.ts`. Everything GST-related
is conditional on the **stamped** `sale.gst_enabled`:

| Element | Registered | Not registered |
|---|---|---|
| Heading | TAX INVOICE | INVOICE |
| Shop GSTIN | shown | hidden |
| Place of supply | shown | hidden |
| HSN column | shown | hidden |
| Tax column | shown | hidden |
| HSN summary table | shown | omitted |
| Customer GSTIN | shown when they have one | hidden |

Two print formats from one document: A4 for a filed copy, 80 mm for the counter
thermal printer.

---

## 9. Reports

**Tax report** (`REPORTS.tax`, FR-25.1) — grouped by `tax_rate_basis_points` and
`hsn_code_snapshot`, with taxable, CGST, SGST, IGST and total tax per group.

It reads the snapshotted per-line figures rather than recomputing, so it can
never disagree with the invoices already issued. Voided sales are excluded.

---

## 10. Known gaps

These are real, found by tracing the code. None is hypothetical.

### 10.1 ~~A product saved as untaxed still bills at the shop default~~ — FIXED

The till used to substitute the shop's default rate when an item had no rate of
its own, so "no tax rate" never reached the server and an untaxed product was
billed at the default rate. The `?? defaultTaxRateId` fallback has been removed
from `billing-screen.tsx`; a product with no rate now bills at 0%.

**What this means for existing data.** Every product and device in the database
currently has `tax_rate_id IS NULL`, and the seed assigns none — so that fallback
was the only reason GST appeared on any bill. With it gone, **every product bills
at 0% until it is given a real rate.**

That is the correct behaviour and the honest state of the data: the shop was
never actually telling the system which goods are taxable. The outstanding work
is a data task, not a code one — set a rate on every product that attracts GST
(and leave genuinely exempt goods unset).

### 10.2 Input GST is not captured

See §6. No input tax credit can be derived from this system.

### 10.3 The tax report does not net returns

`taxReport` reads `sale_item` only. A return reverses the money and the stock,
but its tax does not appear as a negative in the tax report — so output tax is
overstated by the tax on returned goods.

A credit note is the statutory instrument for this, and there is no credit-note
report.

### 10.4 An unregistered dealer's document is headed "INVOICE"

Strictly, a non-registered seller issues a plain invoice and a *registered*
seller issues a "Bill of Supply" for exempt or composition supplies. The current
wording is defensible for the unregistered case but there is no Bill of Supply
path if the shop ever sells exempt goods while registered.

### 10.5 A cosmetic no-op in `computeBill`

```ts
const total = pricesIncludeTax ? taxable + tax - billDiscountPaise : taxable + tax - billDiscountPaise
```

Both branches are identical. Harmless, but it reads as though inclusive and
exclusive differ here when they do not — the difference is already baked into
`taxable` and `tax` by `computeLine`.

---

## 11. Quick reference

**Is tax charged?** Only if `business.gst_enabled` — enforced server-side.

**At what rate?** Whatever the till posts: device rate → product rate → shop
default → 0%.

**Inclusive or exclusive?** `business.prices_include_tax`, default inclusive.

**CGST/SGST or IGST?** Customer's state vs the branch's state. Unknown →
intra-state.

**Which products bill here?** Everything except NEW handsets, which are
`EXTERNAL` and billed in the other system.

**Does a trade-in reduce tax?** No. Full selling price, trade-in settles the
balance like a payment.

**Can a past bill's tax change?** No. Rate, HSN and the whole split are
snapshotted per line.
