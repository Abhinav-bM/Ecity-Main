# Product Requirements Document

## 1. Document Control

| Field | Value |
|---|---|
| Product | ECITY — Mobile Shop Management Web App |
| Document | Product Requirements Document (PRD) |
| Version | 1.3 |
| Date | 1 September 2026 |
| Source | `mobile_shop_management_feature_list_v3.pdf` (Feature List, Review Version 3) |
| Status | Draft for build |
| Change in 1.3 | OQ-1 downgraded: ER/ACT expansions are display labels, not a schema question, so they no longer block M2. §5.1 records the decision |
| Change in 1.2 | Added §6.22 — integration with the shop's existing NEW-items billing system via a daily Excel feed (FR-38), plus open questions OQ-10 to OQ-13 |
| Change in 1.1 | A device unit now carries **one or more IMEIs** (§5.2, FR-4.8 – FR-4.12). The database and API support the full list from day one; the v1 UI shows a single IMEI field, governed by the `imei_slots` setting |
| Related documents | `02-Module-Breakdown` (delivery plan), `03-Engineering-Design` (tech stack, architecture, hosting cost) |

---

## 2. Product Summary

ECITY is a multi-branch retail management web application for mobile phone shops. It runs the whole shop: buying stock from suppliers, tracking every handset by IMEI, selling and billing at the counter, handling credit customers, moving stock between branches, closing the cash drawer at the end of each day, and reporting on all of it — per branch and consolidated for the owner.

Two characteristics separate this from generic retail/POS software and drive most of the design:

1. **Every handset is a serialised, individually-tracked asset.** A phone is not "3 units of Model X"; it is one physical device with an IMEI, a purchase price, a condition type, a branch, a status and a life story. The system must be able to answer, from a single IMEI search: who we bought it from, when, on which invoice, which branch received it, every transfer it made, when and to whom it was sold, at what price, whether it was paid or on credit, and whether it later came back as a return, exchange or repair.
2. **Everything is branch-scoped.** Inventory, sales, purchases, expenses, cash drawers, bank accounts and daily closings all belong to a branch. Users are assigned to one or many branches. The owner sees one branch, a selection of branches, or the whole business consolidated.

---

## 3. Goals and Non-Goals

### 3.1 Goals

- **G1 — Replace paper and spreadsheets** for purchase, sales, credit and cash records across all branches with one authoritative system.
- **G2 — Make every device traceable.** Full lifecycle history for any IMEI, retrievable in one search, from anywhere in the app.
- **G3 — Make the counter fast.** A cash accessory sale in under 20 seconds; a mobile sale with IMEI scan in under 60 seconds.
- **G4 — Close the day honestly.** Expected vs. actual cash, UPI, card and bank amounts computed automatically, with mismatch recorded and attributable.
- **G5 — Control credit.** Know outstanding, overdue and aging balances by customer and by branch at any moment.
- **G6 — Give the owner one view.** Consolidated sales, profit, stock value and dues across all branches with drill-down to an individual device.
- **G7 — Never lose history.** Reversals, cancellations and voids instead of deletions; a complete audit trail on financial and inventory records.

### 3.2 Non-Goals (v1)

- Full statutory accounting (ledgers, trial balance, balance sheet, P&L for filing) — the system produces business profit figures, not audited books.
- Replacing the shop's existing billing system for NEW items. That system stays; ECITY integrates with it through a daily Excel feed (§6.22) rather than displacing it.
- Direct government GST return filing or e-invoice / IRN generation. Tax data is captured and exportable; filing is done externally.
- E-commerce storefront, online ordering, or customer-facing app.
- Repair-workshop job-card management (device repair events are *recorded* against a device, but the repair workflow itself is out of scope for v1).
- Payroll and HR.
- Offline-first operation at the counter. v1 assumes a working internet connection; see §9.3. *(OQ-7 answered: not required.)*
- Native mobile applications. v1 is a responsive web app usable on a tablet and phone browser.

---

## 4. Users and Roles

| Role | Who they are | What they need |
|---|---|---|
| **Owner / Admin** | Business owner | Everything: all branches, consolidated dashboards, master data, user management, price and cost visibility, void/reversal rights, day re-open rights |
| **Manager** (branch) | Branch in-charge | Full operations for their branch(es): purchases, sales, returns, transfers, expenses, cash drawer, daily closing, branch reports. Cost prices and margins visible for their branch |
| **Staff / Salesperson** | Counter staff | Billing, customer lookup, IMEI/stock lookup, taking payments, initiating returns. No purchase-cost visibility, no ability to edit closed days or delete records |

Permissions are **granular**, not just three fixed bundles: a role is a named set of permissions that an Admin can adjust, and each user is additionally scoped to a set of branches. Every screen and every API enforces both the permission and the branch scope.

**FR-1 Authentication & User Management**

- FR-1.1 Email/username + password login, logout, password reset, and server-side session management with configurable idle timeout.
- FR-1.2 Roles (Admin, Manager, Staff) built from granular permissions; Admin can create and edit roles.
- FR-1.3 Users assigned to one or multiple branches, with per-branch permissions.
- FR-1.4 Audit log for important actions recording user, date/time, entity and the changed values.
- FR-1.5 User deactivation preserves all historical records authored by that user.

---

## 5. Glossary and Core Domain Rules

### 5.1 Mobile stock classification — the single most important rule

There are exactly **five main types** for a mobile device:

| Main type | Meaning |
|---|---|
| **NEW** | Brand-new sealed device |
| **USED** | Second-hand / pre-owned device |
| **ER** | The shop's own category. Stored as the code `ER`; the display label is configuration |
| **ACT** | The shop's own category. Stored as the code `ACT`; the display label is configuration |
| **GLOBAL** | Global-variant device |

**The five codes are stored as they are.** `ER` and `ACT` are the shop's own terms; what they stand for is a **display label held in configuration**, not a schema concern. The system stores, filters, reports and analyses them correctly without ever knowing the expansion, and a label can be added or corrected at any time without a migration. Only a *structural* difference — extra fields attached to one of these types — would affect the data model.

**NEW CUT is not a sixth type.** NEW CUT is a *designation that lives inside GLOBAL*. A GLOBAL device either carries NEW CUT details or it does not, and both must remain distinguishable everywhere.

Consequences that apply system-wide:

- FR-5.1 `main_type` is a required attribute of every mobile device unit, chosen from the five values above.
- FR-5.2 `is_new_cut` (plus its associated details) is only valid when `main_type = GLOBAL`; the system must reject it for any other type.
- FR-5.3 Main type and NEW CUT information must stay consistent and visible through **purchase → inventory → transfer → sale → return → exchange → adjustment** records. No flow may silently drop or rewrite them.
- FR-5.4 Every inventory report, analytics view and filter that groups mobile stock must present the five main types separately, and must be able to break GLOBAL down into *normal GLOBAL* vs *GLOBAL + NEW CUT*.

### 5.2 Device identifiers (IMEI)

A handset can carry more than one IMEI — typically one per SIM slot, sometimes more. The system therefore treats identifiers as a **list belonging to a device**, never as fixed `IMEI 1` / `IMEI 2` columns.

- The device is the entity; its IMEIs are its identifiers. Giving a device a third or fourth identifier later is a data change, not a schema migration.
- Every IMEI is unique across the whole business — two devices can never share one.
- Exactly one identifier per device is the **primary** IMEI, and that is the one shown wherever a single IMEI is displayed.
- Searching **any** identifier of a device resolves to the same device and the same history (FR-30.5).

**In v1 the purchase and product screens show a single IMEI field.** The additional slots exist in the database and the API from day one and are switched on later with the `imei_slots` business setting when the shop needs them — with no migration, no backfill, and no rework of purchase, sale, transfer, return, search or reporting. This is deliberate: the cheap decision now is to store a list and show one field; the expensive decision is to store two columns and discover a third IMEI later.

### 5.3 Device status lifecycle

A device unit (one IMEI) is always in exactly one status:

`In Stock → Reserved → Sold`, with the branches `Returned`, `Damaged`, `Lost`, `Repair` and `Transferred` reachable as the business dictates.

- FR-5.5 Status transitions are driven by documents (purchase, sale, transfer, return, adjustment), never edited freely.
- FR-5.6 A device that is not `In Stock` at the selling branch cannot be sold. The system blocks it at bill time.
- FR-5.7 Returned devices enter `Returned / Inspection` and are **not** automatically sellable. An authorised user must classify them as Available, Used, Damaged or Repair Required.

### 5.4 Other terms

| Term | Meaning |
|---|---|
| **Device unit** | One physical handset, identified by one or more IMEIs. The atomic unit of mobile inventory |
| **Identifier** | One IMEI belonging to a device unit. A device has a list of them, one of which is primary |
| **Non-serialised stock** | Accessories (chargers, cases, cables, power banks, watches…) tracked by quantity per branch, not individually |
| **Branch stock** | The quantity/units of a product held at one branch. Stock is never business-wide |
| **Credit sale** | A sale with an outstanding balance; creates a customer due |
| **Daily closing** | End-of-day reconciliation of expected vs. actual cash and non-cash amounts for one branch |
| **Cash drawer** | Per-branch running cash position for a business day |

---

## 6. Functional Requirements

Requirement IDs map to the section numbers of the source Feature List v3 so the two documents can be cross-checked.

### 6.1 Shop & System Setup (FR-2)

- FR-2.1 Business profile: name, logo, contact details, address, GST/tax identifiers, currency.
- FR-2.2 Invoice numbering scheme, with per-branch series where configured (see FR-26.3).
- FR-2.3 Tax configuration, including tax-inclusive vs tax-exclusive pricing.
- FR-2.6 A business-level **GST registration switch**. A shop trading below the registration threshold — which is where this starts, selling mostly used handsets — charges no GST and must not issue a tax invoice. Off means every line is forced to 0% by the server and the GST fields disappear from the app; nothing is deleted, so registering later is this one switch. *(Added on request, 2026-09-07.)*
- FR-2.4 Payment methods: Cash, UPI, Card, Bank Transfer, plus configurable additional methods.

### 6.2 Multi-Branch Management (FR-3)

- FR-3.1 One business account contains multiple branches; each branch has name, code, address, phone, manager and status.
- FR-3.2 Users assigned to one or many branches with branch-level permissions.
- FR-3.3 Inventory, sales, purchases, expenses, cash drawers, accounts and daily closings are all separate per branch.
- FR-3.4 Owner/Admin can view a single branch, a selected set of branches, or all branches consolidated.
- FR-3.5 Every transaction stores its branch; all dashboards and reports support branch-wise and consolidated modes.
- FR-3.6 Stock transfers between branches move through **Requested → Approved → In Transit → Received**, with **Cancelled** available before receipt.
- FR-3.7 Mobile transfers move the **exact IMEI**, and the device's full branch movement history is preserved.
- FR-3.8 Deactivated branches retain all historical data but accept no new transactions.

### 6.3 Product / Inventory Management (FR-4)

- FR-4.1 Categories for mobiles and accessories (chargers, cases, screen guards, earphones, cables, power banks, watches, other).
- FR-4.2 Product fields: name, brand, category, model, SKU, purchase price, selling price, tax, quantity, minimum stock, supplier, image, description.
- FR-4.3 Mobile fields: one or more IMEIs (see FR-4.8 – FR-4.12), brand, model, variant, RAM, storage, colour, purchase price, selling price, tax, warranty, supplier, purchase date.
- FR-4.4 Main type and GLOBAL/NEW CUT rules per §5.1.
- FR-4.5 Individual device tracking by IMEI, with the statuses in §5.3.
- FR-4.6 Inventory belongs to a branch; filterable by branch, main type, GLOBAL/NEW CUT status, brand, model, category, supplier and status.
- FR-4.7 Low-stock threshold per product per branch drives alerts (FR-27).
- FR-4.8 A device unit carries **one or more IMEIs**. The number is a property of the data, not fixed by the schema, and a device may be given a further identifier later without any migration.
- FR-4.9 Every IMEI is unique across the whole business. Recording a duplicate is rejected with a message naming the device that already holds it.
- FR-4.10 Exactly one IMEI per device is marked **primary**, and is the one shown in lists, on invoices, in exports and in reports.
- FR-4.11 A business setting **`imei_slots`** controls how many IMEI inputs the purchase and product forms present. **Its v1 value is 1.** Raising it exposes the additional fields immediately, with no schema change, no data migration and no code release.
- FR-4.12 Every path that accepts, stores, searches, transfers, sells, returns, adjusts or exports a device handles the device's **full identifier list**, regardless of the current `imei_slots` value — including devices imported with several IMEIs while the setting is still 1.

### 6.4 Purchase / Stock Entry (FR-5)

- FR-5.8 Purchase document: number, date, branch, supplier, line items, quantity, purchase price, tax, discount, total, payment status.
- FR-5.9 For mobile lines: capture the device's IMEI(s) and main type; when GLOBAL, optionally capture NEW CUT details. The form presents `imei_slots` IMEI fields (one in v1); the API accepts the full list in every case.
- FR-5.10 Supplier profile: name, company, phone, alternate phone, email, address, GST number, photo, notes.
- FR-5.11 Supplier history: purchases, payments, outstanding amount, products purchased.
- FR-5.12 Payment status: fully paid, partially paid, or credit/unpaid.
- FR-5.13 Attach supplier invoices, bill photos, PDFs and supporting documents.
- FR-5.14 Confirming a purchase increases branch stock and registers each mobile IMEI as a device unit.
- FR-5.15 Editing or reversing a purchase updates inventory correctly and retains full audit history. A purchase cannot be reversed if any of its devices have already been sold or transferred — the system must explain which ones block it.

### 6.5 Sales / Billing (FR-6)

- FR-6.1 Fast billing: search by product name, SKU, barcode, or IMEI; keyboard-and-scanner driven.
- FR-6.2 Every sale is linked to its branch.
- FR-6.3 Mobile lines display main type and, when GLOBAL, the NEW CUT information.
- FR-6.4 Selecting an IMEI identifies the exact physical device; unavailable or already-sold devices are blocked (FR-5.6).
- FR-6.5 Completing a mobile sale sets that device's status to `Sold` at its branch.
- FR-6.6 Customer profile: name, phone, email, address, GST information, notes.
- FR-6.7 Customer history: purchases, returns, credit, payments and total spend across branches.
- FR-6.8 Line-level and bill-level discount, tax computation per FR-2.3, and multi-method (split) payment on one bill.

### 6.6 Credit Sales / Customer Dues (FR-7)

- FR-7.1 Payment status per sale: Paid, Partially Paid, Credit/Unpaid.
- FR-7.2 A credit sale requires a customer, and stores total, paid amount, outstanding, due date, notes.
- FR-7.3 Multiple later payments can be received against the same sale.
- FR-7.4 Customer balance updates automatically; the sale is marked Paid when fully settled.
- FR-7.5 Record both the branch where the credit sale happened and the branch where each later payment was received.
- FR-7.6 Reports: total outstanding, overdue, customer-wise, branch-wise, and aging.

### 6.7 Sales Returns (FR-8)

- FR-8.1 Return initiated by invoice, customer or IMEI; supports full, partial and exchange returns.
- FR-8.2 Returned mobiles enter `Returned / Inspection` (FR-5.7).
- FR-8.3 Authorised classification into Available, Used, Damaged or Repair Required.
- FR-8.4 Main type and GLOBAL/NEW CUT information preserved through the return.
- FR-8.5 Refund recorded against a payment method / cash drawer, and stock returned to the correct branch.

### 6.8 Exchange / Trade-In (FR-9)

- FR-9.1 Record the old phone: IMEI, condition/type, estimated value, agreed trade-in value.
- FR-9.2 Link the trade-in to the new sale and record the difference paid by the customer.
- FR-9.3 Accepted trade-in devices enter the selected branch's inventory with the correct main type and, where applicable, GLOBAL/NEW CUT information.

### 6.9 Expenses (FR-10)

- FR-10.1 Categories: rent, electricity, salaries, transport, packaging, repairs, miscellaneous (configurable).
- FR-10.2 Fields: date, branch, category, amount, payment method, description, receipt attachment, recording user.
- FR-10.3 Expenses reduce the cash drawer or the relevant account and feed profit calculations.

### 6.10 Cash Drawer / Cash Management (FR-11)

- FR-11.1 A separate cash drawer per branch per business day.
- FR-11.2 Tracks opening cash, cash sales, customer credit collections, expenses, supplier payments and refunds.
- FR-11.3 `Expected Cash = Opening Cash + Cash In − Cash Out`, computed by the system.
- FR-11.4 The user enters actual counted cash at closing; shortage/excess is shown automatically.
- FR-11.5 Complete daily cash transaction history is retained and viewable.

### 6.11 Bank / Account Tracking (FR-12)

- FR-12.1 Multiple bank / UPI / business accounts.
- FR-12.2 An account may belong to a branch or be shared/global.
- FR-12.3 Receipts, payments, inter-account transfers and running balances.
- FR-12.4 Reconciliation between recorded balance and actual statement balance.

### 6.12 Daily Closing / End-of-Day Reconciliation (FR-13)

- FR-13.1 Day summary: sales, invoices, items, purchases, returns, credit issued and collected, and a payment-method breakdown.
- FR-13.2 Expected vs actual for Cash, UPI, Card and Bank.
- FR-13.3 Mismatch computed automatically; branch, closing user and timestamp recorded.
- FR-13.4 Changing anything on a closed day requires an explicit permission and is audited.
- FR-13.5 Branch-wise and consolidated reconciliation reports.

### 6.13 Supplier Payments (FR-14)

- FR-14.1 Per supplier: purchase total, paid amount, outstanding balance.
- FR-14.2 Record future payments with a full payment history.
- FR-14.3 Supplier-wise and branch-wise outstanding reports; a supplier may be shared across branches.

### 6.14 Dashboard (FR-15)

- FR-15.1 Today's sales, purchases, estimated profit, orders, items, cash, accounts, customer dues, supplier dues and stock value.
- FR-15.2 Branch selector plus a consolidated owner view.
- FR-15.3 Alerts: low stock, overdue dues, unclosed days, cash mismatches.

### 6.15 Analytics (FR-16 … FR-24)

All analytics honour the user's role and branch scope, support date-range selection (day, week, month, year, custom), and support branch comparison.

| ID | Area | Required measures |
|---|---|---|
| FR-16 | Sales analytics | Revenue, orders, units, average order value, growth %, period comparison, branch comparison |
| FR-17 | Product analytics | Best sellers, slow movers, dead stock, revenue, cost, profit, margin; cross-branch comparison; GLOBAL performance with NEW CUT analysed separately |
| FR-18 | Brand analytics | Units, revenue, profit, margin, growth by brand; strongest/weakest brands; branch differences |
| FR-19 | Customer analytics | New vs returning, spend, frequency, average spend, top customers, activity and outstanding credit across branches |
| FR-20 | Credit analytics | Outstanding and overdue by customer and branch; aging buckets 0–7, 8–30, 31–60, 60+ days; collection performance; repeatedly overdue customers |
| FR-21 | Inventory analytics | Quantity and stock value; mobile vs accessory; movement Opening → Purchases → Sales → Returns → Adjustments → Current; turnover, low stock, out of stock, dead stock; branch comparison; five main types reported separately with GLOBAL split into normal vs NEW CUT |
| FR-22 | Profit & financial | Revenue, COGS, gross profit, estimated net profit, margin; filters by date, branch, product, category, brand, main type; NEW CUT filtering within GLOBAL |
| FR-23 | Payment analytics | Cash/UPI/Card/Bank/Credit distribution, trends, branch comparison, reconciliation support |
| FR-24 | Supplier analytics | Purchase volume, transaction count, paid/outstanding, products purchased, trends by branch and business-wide |

### 6.16 Reports (FR-25)

- FR-25.1 Sales, purchase, inventory, financial, credit, tax and reconciliation reports.
- FR-25.2 Branch comparison and consolidated reports.
- FR-25.3 Inventory reports group mobile stock into NEW, USED, ER, ACT, GLOBAL, with GLOBAL broken down by NEW CUT where applicable.
- FR-25.4 Export to CSV / Excel / PDF where appropriate.

### 6.17 Invoice / Receipt Management (FR-26)

- FR-26.1 Sales invoice showing branch, customer, products, IMEI, price, discount, tax, payment and outstanding.
- FR-26.2 Purchase invoices/documents, and receipts for customer and supplier payments.
- FR-26.3 Branch-specific invoice numbering where configured.
- FR-26.4 Print output for both A4 and 80 mm thermal receipt formats, plus PDF download and share.
- FR-26.5 Every sales invoice **from a GST-registered shop** is a statutory GST tax invoice: HSN/SAC per line, CGST/SGST for intra-state supply or IGST for inter-state, place of supply, and an HSN-wise tax summary. *(Added when OQ-4 was answered.)*
- FR-26.6 An unregistered shop (FR-2.6) issues a plain invoice: no "Tax Invoice" heading, no GSTIN, no HSN column, no tax column and no tax summary. **Which of the two a bill is, is fixed when it is issued and never re-decided.** Nothing archives the PDF — every reprint is a fresh render — so registering for GST later must not turn bills issued before it into tax invoices.

### 6.18 Notifications & Alerts (FR-27)

- FR-27.1 Triggers: low stock, overdue customer payments, supplier dues, cash mismatches, unclosed days, stock adjustments, and optional warranty expiry alerts.
- FR-27.2 Branch users receive their branch's alerts; owners/admins can receive consolidated alerts.
- FR-27.3 In-app notification centre in v1; email/WhatsApp channels are a later enhancement (OQ-6).

### 6.19 Stock Adjustments (FR-28)

- FR-28.1 Authorised adjustments to correct physical/system mismatches.
- FR-28.2 Record branch, product or IMEI, main type, GLOBAL/NEW CUT information, reason, user and timestamp.
- FR-28.3 Reason codes include damage, loss, miscount and data-entry error.

### 6.20 Warranty Tracking (FR-29)

- FR-29.1 Track IMEI, purchase date, warranty period and expiry, customer, warranty provider, supplier and branch.
- FR-29.2 Warranty information is visible from the product / IMEI history view.

### 6.21 Global Search & Device History (FR-30) — flagship feature

- FR-30.1 A single Global Search is available from every screen in the application.
- FR-30.2 Searchable: product name, customer name, customer email, customer phone, supplier name, supplier email/phone, IMEI, SKU, barcode, invoice number.
- FR-30.3 Product-name search returns matching products/inventory across all branches the user may access.
- FR-30.4 Email search returns the matching customer or supplier profile plus related transactions.
- FR-30.5 An IMEI search opens a dedicated **device history** page for that exact device, showing (searching *any* of the device's identifiers reaches the same page):

| Section | Content |
|---|---|
| Device identity | Model, variant, storage/RAM, colour, main type, GLOBAL/NEW CUT if applicable, and every IMEI on the device with the primary one marked |
| Commercials | Purchase price, selling price, discount, payment status, paid vs credit |
| Current position | Current status, current branch, previous branch |
| Purchase | Exact purchase date, seller/supplier, and the related purchase invoice |
| Branch journey | Branch that first received it, then every transfer with date, source and destination |
| Sale | Sale date/time, sale/invoice number, and the customer with their details |
| Post-sale events | Returns, exchanges, repairs, damage and adjustments, each with date and linked record |

- FR-30.6 The timeline must make the chain traceable end to end: **Purchase → Seller → Branch → Transfers → Sale → Customer → Return/Repair/Other**.
- FR-30.7 All Global Search results respect the user's role and branch permissions.

### 6.22 External Billing System Integration (FR-38)

The shop operates an existing billing system that handles **NEW items only**, and cannot stop using it. ECITY must absorb that system's output daily without letting the two disagree about stock, cash or history.

**Channel control — how double-selling is prevented**

- FR-38.1 Every device carries a **`sales_channel`**: `ECITY`, `EXTERNAL` or `BOTH`, defaulted from its main type (NEW → `EXTERNAL`) and overridable per device by an authorised user.
- FR-38.2 The ECITY billing screen refuses any device whose channel is `EXTERNAL`, at search time and again at save time, with a message explaining that it is billed through the other system.
- FR-38.3 For `BOTH`-channel devices, an authorised user can **Mark as sold externally**, setting `SOLD_PENDING_IMPORT`: stock drops immediately and the later import completes the record with the real invoice details.
- FR-38.4 Every record carries a **`source`** of `ECITY` or `LEGACY`, and every report and analytics view can filter on it or show the two side by side.

**The daily feed**

- FR-38.5 An authorised user uploads the other system's Excel export — sales and, where applicable, purchases — from an upload screen with visible batch history.
- FR-38.6 Import is **two-phase**: the file is parsed and validated into a staging area, the user sees a preview of exactly what will be created, matched, skipped and rejected, and only then commits. A batch commits entirely or not at all.
- FR-38.7 Import is **idempotent**. Re-uploading the same file creates nothing new; re-uploading a corrected file updates only the rows that actually changed. Identity is `(source, external invoice number, external line id)` plus a file hash.
- FR-38.8 Imported records are applied through the **same services as manual entry**, so stock, ledgers, device events, invoices and analytics behave identically to hand-keyed data.
- FR-38.9 A sale row referencing an unknown IMEI is **not** created silently — it goes to an exception queue for a human to link, create or dismiss with a reason. Purchase rows for unknown IMEIs create the device with `source = LEGACY`.
- FR-38.10 A committed batch can be reversed, producing reversal documents rather than deletions.
- FR-38.11 Rejected and unmatched rows are downloadable with row numbers and reasons.

**Keeping the two systems honest**

- FR-38.12 A **daily reconciliation report** compares the imported feed against ECITY's own records: devices sold in the other system but still In Stock here, devices sold in both (an error requiring resolution), and stock each system believes it holds.
- FR-38.13 Because legacy sales take cash into the same physical drawer, **a branch's day cannot be closed until today's external feed has been imported**, unless an authorised user overrides with a recorded reason (FR-13.4).
- FR-38.14 The dashboard shows a standing alert while today's feed is missing for any branch.

**Format independence**

- FR-38.15 The Excel column layout is **not yet known**. The importer is built against a stable internal row shape, with the source column layout isolated in a single adapter plus an editable mapping file, so that a change in the other system's export is a configuration change rather than a code release.

### 6.23 Audit & Data Protection (FR-31)

- FR-31.1 Every record tracks creator, created-at, last modifier, modified-at, and the important old/new values on change.
- FR-31.2 Financial and inventory transactions are never hard-deleted; they move to Cancelled, Voided, Returned or Reversed states.
- FR-31.3 Device history remains traceable after transfers, sales, returns and adjustments.

### 6.24 Backup & Data Recovery (FR-32)

- FR-32.1 Automatic scheduled backups with visible backup history and a tested restore path.
- FR-32.2 Protection from accidental deletion (soft delete + confirmation + permission).
- FR-32.3 Full business data export for the owner's own backup.

### 6.25 Import / Export (FR-33)

- FR-33.1 Import products, IMEIs, customers, suppliers and opening stock from CSV/Excel, with validation and an error report per row.
- FR-33.2 Imports carry branch, main type and GLOBAL/NEW CUT information, and accept multiple IMEI columns per device row even while `imei_slots` is 1.
- FR-33.3 Export sales, purchases, inventory, customers, suppliers, financial transactions and reports.

### 6.26 Opening Balance / Initial Setup (FR-34)

- FR-34.1 Opening inventory with IMEI, purchase value, selling price, main type, GLOBAL/NEW CUT and branch.
- FR-34.2 Opening cash and account balances per branch.
- FR-34.3 Existing customer and supplier outstanding balances.

### 6.27 Business Insights (FR-35)

- FR-35.1 Sales growth/decline, best days, top products/brands/branches, slow-moving stock.
- FR-35.2 Credit trends, average order value, margin changes.
- FR-35.3 Performance comparison across NEW, USED, ER, ACT, GLOBAL, and NEW CUT within GLOBAL.
- FR-35.4 Automated recommendations from historical data are a future version.

### 6.28 Owner / Management Dashboard (FR-36)

- FR-36.1 One business-wide overview across all branches.
- FR-36.2 Sales, profit, orders, cash, account collections, credit sales, customer/supplier dues and stock value.
- FR-36.3 Branch comparison, growth charts, top products/brands/customers, reconciliation alerts.
- FR-36.4 Drill-down path **Business → Branch → Transaction → Product/IMEI**, ending in the full device history from any dashboard or report result.

---

## 7. Core Business Flows (FR-37)

These flows are the acceptance backbone: each must work end to end, with the correct side effects on stock, money and history.

**Purchase**
`Purchase → Seller/Supplier → Purchase Invoice → Branch Stock → IMEI → Main Type (NEW/USED/ER/ACT/GLOBAL) → GLOBAL/NEW CUT if applicable → Supplier Balance`

**Sale**
`Sale → Customer → Product/IMEI → Branch Stock Removed → Payment → Cash/Account → Credit Balance if unpaid → Invoice`

**Customer payment**
`Customer Payment → Outstanding Reduced → Cash/Account Increased → Receipt`

**Return**
`Return → Sale Reversed → Refund → Correct Branch Stock → IMEI Status Updated`

**Branch transfer**
`Branch Transfer → Source Stock → Transfer → Destination Confirmation → Exact IMEI/Quantity Updated`

**Daily closing**
`Daily Closing → Sales/Payments → Expected Amounts → Actual Amounts → Difference → Day Closed`

Every one of these feeds Sales, Inventory, Profit, Customer, Supplier, Branch and Financial analytics, and every device-touching step appends to that device's IMEI history.

---

## 8. Data Model Overview

The conceptual model the requirements imply. The physical schema is specified in the Engineering Design document.

```
business
 └── branch (many)
      ├── users (many-to-many, with per-branch permissions)
      ├── cash_drawer_day
      ├── daily_closing
      └── accounts (branch-owned or shared)

product (accessory or mobile model)
 └── branch_stock (product x branch: qty, min qty)      <- non-serialised
 └── device_unit (one physical handset)                  <- serialised
      ├── device_identifier[]  (1..n IMEIs, one marked primary)
      ├── main_type, is_new_cut + new_cut details
      ├── current_branch, status
      └── device_event[]  (append-only lifecycle ledger)

supplier ──< purchase ──< purchase_item ──> device_unit / branch_stock
                 └──< supplier_payment

customer ──< sale ──< sale_item ──> device_unit / branch_stock
              ├──< sale_payment
              ├──< sales_return ──< return_item
              └──< trade_in ──> device_unit (created)

stock_transfer ──< transfer_item   (Requested/Approved/In Transit/Received/Cancelled)
stock_adjustment
expense
audit_log
```

The **`device_event`** table is the heart of FR-30: an append-only, ordered log of everything that ever happened to one IMEI (purchased, received at branch, transferred out, transferred in, reserved, sold, returned, inspected, reclassified, repaired, damaged, lost, adjusted). The device-history screen is a read of this one table joined out to its source documents; nothing else needs to be reconstructed.

---

## 9. Non-Functional Requirements

### 9.1 Performance

| Operation | Target |
|---|---|
| Global search / IMEI lookup | < 500 ms to first results |
| Device history page | < 1.5 s fully rendered |
| Add a line to a bill (scan → line on screen) | < 300 ms |
| Save a completed sale | < 1.5 s |
| Dashboard (single branch, current day) | < 2 s |
| Analytics over a 12-month range | < 5 s |

Sizing assumption for v1: up to 10 branches, 50 users, 30 concurrent users, ~500 sales/day business-wide, ~250k device units and ~2M device events over five years. Report queries must be indexed for this, not table-scanned.

### 9.2 Money and correctness

- All monetary amounts stored as integer minor units (paise), never floating point.
- Stock changes, payment postings and device status changes occur inside a single database transaction with the document that causes them. A half-written sale is not possible.
- Concurrency: two users must not be able to sell the same IMEI. The device row is locked/conditionally updated at sale time; the loser gets a clear error.
- Every computed balance (customer outstanding, supplier outstanding, drawer cash, account balance) must be reproducible by re-summing its underlying ledger rows.

### 9.3 Availability & reliability

- Target 99.5% availability during shop hours.
- Automated daily database backups with a documented and *tested* restore procedure; point-in-time recovery recommended for the production tier.
- v1 requires connectivity. If the connection drops mid-bill, the in-progress bill must survive in the browser and be re-submittable without duplicating (idempotent submission).

### 9.4 Security

- Passwords hashed with a modern KDF; sessions server-side and revocable.
- Authorisation enforced server-side on every request — both permission and branch scope. The UI hiding a button is never the control.
- Uploaded files (bills, receipts, device photos) served via short-lived signed URLs, never public buckets.
- Audit log is append-only and not editable from the application.
- All traffic over HTTPS; secrets never in the repository.

### 9.5 Usability

- Responsive: desktop-first for back-office, tablet-usable for the counter.
- Keyboard- and scanner-first billing: a barcode/IMEI scanner acts as a keyboard, and the entire bill can be completed without a mouse.
- Every destructive action is confirmed and reversible via state, not deletion.
- Consistent empty, loading and error states; the app never shows a blank screen on failure.

### 9.6 Localisation

- Currency, date format and tax labels configurable at business level. v1 targets Indian retail conventions (GST, UPI); the design must not hard-code them.

---

## 10. Assumptions

- A1 — Single business tenant per deployment in v1 (one shop group, many branches), with the schema kept multi-tenant-ready.
- A2 — India-oriented tax and payment behaviour (GST, UPI) is the primary configuration.
- A3 — Barcode/IMEI scanners are keyboard-wedge devices; no special driver integration is needed.
- A4 — Printing uses the browser's print pipeline to an A4 or 80 mm thermal printer.
- A5 — Staff have shop-provided devices with a working internet connection.
- A6 — `imei_slots` is 1 at launch. The database, API, search, import and reports handle a device with several IMEIs from day one; only the number of input fields on screen is limited, and it is a setting rather than a release.
- A7 — The existing billing system remains in use for NEW items for the foreseeable future, and its Excel export is the only integration surface available — there is no API.
- A8 — Historical data will be brought in through the import module (FR-33) and opening balances (FR-34), not by database surgery.

---

## 11. Open Questions

| # | Question | Why it matters | Needed by |
|---|---|---|---|
| OQ-1 | Do **ER** or **ACT** carry extra information, the way GLOBAL carries NEW CUT? | This is the only part that touches the schema. What the letters *stand for* is a display label (§5.1) and needs no answer to build. If a sub-designation is needed it is a nullable column plus a check constraint — cheaper to know early, but not a blocker | During M2, not before |
| OQ-2 | Does **NEW CUT** need structured fields (e.g. cut type, cut date, notes, photo) or is a flag plus free text enough? | Determines the GLOBAL sub-schema and the analytics breakdown | Module 2 |
| OQ-3 | How many branches, users and daily bills at launch, and over three years? | Drives hosting tier and index strategy | Module 0 (before infrastructure choice) |
| ~~OQ-4~~ | ~~Is GST invoice formatting required to be statutory-compliant?~~ **ANSWERED (M4): yes.** Built — HSN/SAC per product and snapshotted per line, CGST/SGST for intra-state and IGST for inter-state, place of supply derived from the customer's state (falling back to the branch's), and an HSN-wise summary on the A4 invoice. | — | **Closed** |
| ~~OQ-5~~ | ~~Should the owner be able to *edit* a closed day, or only reverse it with a correction entry?~~ **ANSWERED (M7): correction entries; a closing is never rewritten.** A closing is a person counting the money and signing that it matched, so it is stamped and frozen — expected, counted and difference stay exactly as signed. A later fix is a new entry dated into that day, allowed only with `closing.correct` and audited; the day's *reports* pick it up while the signed figures do not move, and the closing history shows the day was corrected after close. The alternative was rejected because an editable close is the straightforward way to hide a till shortage: come up short today, adjust yesterday, the difference disappears. One accommodation: an admin may void a closing (`closing.void`, audited, with a reason) when the day was closed too early, but only while no later day for that branch has been closed. | — | **Closed** |
| OQ-6 | Are WhatsApp/SMS/email notifications and invoice sharing needed in v1? | Adds a third-party provider, cost and compliance | Module 12 (Notifications) |
| ~~OQ-7~~ | ~~Is offline billing genuinely required?~~ **ANSWERED (M4): no.** A reliable connection is acceptable. A half-built bill still survives a refresh or a dropped connection via the persisted cart, and a retried submit cannot double-bill — but saving needs the server. Revisit as its own module if the shop's connection proves unreliable. | — | **Closed** |
| OQ-8 | Multi-currency, or single currency per business? | Currently assumed single | Module 1 |
| OQ-9 | Which existing data must be migrated in (products, IMEIs, customer dues, supplier dues), and in what format? | Shapes the importer and go-live plan | Module M11 |
| OQ-10 | **What do the other system's Excel exports actually look like?** One real sales export and one purchase export, with real data | Nothing about the adapter can be finalised without a sample. Everything else in M12 can be built first | Module M12 |
| OQ-11 | **Is the split strictly "NEW → other system, everything else → ECITY"?** Or are some NEW items also billed here, and are any non-NEW items billed there? | Decides whether channel blocking alone is enough (clean) or the `SOLD_PENDING_IMPORT` path is routinely needed (a race window remains) | Module M4, before billing is built |
| OQ-12 | Does the other system also record **purchases** of NEW stock, and will that export be uploaded too? | If not, ECITY never learns those devices exist until they appear in a sale | Module M12 |
| OQ-13 | How often can the shop realistically upload — once at end of day, or several times? | Determines how stale ECITY's NEW-stock view is, and how noisy the reconciliation report gets | Module M12 |

---

## 12. Success Criteria

The v1 release is successful when, for a live multi-branch shop:

1. Every sale and purchase for a full month is in the system — entered directly, or imported from the other billing system's daily feed — with no parallel paper register.
2. Any staff member can produce a complete, correct history for any IMEI in the shop in under 10 seconds.
3. Daily closing is completed for every branch every day, the external feed is imported before each closing, and any cash mismatch is explainable from the recorded transactions.
4. Customer outstanding and supplier outstanding, as reported by the system, match a manual audit at month end.
5. The owner reviews the consolidated dashboard weekly and can drill from a business number down to an individual device without leaving the app.
6. Physical stock count matches system stock within an agreed tolerance, with all differences recorded as stock adjustments.

---

## 13. Release Plan

| Release | Contents | Outcome |
|---|---|---|
| **Alpha** (Modules 0–5) | Auth, master data, inventory, purchases, sales, credit | One branch can transact end to end, internally tested |
| **Beta** (Modules 6–9) | Returns, exchange, cash/bank/expenses, daily closing, transfers, adjustments, global search & device history | One real branch runs live on the system in parallel with existing records |
| **v1.0** (Modules 10–14) | Analytics, reports, import/export, opening balances, **external billing feed**, notifications, warranty, backup and hardening | All branches live; paper records retired; both systems reconciled daily |
| **v1.1+** | Automated recommendations, offline billing, messaging channels, statutory GST integration | Driven by OQ-4, OQ-6 and OQ-7 outcomes |
