# Manual Test Checklist

## How to Use This

Automated tests cover the mechanics — 481 unit and integration tests, 920
browser tests across four screen sizes. This checklist covers what a person
still has to judge: does it *feel* right, does the wording make sense, does
the shop's actual workflow survive contact with the screen.

Work through a module's section after it is built, and again before go-live.
Tick as you go. Anything that fails is a bug, not a note.

One section per module. M1–M14 append to this file as they ship.

### Before you start

```bash
docker compose up -d          # or open Postgres.app
npm run db:migrate
npm run db:seed               # resets the three test accounts
npm run dev                   # http://localhost:3000
```

To return to a known-clean state at any point, re-run `npm run db:seed`.
It upserts, so it is safe to repeat.

### Test accounts

| Email | Password | Role | Branch scope |
|---|---|---|---|
| `admin@ecity.local` | `ChangeMe!2026` | Admin / Owner | All branches (14 permissions) |
| `manager@ecity.local` | `ChangeMe!2026` | Branch Manager | MAIN only (7 permissions) |
| `staff@ecity.local` | `ChangeMe!2026` | Staff | MAIN only (3 permissions) |

`ChangeMe!2026` is only the fallback the seed uses when `SEED_PASSWORD` is not
set — which is the normal case on your own machine. **On staging or any
deployed server the password is whatever `SEED_PASSWORD` was set to** in that
server's `.env`; the accounts above are otherwise identical. Read it back with
`grep SEED_PASSWORD ~/app/.env`.

Use a **private/incognito window** to hold a second session, so you can be two
users at once without signing out.

> These accounts must never exist in production. They are flagged
> `mustChangePassword` and are created only by the seed.

---

# M0 — Foundations

**Delivers.** PRD FR-1.1 – FR-1.5, FR-31.1, plus branch context and the
authorisation layer everything else depends on.

Signing in as the admin exercises perhaps a tenth of this module. The
interesting part is what the *other two* users cannot do.

## 1. Authentication

Start signed out, at `/login`.

- [ ] Wrong password for a real account → *"Email or password is incorrect."*
- [ ] A made-up email with any password → **the identical message**. It must
      not reveal whether the account exists
- [ ] Empty email or password → inline validation, no request sent
- [ ] Visit `/settings/users` directly while signed out → redirected to `/login`
- [ ] Correct credentials → lands on `/dashboard`
- [ ] Avatar menu → **Sign out** → back at `/login`
- [ ] After signing out, the browser Back button does **not** restore the app
- [ ] Sign in again in a second browser → both sessions work independently

### Password reset

Email is not wired up until M14, so the reset link is shown on screen in
development.

- [ ] `/forgot-password` → enter `admin@ecity.local` → confirmation appears
- [ ] A **yellow development box** shows the reset link
- [ ] Enter an address that does not exist → **the same confirmation**, no
      hint that the account is unknown
- [ ] Follow the link, set a new password → redirected to `/login`
- [ ] The **old** password no longer works
- [ ] The **new** password works
- [ ] Open the same reset link a second time → refused as already used
- [ ] Reset the password back to `ChangeMe!2026`, or re-run `npm run db:seed`

### Lockout

- [ ] Get the password wrong 8 times in a row → *"Too many failed attempts."*
- [ ] Wait 15 minutes, or `npm run db:seed`, to clear it

## 2. Branch scoping

The heart of M0. Sign in as each user and open the branch switcher in the
header.

- [ ] **admin** — sees *All branches (consolidated)*, MAIN and NORTH
- [ ] **manager** — sees **MAIN only**. No NORTH, and no "All branches"
- [ ] **staff** — sees MAIN only
- [ ] As admin, switch between branches → the dashboard's *Branch context*
      card updates (active branch, accessible count, consolidated yes/no)
- [ ] The chosen branch survives a page reload
- [ ] On a phone-width window the switcher shows the branch **code**, not the
      full name, and the header still fits

## 3. Permissions

Check what is **missing**, not what is present.

| User | Sidebar should show |
|---|---|
| admin | Dashboard, Users, Roles, Audit log |
| manager | Dashboard, Users, Audit log — **no Roles** |
| staff | **Dashboard only** |

- [ ] Each user's sidebar matches the table
- [ ] As **staff**, type `/settings/roles` into the address bar → redirected,
      not shown
- [ ] As **staff**, type `/settings/users` → redirected
- [ ] As **manager**, `/settings/roles` → redirected
- [ ] The dashboard's *Your permissions* card lists 14 / 7 / 3 entries
      respectively

## 4. Server-side authorisation

**A hidden menu item is not a control.** This step proves the server refuses
the request, not just that the button was hidden.

Sign in as **staff** in the browser, then copy the session cookie from
DevTools → Application → Cookies → `ecity_session`, and run:

```bash
COOKIE='ecity_session=PASTE_VALUE_HERE'
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/users  -H "Cookie: $COOKIE"
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/audit  -H "Cookie: $COOKIE"
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/roles  -H "Cookie: $COOKIE"
```

- [ ] All three return **403**, not data
- [ ] The body reads `{"error":"…","code":"FORBIDDEN"}`
- [ ] With no cookie at all → **401**
- [ ] As **manager**, forcing another branch is refused:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/session/branch \
  -H "Cookie: $COOKIE" -H 'content-type: application/json' -d '{"branchId":2}'
```

- [ ] Returns **403** — branch NORTH is not theirs
- [ ] `{"branchId":null}` (the consolidated view) also returns **403**

## 5. User management

As **admin**, Users → Add user.

- [ ] Password under 10 characters → rejected inline
- [ ] An email that already exists → *"A user with this email already exists."*
- [ ] No role chosen → *"Choose a role."*
- [ ] Create a Staff user assigned to **NORTH** only
- [ ] They appear in the user list with the right role and branch badge
- [ ] Sign in as the new user → branch switcher shows **NORTH only**
- [ ] Their first sign-in is flagged "must change password"

### Roles

As **admin**, Settings → Roles.

- [ ] Select **Staff**, tick *View the audit log*, Save
- [ ] Sign in as staff → **Audit log now appears** in their sidebar
- [ ] Any staff session open elsewhere was **signed out** when the role
      changed, rather than keeping stale permissions until next login
- [ ] Untick it and Save again
- [ ] Try to remove *Create and edit users* from **Admin** → refused, so the
      business cannot lock itself out
- [ ] System roles cannot be deleted

## 6. Audit log

As **admin**, Settings → Audit log.

- [ ] Everything done above appears: `LOGIN`, `LOGIN_FAILED`, `LOGOUT`,
      `CREATE`, `PERMISSION_CHANGED`, `PASSWORD_RESET_COMPLETED`
- [ ] Each row shows who, what, when
- [ ] Expanding a *"n field(s)"* row shows old → new values
- [ ] A password hash **never** appears in a changes payload
- [ ] Paging works if there are more than 50 entries

The log is append-only, enforced by the database rather than by code:

```bash
psql ecity -c "update audit_log set summary='tampered' where id=1;"
psql ecity -c "delete from audit_log where id=1;"
```

- [ ] Both fail with `audit_log is append-only`

## 7. Responsive layout

Resize the window, or use DevTools device mode. Check at ~375px, ~810px and
full width.

- [ ] Below ~768px the sidebar is replaced by a **hamburger** top-left
- [ ] Tapping it opens a drawer; choosing a destination closes it
- [ ] On **Users**, the table becomes **one card per user**
- [ ] On **Audit log**, entries become cards
- [ ] Nothing scrolls sideways at any width
- [ ] Buttons and links are comfortably tappable with a thumb
- [ ] The **Roles** editor is usable — role list becomes a horizontal strip
- [ ] Forms stack, with full-width buttons

## 8. Theme

- [ ] Primary colour is **black** throughout (buttons, active nav item)
- [ ] Set `APP_THEME=navy` in `.env`, restart → the whole app is blue, with
      no other visual change
- [ ] An invalid value such as `APP_THEME=nonsense` → falls back to black
      rather than breaking
- [ ] Set it back to `onyx`

## What M0 deliberately does **not** include

Do not raise these as bugs:

- No products, inventory, IMEIs, customers or suppliers — those are M1 and M2
- The dashboard shows branch context and permissions, **not** sales figures.
  The real dashboard is M10
- No branch create/edit screen — M1. The two seeded branches are fixed
- Password reset emails print to screen instead of sending — M14
- Notifications, reports, exports — later modules

---

# M1 — Master Data

**Delivers.** PRD FR-2.1 – FR-2.4, FR-3.1, FR-3.2, FR-3.8, FR-5.10, FR-6.6,
FR-10.1.

The shop gets configured and the people it trades with exist. Nothing here
moves stock or money yet — these are the pickers and directories the rest of
the system draws on.

**Customer** = someone who buys from the shop. **Supplier** = someone the shop
buys from. Both are shared across every branch.

## 1. Business settings

Sign in as **admin**, go to **Settings → Business**.

- [ ] Four tabs: Profile, Tax, Payments, Expenses
- [ ] On a phone the tabs scroll sideways rather than wrapping

### Profile

- [ ] Edit the business name, save, reload — the change persisted
- [ ] Enter a malformed GST number → *"Enter a valid 15-character GSTIN."*
- [ ] Enter a valid one (`29ABCDE1234F1Z5`) → accepted, stored upper-case
- [ ] Currency is fixed at INR and cannot be edited
- [ ] Toggle **Prices include tax** → the explanation below it changes
- [ ] Save, reload → the toggle held its new position

### Tax

- [ ] Five GST slabs are listed: 0, 5, 12, 18, 28%
- [ ] **GST 18%** is marked Default
- [ ] Rates display as `18.00%`
- [ ] Add a rate named `GST 3%` at `3` → appears in the list
- [ ] Add one with the same name → refused as a duplicate
- [ ] Deactivate a non-default rate → shows Inactive
- [ ] Try to deactivate the **default** rate → refused, with the reason

### Payments

- [ ] Cash, UPI, Card, Bank Transfer are listed with their type badge
- [ ] Cash carries a **Cash drawer** badge; the others do not
- [ ] Deactivate UPI → shows Inactive; reactivate it
- [ ] Try to deactivate **Cash** → refused: at least one cash method must stay
      active

### Expenses

- [ ] Seven categories: Rent, Electricity, Salaries, Transport, Packaging,
      Repairs, Miscellaneous
- [ ] Add one → appears immediately
- [ ] Add the same name again → refused

## 2. Branches

**Settings → Branches** as admin.

- [ ] MAIN and NORTH are listed with manager and user counts
- [ ] **Add branch** — code `MGROAD`, name `MG Road` → created and listed
- [ ] The code is forced to upper case even if typed lower
- [ ] Add another with code `MGROAD` → *"Branch code MGROAD is already in
      use."*
- [ ] A code containing a space or `!` is rejected inline
- [ ] Open the new branch, change its name, save → the list shows the new name
- [ ] Assign a manager from the dropdown → shows in the Manager column
- [ ] Leave the manager empty → **saves without error**
      *(this failed silently before — see §5)*

### Deactivation — the rule that matters (FR-3.8)

- [ ] Deactivate `MG Road` → badge turns Inactive, **the row stays**
- [ ] Open the header **branch switcher** → MG Road is **gone**
- [ ] Reactivate it → it comes back in the switcher
- [ ] Deactivate every branch but one, then try the last → refused: at least
      one branch must stay active

## 3. Customers and suppliers

**Customers** in the sidebar.

- [ ] The list is empty, or holds only what you have created
- [ ] **Add customer** with a name only → saves. A walk-in has nothing else
- [ ] Add one with phone `9876543210`
- [ ] Add a second with the **same phone** → *"Another customer (…) already
      uses this phone number."*
- [ ] Give a **supplier** that same phone → **allowed**, they are different
      directories
- [ ] Edit a customer, keep their phone unchanged, save → no false duplicate
- [ ] Enter `not-a-phone` → rejected inline
- [ ] Enter `MiXeD@Example.COM` → stored lower-case (check in Studio)

### Search and status

- [ ] Search by part of a name → matches
- [ ] Search by phone → matches
- [ ] Search by email → matches
- [ ] Search by GST number → matches
- [ ] **Deactivate** a customer → disappears from the default list
- [ ] Click **Show inactive** → they reappear, badged Inactive
- [ ] Reactivate → back to normal

Repeat the same pass on **Suppliers**. Suppliers additionally have a
**Company** field; customers do not.

## 4. Permissions

| User | Should see in the sidebar |
|---|---|
| admin | Customers, Suppliers, Business, Branches, Users, Roles, Audit log |
| manager | Customers, Suppliers, Business, Users, Audit log — **no Branches, no Roles** |
| staff | Customers, Suppliers — **no Settings group at all** |

- [ ] Each user's sidebar matches
- [ ] As **staff**, open `/settings/business` directly → redirected
- [ ] As **staff**, open `/settings/branches` directly → redirected
- [ ] As **staff**, open `/customers/new` directly → redirected (they may view
      customers, not create them)
- [ ] As **manager**, `/settings/branches` → redirected. Managers run a
      branch; they do not create them

At the API, signed in as staff (see M0 §4 for how to get the cookie):

```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/branches?manage=1 \
  -H "Cookie: $COOKIE"
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/customers \
  -H "Cookie: $COOKIE" -H 'content-type: application/json' -d '{"name":"Sneaky"}'
```

- [ ] The POST returns **403**

## 5. Form errors are never silent

A bug found during M1: a validation failure with no visible message meant the
Save button appeared to do nothing.

- [ ] Paste 300 characters into any address field → a visible error appears
- [ ] On every form, an invalid field shows red text under **that** field
- [ ] No form ever fails with the button simply doing nothing

## 6. Audit

**Settings → Audit log** as admin.

- [ ] Everything above is recorded: branch created, customer created, tax rate
      added, payment method deactivated
- [ ] Entity types include `branch`, `customer`, `supplier`, `tax_rate`,
      `payment_method`, `business`
- [ ] Expanding a row shows old → new values

## 7. Responsive

At ~375px, ~810px and full width:

- [ ] Customers, Suppliers and Branches lists become **cards** below 768px
- [ ] Business settings tabs scroll rather than wrap
- [ ] Forms stack to one column; buttons go full width
- [ ] Nothing scrolls sideways
- [ ] The sidebar's **Master data** and **Settings** groups appear in the
      mobile drawer

## What M1 deliberately does **not** include

- **No customer/supplier history tab yet.** Clicking a customer opens the edit
  form. The profile view showing their purchases, returns and credit arrives
  with M4/M5, when there is something to show. *This is a known gap against
  M1's stated criteria, carried into M2.*
- No products, stock or IMEIs — that is M2
- Attachments have a working API and storage layer, but **no upload button on
  any screen yet**; the first screen that needs one is M3's purchase form
- Logo upload is not wired to the business profile

---

# M3 — Purchases · specs on a line

*Added after M11, when a real shipment showed the gap: a purchase knew the
product and the IMEI and nothing else, so ten iPhones arrived as ten handsets
that did not know they were 256GB green — and each one had to be opened and
edited afterwards.*

- [ ] On a **serialised** line, **Specs for this line** shows RAM, Storage,
      Colour and Variant
- [ ] They are **not** shown on a counted line — a box of cables has no RAM
- [ ] Book in 2 handsets with RAM 8 GB, Storage 256 GB, Colour Green
- [ ] The purchase page shows `256 GB · 8 GB · Green` under the product name.
      *A bill for "iPhone 17 × 10" is ambiguous a month later*
- [ ] Open each handset in Devices — **both** carry all three
- [ ] Book in 3 more; on the second only, open its spec box (the slider icon
      beside the IMEI) and set Colour = Black, battery = 87
- [ ] That handset is Black at 87%; the other two are Green with no battery
      figure
- [ ] The odd one still shows **256 GB** and **8 GB**. *Blank means "same as
      the line", not "empty"*
- [ ] Scanning still works: type an IMEI, press Enter, and the cursor lands on
      the **next IMEI box** — never in a spec field
- [ ] **Duplicate line** copies the product, cost and specs and leaves the
      IMEIs blank. *A mixed shipment is the same phone in four storages*
- [ ] A handset booked in before this change still opens and edits normally

## What this does not do

- **No specs on the product.** "iPhone 17 256GB Green" as its own product
  would be 24 products for one model, invented at the goods-inwards desk in
  whatever spelling was to hand — and used stock would still differ piece by
  piece
- **No retro-fill.** Changing a confirmed line's specs does not rewrite
  handsets already created; correct those on their own screens

# Lists: paging and sorting

*Carried debt, cleared after M11. These four screens had no page control at
all: a shop with sixty users saw twenty-five and no sign there were more.*

- [ ] **Users**, **Branches** and **Low stock** each say `Showing 1–25 of N`,
      or explain themselves when empty
- [ ] Click a column heading — the rows re-order and the URL gains
      `sort=` and `dir=`
- [ ] Click the same heading again — it reverses
- [ ] Copy that URL into another tab: the same sorted view comes back. *Sorting
      is a link, not something the page remembers privately*
- [ ] Go to page 2, then sort — you land back on **page 1**. *Staying on page 7
      of a re-ordered list shows a stranger's rows*
- [ ] On Low stock, the default order is **worst first** — furthest below its
      minimum at the top, not alphabetical
- [ ] Sort Low stock by Product, then page forward: the second page continues
      the alphabet. *It is sorting the whole list, not the page on screen*
- [ ] A blank cell (a branch with no city, a user who has never signed in)
      sorts to the **bottom** either way
- [ ] **Roles** shows a count and has **no** page control. *It is an editor:
      paging the list would mean turning a page to reach the role you came to
      edit*
- [ ] Edit `?sort=` in the address bar to something invented — the screen falls
      back to its normal order rather than breaking

**On a phone**, where the tables become cards:

- [ ] A **Sort** strip sits above the cards, scrolling sideways
- [ ] Tapping one re-orders the cards and marks it as the active sort
- [ ] Tapping it again reverses. *Sorting must exist on the screen the owner
      actually carries*

# M4 — Sales & Billing

**Delivers.** PRD FR-6.1 – FR-6.8, FR-26.1, FR-26.3, FR-26.4, FR-38.2, FR-38.3.

This is the screen the shop lives on. Everything before it existed so that this
one could work: a bill is built, money is taken, stock drops, and an invoice
comes out. Test it standing up, at speed, the way the counter will.

**Before you start.** You need stock. Run through M3 once to bring in at least
one USED or ER handset with an IMEI, and one accessory with a quantity of ten.

## 1. Speed at the counter

Go to **Billing**.

- [ ] The search box already has focus — you can start typing without clicking
- [ ] Type an accessory name → results appear as you type
- [ ] With exactly one result, pressing **Enter** puts it on the bill
- [ ] Scan or paste an IMEI → that exact handset lands on the bill
- [ ] **Time yourself:** accessory → Cash → Save, keyboard only, under 20 seconds
- [ ] The whole flow needs no mouse

## 2. The bill

- [ ] A device line shows the IMEI or serial underneath the product name
- [ ] A device line shows its main type (USED / ER / ACT / GLOBAL)
- [ ] A GLOBAL device also shows **NEW CUT** where that applies
- [ ] A device line's quantity is fixed at 1 and cannot be edited
- [ ] An accessory line's quantity can be raised, and the total follows
- [ ] Adding the same IMEI twice is refused with a clear message
- [ ] Line discount reduces that line only; bill discount reduces the total
- [ ] **Staff** signed in cannot give a discount at all
- [ ] Totals: taxable + GST equals the total, exactly, to the paisa
- [ ] Change a quantity and the totals update instantly

## 3. The bill survives real life

- [ ] Build a half-finished bill and **reload the page** → it is still there
- [ ] Clear bill empties it, and asks nothing you would regret confirming
- [ ] Switch branch with a bill open → the bill clears (it belonged to the
      other branch's stock)

## 4. Payment

- [ ] **+ Cash** fills the full balance in one press
- [ ] Split across two methods (say Cash 500 + UPI rest) → both are recorded
- [ ] Pay less than the total with **no customer attached** → refused, because
      an unpaid balance needs someone to owe it
- [ ] Attach a customer, then save partly paid → the sale shows **PARTIAL**
- [ ] Overpaying is refused

## 5. Customer, without leaving the bill

- [ ] Press **New** beside the Customer box
- [ ] Name and phone only → **Add to bill**
- [ ] The new customer is created *and* attached, and the bill is untouched
- [ ] A duplicate phone number is refused with a message naming the clash
- [ ] Cancel closes the dialog and changes nothing

## 5c. Pickers do not silently truncate

Customers, suppliers and products are chosen through a **searchable picker**,
never a fixed dropdown — a capped list drops records with no hint that it did.

- [ ] The Customer box on billing opens a search, not a long dropdown
- [ ] Typing a phone number finds the customer
- [ ] A customer created minutes ago is findable
- [ ] Same for **Supplier** on the purchase form
- [ ] Same for **Product** on the purchase form and on Add device

## 5b. Customer history (FR-6.7)

Open **Customers** and click a customer who has bought something.

- [ ] The **History** tab opens first — that is what you came to see
- [ ] Total spend, number of purchases, outstanding and last purchase date
- [ ] Every invoice is listed, newest first, with branch and item count
- [ ] Clicking an invoice number opens that sale
- [ ] Purchases from **every branch** appear, not just the current one
- [ ] A part-paid bill shows **PARTIAL**, and outstanding is non-zero and red
- [ ] A voided bill is listed but does **not** count towards spend or dues
- [ ] A customer who has bought nothing says so, rather than showing an empty
      table
- [ ] The **Details** tab still edits the customer and saves
- [ ] On a phone the history becomes cards and nothing overflows sideways

## 6. The invoice

Save a bill; you land on the sale.

- [ ] The invoice shows shop name, GSTIN, branch, invoice number and date
- [ ] Customer details appear, or "Walk-in customer"
- [ ] Every line shows quantity, price, tax and amount
- [ ] GST is broken out per rate
- [ ] **Print A4** produces a clean full-page invoice with no navigation on it
- [ ] **Print receipt (80 mm)** produces a narrow slip that fits the thermal roll
- [ ] **Download PDF** saves a file named after the invoice number
- [ ] Open the PDF: every figure matches the screen, and no character shows as
      a blank box
- [ ] The PDF's amounts are labelled INR (the rupee glyph is deliberately not
      used — see `src/server/pdf/invoice-pdf.tsx`)
- [ ] **Share** hands the PDF to the phone's share sheet (WhatsApp, mail); on a
      desktop browser it copies the invoice link instead

## 6b. The invoice is a statutory GST document (OQ-4)

First set **Settings → Business → GST state**, and a **GST state** on each
branch. Give a few products an **HSN code** (8517 phones, 8544 cables).

- [ ] The invoice is headed **Tax Invoice**
- [ ] **Place of supply** appears, with the state code and name
- [ ] Each line shows its **HSN** code
- [ ] An ordinary local sale shows **CGST** and **SGST** as separate lines,
      each half the rate — never a single combined "GST 18%"
- [ ] CGST + SGST adds up to exactly the tax shown
- [ ] An **HSN summary** table appears below the totals on A4
- [ ] The HSN summary's taxable and tax columns add up to the invoice totals
- [ ] Set a customer's **GST state** to another state, bill them → the invoice
      shows a single **IGST** line and no CGST/SGST
- [ ] The customer pays the same total either way — only the split changes
- [ ] A product with no HSN still bills; the line shows "—" and stays out of
      the summary
- [ ] The downloaded PDF matches the screen on every one of these

## 7. Stock actually moved

- [ ] The handset you sold is now **Sold** on the device page
- [ ] Its IMEI no longer appears in billing search
- [ ] The accessory's branch stock dropped by the quantity sold
- [ ] The stock ledger shows one `SALE` row referencing the invoice

## 8. The other billing system (FR-38.2, FR-38.3)

- [ ] A **NEW** handset never appears in billing search at all
- [ ] Forcing one onto a bill is refused server-side too
- [ ] Open that device → **Sold in other system** is offered
- [ ] Mark it → status becomes `SOLD_PENDING_IMPORT` and stock drops now
- [ ] It disappears from billing search, so it cannot be sold twice
- [ ] An ECITY-channel device does **not** offer that button

## 9. Sales list

- [ ] Every saved sale is listed, newest first
- [ ] Search by invoice number, customer name or IMEI finds it
- [ ] Payment status filter: PAID / PARTIAL / UNPAID each return the right rows
- [ ] Branch filter narrows to that branch; a branch-scoped user sees only theirs
- [ ] From/To dates include both end days
- [ ] Filters survive a page reload (they are in the URL, so they are shareable)

## 10. Concurrency — needs two browsers

- [ ] Sign in on two windows, put the **same IMEI** on both bills
- [ ] Save both → the first succeeds, the second fails with a clear message
- [ ] The device is Sold exactly once, and only one sale exists
- [ ] Save a bill, then press Save again on a restored copy → still one sale

## 11. Responsive

- [ ] On a phone the billing screen is usable one-handed; nothing overflows
      sideways
- [ ] The cart and the totals panel stack rather than squeeze
- [ ] The invoice is readable on a phone
- [ ] On a large screen the search, cart and payment panel sit side by side

## What M4 deliberately does **not** include

- **No returns or exchanges** — that is M6
- **No trade-in** on the bill — also M6
- **No Excel import** of the other system's sales — that was M12, now deferred
  because the two businesses are separated (docs/02 §2.3); devices marked
  `SOLD_PENDING_IMPORT` are waiting for it
- **Returns do not appear in customer history yet** — the tab says so; they
  arrive with M6. Payments now have their own Statement and Receipts tabs
- No daily cash-up or Z-report — M7

---

# Cross-cutting — Lists & pagination

Every list in the app is paginated server-side at **25 rows a page**. Check
these on **Products, Devices, Customers, Suppliers, Purchases, Sales** and the
**Audit log** — the control is the same one everywhere.

- [ ] Under each list: *"Showing 1–25 of N"*, with the real total
- [ ] A list with more than 25 rows offers **Previous / Next**
- [ ] A list with 25 or fewer offers no page buttons, but still states the count
- [ ] On page 1, **Previous** is greyed out and does nothing when clicked
- [ ] On the last page, **Next** is greyed out
- [ ] **Next** advances, and the rows are genuinely different
- [ ] Page 1's URL has no `?page=` on it — one address for the first page
- [ ] Apply a filter, then page forward → **the filter is still applied**
- [ ] Change a filter while on page 3 → you go back to page 1, not an empty page
- [ ] Copy a page-2 URL into a new tab → same page, same filters
- [ ] Browser back returns to the previous page of results
- [ ] On a phone the buttons are big enough to tap and do not overflow sideways

---

# M4 — Billing · price prefill and camera scanning

*Added after M13. The till showed a blank price on every handset; and the
counter has a laser scanner but a salesperson on the floor has only a phone.*

## Price

- [ ] A purchase line has **Selling price (₹)** beside the unit cost
- [ ] Book a handset in at cost 18,000, selling 24,000
- [ ] Scan it at the till — the price shows **24,000** without typing
- [ ] Book another in with the selling price **left blank**
- [ ] At the till it shows the **product's list price**. *Blank means "use the
      list price", not "free"*
- [ ] A handset bought before this change also prefills now, from the product
- [ ] Change the price on the bill — it still saves what you typed

## Camera (on a phone)

- [ ] On a **desktop with no camera**, no camera button appears
- [ ] On a **phone**, a camera button sits beside the scan box
- [ ] Tap it — the back camera opens with a frame to aim through
- [ ] Point at an IMEI barcode: it fills the box and closes by itself
- [ ] The item goes on the bill exactly as if you had typed it
- [ ] Scan the **serial** barcode next to it — it does *not* auto-add; it
      shows what it read and asks. *Putting the wrong handset on a bill is
      worse than a slow scan*
- [ ] Deny camera permission — it says so plainly instead of hanging
- [ ] Over plain **http** it explains that the camera needs a secure address
- [ ] The purchase form's IMEI boxes each have the same camera button
- [ ] The purchase line also has **one button for the whole line** — it stays
      open, fills each box in turn, and shows a running count
- [ ] Scanning the same box twice does **not** fill two slots
- [ ] It says "3 of 10" as you go, so you need not look at the form behind it
- [ ] **Done — N scanned** closes it
- [ ] The **global search** (the magnifier in the header) has a camera button;
      the read lands in the search box and an exact IMEI opens its device
- [ ] The **laser scanner still works** on the desktop till, unchanged

# M5 — Payments, Credit Sales & Customer Dues

**Delivers.** PRD FR-7.1 – FR-7.6.

Credit is where a shop quietly loses money. This module exists so that the
answer to "who owes us what, and since when?" is one screen and always right.

**Before you start.** Set **Settings → Business → Default credit period**
(30 days is the default). You need one product in stock and one customer.

## 1. A bill can leave the counter unpaid

- [ ] Bill something to a **named customer** and pay nothing → the **Credit
      terms** panel appears, with a due date already filled in
- [ ] Pay the bill in full → the credit panel disappears (a cash sale needs no
      due date)
- [ ] Pay part of it → the panel comes back
- [ ] Try to leave a balance with **no customer** → refused, because a walk-in
      cannot be given credit
- [ ] Change the due date by hand and save → the sale shows that date
- [ ] Save unpaid → the sale shows **UNPAID**; part-paid shows **PARTIAL**
- [ ] Open that sale: it shows **Outstanding**, the **due date**, your credit
      note, and a **Collect payment** button
- [ ] Past the due date, the sale says *overdue* in red
- [ ] A fully paid sale shows none of that panel

## 2. Customer dues (FR-7.6)

Open **Sell → Customer dues**.

- [ ] Your unpaid customer is listed, with the amount owed
- [ ] **Total outstanding** matches the sum of the rows
- [ ] The **By age** panel adds up to the same total
- [ ] A bill created today sits in the **0–7 days** column
- [ ] Search by customer name and by phone number
- [ ] Filter by branch → only that branch's bills count
- [ ] **Overdue only** hides a bill whose due date has not passed yet
- [ ] A customer who has paid everything drops off the list entirely
- [ ] On a phone the rows become cards and nothing scrolls sideways

## 3. Collecting money (FR-7.3)

- [ ] Press **Collect** on a row → the customer's open bills are listed,
      oldest first
- [ ] Type an amount → it is allocated down the list, oldest first, and you
      can see exactly which bills it lands on before saving
- [ ] **Settle everything** fills in the exact total owed
- [ ] **Choose invoices** lets you allocate by hand instead
- [ ] Allocating more than a bill owes is refused, and says which bill
- [ ] Save → you land on a printable receipt with its own number
- [ ] The bill is now **PAID** on the sales list *and* on the sale itself
- [ ] Three part payments settle a bill and flip it to Paid on the third

## 4. Paying at a different branch (FR-7.5)

- [ ] Bill something on credit at **Branch A**
- [ ] Collect the money at **Branch B** (change *Collected at* on the form)
- [ ] The receipt shows Branch B; the invoice still shows Branch A
- [ ] The statement shows both, each against its own line

## 4b. Branch-wise (FR-7.6)

The **By branch** panel appears on the dues screen when there is more than one
branch with activity.

- [ ] Each branch shows outstanding, overdue, collected and receipt count
- [ ] The **All branches** row adds up the columns above it
- [ ] Outstanding here matches the total at the top of the page
- [ ] Bill on credit at Branch A, collect at Branch B → A's *outstanding*
      falls, B's *collected* rises. They are not supposed to match
- [ ] Change the **Collected from / to** dates → only the collected column
      moves; what is owed is owed regardless of the window
- [ ] Void a receipt → it stops counting as collected, and the debt returns
      to the branch that raised the bill

## 5. The receipt (FR-26.2)

- [ ] Shop name, branch, receipt number, date, customer
- [ ] The amount, the method, and the reference if you gave one
- [ ] **Applied to** lists each invoice and how much went to it
- [ ] Money beyond what was owed shows as **held on account as an advance**
- [ ] **Balance after this receipt** matches the customer's account
- [ ] Print A4 and Print receipt (80 mm) both produce clean output

## 6. Voiding a receipt

- [ ] **Void** is offered to the owner and manager
- [ ] It is **not** offered to counter staff — they may collect, not erase
- [ ] Voiding needs a reason
- [ ] After voiding: the receipt is marked VOIDED but still on record
- [ ] The invoice it settled is **UNPAID** again
- [ ] The customer's balance has gone back up
- [ ] The statement shows a **Reversal** line — the old line is untouched
- [ ] Voiding the same receipt twice is refused

## 7. The statement (FR-7.6)

Open a customer → **Statement**.

- [ ] Every movement, oldest first, with a running balance
- [ ] An invoice appears as a debit; a payment as a credit
- [ ] Clicking an invoice number opens that sale; a receipt opens that receipt
- [ ] The closing balance matches the figure at the top of the customer page
- [ ] A customer in credit shows a negative balance labelled *in credit*

## 8. The numbers reconcile

This is the one that matters. Pick any customer with dues:

- [ ] Add up what their open invoices still owe, by hand
- [ ] Compare with the balance on the dues list — they must be identical
- [ ] Compare with the statement's closing balance — also identical
- [ ] Void a receipt and repeat: all three still agree

## What M5 deliberately does **not** include

- **No returns or exchanges** — M6. A refund is not a negative payment
- **No cash drawer or daily closing** — M7. Money collected is recorded, but
  the day is not yet reconciled
- **No statements by email or WhatsApp** — M13
- **No interest, credit limits or dunning letters** — not in v1 at all

---

# M6 — Returns, Exchange & Trade-In

**Delivers.** PRD FR-8.1 – FR-8.5, FR-9.1 – FR-9.3, plus correcting a device.

Goods come back and old phones come in. The rule underneath everything here:
**a returned handset is never immediately sellable again.**

**Before you start.** You need a completed sale with a handset on it and
another with an accessory. Sign in as **admin** unless a step says otherwise.

## 1. Taking a return (FR-8.1)

- [ ] **Sell → Returns → Take a return** offers one search box
- [ ] Find a bill by its **invoice number**
- [ ] Find the same bill by **customer name**
- [ ] Find it by the **IMEI** of a handset on it
- [ ] Opening a sale and pressing **Take a return** gets you to the same place
- [ ] Only lines with something left to return are offered
- [ ] Returning 2 of 5 gives back exactly two fifths of that line
- [ ] Asking for more than remains is refused, and says how many are left
- [ ] Return 3 of 4, then try to return 2 more → refused, 1 left
- [ ] A whole bill returned at once is marked **FULL**; part of one is **PARTIAL**
- [ ] Goods can be returned to a **different branch** than they were sold at

## 2. A returned handset is not sellable (FR-8.2)

This is the one most likely to be got wrong. Test it properly.

- [ ] Return a handset → it appears in **Returns → Inspection queue**
- [ ] Search that IMEI at the till → **nothing comes up**
- [ ] The device page shows status **RETURNED**
- [ ] An accessory behaves differently: it goes straight back into branch stock
      and can be sold again immediately

## 3. Inspection (FR-8.3)

- [ ] **Inspect** offers Available, Used, Damaged, Repair required
- [ ] Grading **Available** → the handset leaves the queue and reaches the till
- [ ] Grading **Used** → also sellable, and the condition is recorded
- [ ] Grading **Damaged** → status DAMAGED, still not sellable
- [ ] Grading **Repair required** → status REPAIR, still not sellable
- [ ] Notes typed during inspection appear on the device
- [ ] Inspecting something that is not awaiting inspection is refused
- [ ] Signed in as **staff**: the queue is visible but there is **no Inspect
      button** — releasing stock for sale is not the counter's decision

## 4. Classification survives the whole path (FR-8.4)

The acceptance test for this module. Do it exactly.

- [ ] Buy a handset as **GLOBAL** with **NEW CUT** ticked
- [ ] Sell it, then return it
- [ ] In the inspection queue it still shows **GLOBAL**
- [ ] Grade it **Used**
- [ ] On the device page it **still reads GLOBAL and NEW CUT**, with condition
      Used recorded separately

Condition and classification are different facts. Grading a handset's
condition must never rewrite what kind of device it is.

## 5. The money (FR-8.5)

- [ ] Refund to a **payment method** — money goes back out
- [ ] Refund to the **customer's account** — no cash moves, they owe less
- [ ] A walk-in cannot have their account credited; it is refused
- [ ] A **deduction** (restocking fee) reduces what is handed back
- [ ] **The one that matters:** a customer who paid in full, returned the goods
      and got cash back ends with a **zero balance** — not in credit. Check
      Customers → their Statement
- [ ] Returning against an **unpaid** bill just reduces what they owe

## 6. Trade-in (FR-9.1 – FR-9.3)

On the billing screen, with something in the cart:

- [ ] **Trade-in → Add** takes IMEI, type, storage, colour, battery, condition
      notes, estimated value and agreed value
- [ ] Accepting it adds the old handset to **this branch's stock** immediately
- [ ] Its device page shows the type you chose, including GLOBAL/NEW CUT
- [ ] Its history starts with a **PURCHASED** event
- [ ] Its purchase price is the **agreed value**
- [ ] It is marked as sold here, never the other billing system
- [ ] On the bill: **Bill total** stays the full price, and the trade-in shows
      as a deduction against what is still to pay
- [ ] Save the bill → the difference is what the customer owed
- [ ] The invoice still shows the full price and full GST — a trade-in is not
      a discount, and the trade-in appears under the total as settlement,
      beside the cash, with the old handset's IMEI
- [ ] **Take one in for the full price of the phone and pay nothing.** The bill
      saves, reads **PAID**, and shows no outstanding balance and no due date.
      *A bill settled with the handset must not leave a receivable to chase*
- [ ] Do the same for a **named customer**: their statement shows the sale, the
      trade-in against it, and a balance of zero
- [ ] The sale list and the customer dues screen both read that bill as PAID —
      settlement is answered in one place, so they cannot disagree
- [ ] Trading in with **no customer** on the bill is allowed when the handset
      covers the whole total; it is refused only when something is left owing

## 6b. Refunding no more than was taken

- [ ] Sell on **credit** to a customer, pay nothing, then return the goods and
      choose to refund to **Cash** → the refund is **₹0** and their balance
      goes to zero. *They never paid, so nothing goes back out*
- [ ] Sell ₹1,000, pay ₹400, return everything, refund to Cash → **₹400** goes
      back and the remaining ₹600 comes off their account
- [ ] Same unpaid credit sale, but refund to the **customer's account** → the
      full value is credited. *A credit note is not money leaving the till*
- [ ] Return the rest of a part-returned bill → the two refunds together never
      exceed what was paid

## 6c. The GST switch (FR-2.6, FR-26.6)

**Settings → Business → GST.** Turn *Registered for GST* off and save.

- [ ] The **GST number** and **GST state** fields disappear from business
      settings, and so does the **Tax** tab and **Prices include tax**
- [ ] A new product form has no **HSN code** and no **Tax rate**
- [ ] A new customer, supplier and branch form has no **GST number**
- [ ] A device form has no **Tax rate**
- [ ] At the till, the total shows **Bill total** only — no Taxable, no Tax
- [ ] Sell a phone at ₹10,000 and take ₹10,000 → the bill total is exactly
      ₹10,000. *The customer pays the price on the label*
- [ ] Its invoice is headed **Invoice**, not Tax Invoice, and shows no GSTIN,
      no HSN column, no tax column and no HSN summary
- [ ] Download the PDF — same on paper as on screen

**Now turn GST back on and save.**

- [ ] Reopen that bill. It **still** reads Invoice, with no GSTIN and no tax.
      *This is the important one: nothing stores the PDF, so every reprint is
      re-rendered. A bill issued before the shop registered must never reprint
      as a tax invoice*
- [ ] Sell another phone → this one **is** a Tax Invoice, with GSTIN, HSN and
      the tax breakdown
- [ ] Turn GST off again and reopen that taxed bill → it still shows its GST.
      *It works in both directions*
- [ ] Turn GST back on before carrying on with the rest of the checklist

## 7. Correcting a device

- [ ] A device page shows **Edit** for admin and manager
- [ ] Signed in as **staff** there is no Edit button
- [ ] Change the **main type** and save
- [ ] The device history shows a **RECLASSIFIED** entry with what changed —
      corrections are recorded, not silent
- [ ] Change **Billed in** from the other system to ECITY → that handset now
      appears at the till. *This is the fix for NEW stock that was invisible*
- [ ] NEW CUT on anything that is not GLOBAL is refused
- [ ] A **sold** device cannot be edited — an issued invoice describes it
- [ ] The IMEI is shown but not editable

## What M6 deliberately does **not** include

- **No voiding a return.** Take a new sale if goods go back out
- **No repair workflow** — REPAIR is a status, not a job card
- **No automatic valuation** of trade-ins; the shop decides the number
- **No returns against the other billing system's sales** — those bills do not
  exist here at all — NEW stock belongs to the other business (docs/02 §2.3)

## Housekeeping

The end-to-end tests create real branches and customers in your development
database. After a test run you will see extra rows. To get back to a clean
state:

```bash
dropdb ecity && createdb ecity
psql -d ecity -c "CREATE ROLE ecity WITH LOGIN PASSWORD 'ecity' SUPERUSER;"
npm run db:migrate && npm run db:seed
```

---

## Sign-off

| | |
|---|---|
| Tested by | |
| Date | |
| Build / commit | |
| Result | pass / fail |
| Issues raised | |

# M7 — Expenses, Cash Drawer, Accounts & Daily Closing

Sign in as **admin** unless a step says otherwise. Work a whole day through in
one sitting — the point of this module is that the day balances at the end.

## 1. The drawer sees every rupee (FR-11.2)

Open **Cash drawer** and note *Expected in the till*. After each step below,
come back and check it moved the right way and by the right amount.

- [ ] Bill something for **cash** → expected goes **up**
- [ ] Bill something by **UPI** → expected does **not** move. *UPI never
      touches the till*
- [ ] Collect a customer's outstanding balance in **cash** → **up**
- [ ] Record a **cash expense** → **down**
- [ ] Pay a supplier in **cash** → **down**
- [ ] Refund a return in **cash** → **down**
- [ ] Every one of those appears as its own line under the total, with a time
- [ ] Switch branch → the other branch's till is a separate figure. *One
      branch's takings must never appear in another's*

## 2. Expenses (FR-10.1 – FR-10.3)

- [ ] **Record an expense** takes branch, category, amount, date, how it was
      paid, description and reference
- [ ] Choosing a non-cash method offers an **account**; choosing cash does not
- [ ] It appears in the list, newest first, with who recorded it
- [ ] Click the category → the expense opens on its own page
- [ ] **Attach a receipt** — a photo or PDF — and it shows on the expense
- [ ] A voided expense offers no upload
- [ ] **Total spent** is over everything in the filter, not just this page
- [ ] **Void** one → it asks why, and refuses an empty reason
- [ ] After voiding, the money is back in the drawer and the expense is gone
      from the live list. *It is voided, not deleted — tick "include voided"
      and it is still there with its reason*

## 3. Accounts (FR-12.1 – FR-12.4)

- [ ] **Add account** for a bank and one for UPI, with an opening balance
- [ ] An account can belong to one branch or to **all branches**
- [ ] **Transfer** between them → both balances move, by the same amount
- [ ] Click an account name → its **ledger**: every movement, newest first,
      with a running balance you can prove the total from
- [ ] The two legs of the transfer appear, one in each account
- [ ] **Reconcile** one, entering a statement balance ₹500 *below* the books
- [ ] The balance does **not** change to match. The ₹500 shows as
      **unreconciled**. *A real difference wants an explanation, not an
      automatic adjustment*

## 4. Closing the day (FR-13.1 – FR-13.4)

- [ ] **Daily closing** shows sales, credit given, collected, returns and
      refunds, what each payment method took, and the expenses by category
- [ ] It shows **invoices and items**. Sell three of one thing on one bill →
      one invoice, three items
- [ ] Type a counted amount **₹200 below** expected → it says **₹200 short**
      as you type, before you commit to anything
- [ ] Close the day → the shortage is recorded with the branch, your name and
      the time
- [ ] The drawer for that day now reads **CLOSED**

## 5. A closed day is never rewritten (OQ-5) — *the important one*

- [ ] Signed in as **staff**, try to record an expense dated into the closed
      day → refused
- [ ] As **admin**, record one → allowed, and the movement is tagged
      **After close**
- [ ] Go back to the closing screen. It says **this day was corrected after it
      was closed**, and shows both figures: what was signed, and what the
      movements now come to
- [ ] The signed **expected, counted and difference are unchanged**. *This is
      the whole decision. If a closing could be edited, coming up short today
      and adjusting yesterday would make the difference disappear*

## 6. Reopening a day

- [ ] On a closed day, **Reopen this day** → asks why, and refuses an empty
      reason
- [ ] It reopens, and the day can be closed again
- [ ] Close a **later** day for the same branch, then try to reopen the earlier
      one → **refused**, and it tells you to post a correction instead
- [ ] **Closing history** shows the reopened day marked **Reopened**. *The
      voided closing is kept — that a day was closed and reopened is part of
      the record*

## 7. Two branches (FR-13.5)

- [ ] Close each branch's day separately
- [ ] **All branches** shows both side by side and the consolidated totals add
      up
- [ ] A branch that has not closed still appears, marked **Open**, with what it
      should have

## 8. Tomorrow starts from what was counted

- [ ] Close a day counting ₹100 **less** than expected
- [ ] Open the next day's drawer → its **opening** is what you counted, not
      what was expected. *The drawer starts with the cash actually in it, so a
      shortage does not repeat itself every morning*

## 9. Correcting a purchase (carried in from M5)

- [ ] A purchase page shows **Correct details** for admin and manager
- [ ] It offers the **supplier bill number, date and notes** — and nothing else
- [ ] There is **no** way to change a line, quantity or cost. *Stock has moved
      and the supplier ledger has been posted; reversal is the honest tool*
- [ ] Save a corrected bill number → it shows on the purchase
- [ ] Signed in as **staff**, there is no Correct details button

## What M7 does not do

- **No cash counting by denomination**; one counted total per day
- **The other business's sales are not in the expected figure**, by design
  (docs/02 §2.3). ECITY's closing covers what ECITY billed. **If both take cash
  into the same physical drawer, every day will read as an overage** — settle
  that operationally before go-live, with a separate drawer or a single cash
  movement recording the other takings

# M8 — Branch Transfers & Stock Adjustments

You need two branches with stock. Sign in as **admin** unless a step says
otherwise.

## 1. Requesting (FR-3.6)

- [ ] **Transfers → Request a transfer**
- [ ] Picking a *From* branch shows only what **that branch actually holds** —
      handsets in stock and accessories with a count
- [ ] Changing the *From* branch clears what you had added. *Those items were
      on the other branch's shelf*
- [ ] A handset adds as one line with its IMEI; an accessory lets you type a
      quantity, capped at what is on hand
- [ ] Save → it appears as **REQUESTED**
- [ ] Nothing has moved yet: the handset is still sellable at the sending
      branch

## 2. Approving and sending

- [ ] The transfer list has **Waiting for approval** and **To receive** — the
      approval queue and the receiving screen, one click away
- [ ] The transfer offers **Approve**, then **Dispatch** — not both at once
- [ ] Signed in as **staff**, a requested transfer offers no Approve button.
      *Sending stock out of a branch is a manager's decision*
- [ ] As a manager assigned to the **receiving** branch only, the transfer
      offers no Approve or Dispatch — it says the other branch sends it
- [ ] Once in transit, that same manager **can** receive it, and a manager at
      the **sending** branch cannot. *Signing for a delivery is the receiving
      branch's job — whoever packed the box cannot attest it arrived*
- [ ] After **Dispatch** it reads **IN TRANSIT**

## 3. In transit belongs to nobody — *the important one*

- [ ] At the **sending** branch, search the IMEI at the till → **not offered**
- [ ] Switch to the **receiving** branch and search it → **not offered**
- [ ] The accessory count at the sending branch has **gone down** by what was
      sent
- [ ] The receiving branch's count has **not gone up** yet. *It is in a van.
      If it were sellable at both ends it would be sold twice*

## 4. Receiving (FR-3.7)

- [ ] The receiving screen offers a **scan box**, focused and ready
- [ ] Nothing is ticked to begin with. *A box you scan into is safer than one
      you untick — a handset the scanner misses shows as short instead of
      passing quietly*
- [ ] Scan (or type and press Enter) each IMEI → its line ticks
- [ ] A handset that will not scan can still be ticked by hand
- [ ] **Receive in full** → the transfer reads **RECEIVED**
- [ ] The exact IMEI is now at the receiving branch and sellable there
- [ ] Its device history shows **TRANSFERRED OUT** and **TRANSFERRED IN**, each
      naming **both branches** and the date. *Not one branch with the other
      hidden in the detail — M9's timeline reads these directly*
- [ ] Its **main type and NEW CUT are unchanged**. *A journey is not a
      reclassification*
- [ ] The accessory count at the receiving branch has gone up

## 5. Something did not arrive

- [ ] Send another handset and, on receipt, **untick** it
- [ ] A warning appears explaining it will be marked lost, and asks what
      happened
- [ ] After receiving, the transfer is flagged **Short on receipt** with your
      note
- [ ] The handset reads **LOST**, not still in transit. *It left one branch and
      reached no other — it has to be accounted for, not stranded*
- [ ] Try a partly received accessory line: send 5, receive 3 → only **3**
      arrive and the transfer is flagged short

## 5b. Something arrived that should not have

- [ ] On a receiving screen, scan an IMEI that is **not on the transfer**
- [ ] It is listed as unexpected, with a warning, and can be removed if you
      mis-scanned
- [ ] Receive → the transfer is flagged, and the stray IMEI is named in the
      discrepancy note
- [ ] That handset has **not** been moved to this branch. *Recording it is
      right; moving it would be inventing a transfer nobody authorised*

## 6. Cancelling

- [ ] Cancel a **requested** transfer → nothing moves anywhere
- [ ] Cancel one **in transit** → it asks why, and refuses an empty reason
- [ ] The handset is back at the **sending** branch and sellable again
- [ ] Its history shows the return **without** claiming it came from the other
      branch. *It never got there*
- [ ] Accessory stock is back at the sending branch too
- [ ] A **received** transfer offers no Cancel. *A completed movement is
      corrected by transferring back, not by rewinding it*

## 7. Adjustments (FR-28.1 – FR-28.3)

- [ ] **Adjustments → Adjust stock** asks first whether it is an accessory
      count or one handset
- [ ] For an accessory: pick it, type what you **actually counted**, and the
      change is shown as you type
- [ ] Entering the number the system already has is refused. *There is nothing
      to correct*
- [ ] Save with reason **Miscount** → the count changes and the entry shows
      `10 → 7` with who and when
- [ ] For a handset: **Miscount is not offered** — only Damage and Loss, and it
      explains that a wrong record is a device correction instead
- [ ] Adjust a handset as **Damage** → it leaves sellable stock and the till no
      longer offers it
- [ ] The adjustment lists the handset's **main type and NEW CUT as they were
      at the time**
- [ ] Click an adjustment → it opens on its own page
- [ ] **Attach evidence** — a photo of the damage or the count sheet
- [ ] The page says an adjustment is never edited, and that a wrong one is
      corrected by a second
- [ ] Signed in as **staff**, there is no Adjust stock button

## 8. Navigation

- [ ] **Transfers** and **Adjustments** appear under Inventory
- [ ] The transfer list filters by stage — **Requested** is the approval queue,
      **In transit** is the receiving one

## What M8 does not do

- **No printed transfer note** to travel with the goods
- **No partial dispatch**; a transfer goes in one movement or not at all
- **No printed barcode labels**; a scanner types the IMEI into the scan box
  like a keyboard, which is how these scanners work anyway
- **No transfer between businesses**, only between branches of one

# M9 — Global Search & IMEI Device History

The flagship. Sign in as **admin** unless a step says otherwise.

## 1. The search box (FR-30.1)

- [ ] A **Find anything** box sits in the header on every screen. *Deliberately
      not called "Search": every list has its own Search button that filters
      that list, and this does something different*
- [ ] **⌘K** (or Ctrl+K) opens it from anywhere; **/** opens it too, unless you
      are already typing in a field
- [ ] **Escape** closes it
- [ ] On a phone it collapses to a magnifying-glass button
- [ ] Typing one character says to type more; nonsense says *Nothing matched*

## 2. Finding a handset (FR-30.5) — *the important one*

- [ ] Type a **full IMEI** → it opens that device page immediately, without a
      list. *A complete IMEI is unambiguous; making someone click a list of one
      is wasted work at a counter*
- [ ] Type the **first 10–12 digits** → a list of candidates, and you stay put
- [ ] Click one → its device page
- [ ] Register a **dual-SIM** handset (raise *IMEI fields per device* in
      Settings → Business first)
- [ ] Search its **second** IMEI → the same device page as the first.
      *A customer reads out whichever number is printed nearest*

## 3. The identity header

- [ ] The device page shows **main type** and **NEW CUT** where it applies
- [ ] **Every** identifier is listed, with the primary one marked
- [ ] A multi-IMEI handset says how many identifiers it has

## 4. The whole life (FR-30.6)

Take one handset through: purchase → transfer out → transfer in → sell on
credit → return → inspect → correct something.

- [ ] The timeline shows **all seven** stages, oldest first
- [ ] Each entry is a **sentence**: *Sold on INV/… to Anil*, not just *SOLD*
- [ ] A transfer entry names **both branches**
- [ ] A reclassification says **what changed**, not just that something did
- [ ] Every entry with a document has a **working link** — click each one and
      land on that invoice, purchase, return or transfer
- [ ] **What it sold for** shows the price from the bill, the discount on that
      line, the customer, the cost and margin if you may see cost, the
      **payment status**, and **paid versus still owing**
- [ ] The Details card shows the **previous branch** for a handset that has
      moved, and a dash for one that never has
- [ ] A device sold, returned and sold again says so

## 5. Everything else searchable (FR-30.2 – FR-30.4)

- [ ] **Customer name**, **phone**, **email** all find the customer
- [ ] **Supplier name** finds the supplier
- [ ] **Product name**, **SKU** and **barcode** find the product
- [ ] An **invoice number** finds the bill
- [ ] Results are **grouped** by kind, with devices showing their type

## 6. Permissions (FR-30.7)

- [ ] Signed in as the **branch manager** (MAIN only), search a customer who
      has only ever bought at **North** → **no results**
- [ ] A customer who has bought at **both** branches → found by both
- [ ] Search an IMEI sitting at **North** as that manager → no results
- [ ] Signed in as **staff**, searching still works for what they may see, and
      returns nothing they may not

## 7. Speed (PRD §9.1)

- [ ] Search results appear in well under a second
- [ ] A device with a long history opens in **under 1.5 s**

## What M9 does not do

- **No saved or recent searches**
- **No fuzzy spelling correction** — a mistyped name finds nothing
- **No search across voided documents** unless you open them directly
- **The timeline shows events, not field-level diffs** beyond naming what a
  reclassification changed; the audit log has the full before-and-after

# M10 — Dashboards & Analytics

Sign in as **admin** unless a step says otherwise. Do a day's trading first —
a few bills, a return, an expense — so the numbers have something to say.

## 1. The dashboard (FR-15)

- [ ] **Today** shows sales, **purchases**, estimated profit, cash in the till,
      accounts, customer dues, supplier dues, stock value and returns
- [ ] Sales says how many bills and how many items
- [ ] Every figure is **clickable** and lands somewhere sensible
- [ ] The header's branch switcher changes the figures; "All branches" adds
      them up
- [ ] Signed in as **staff**, there is no estimated profit. *Profit needs cost
      prices, which staff do not see*

## 2. Alerts (FR-15.3)

- [ ] Set a product's minimum above its stock → a **low stock** alert appears
- [ ] Leave a bill past its due date → an **overdue** alert
- [ ] Leave yesterday unclosed → an **unclosed day** alert
- [ ] Close a day with a shortage → a **cash mismatch** alert
- [ ] Each alert links to the screen that answers it
- [ ] With nothing wrong, it says **All clear**

## 3. Getting around the analytics

- [ ] **Analytics** in the sidebar opens the overview
- [ ] Eleven tabs: Overview, Insights, Sales, Products, Brands, Customers,
      Credit, Inventory, Profit, Payments, Suppliers
- [ ] Every page has From, To, a branch picker and a comparison button
- [ ] The presets — Today, 7 days, 30 days, 90 days, This year — set the range
- [ ] Every area shows a **chart and a table**
- [ ] **Compare to previous** appears everywhere except Inventory and Credit,
      whose headline figures are a position rather than a period
- [ ] Changing area **keeps** the range and branch
- [ ] The range is in the URL, so a view can be copied to someone else

## 4. The figures are right (criterion 1)

Pick a day you can add up by hand.

- [ ] **Sales**: revenue, bills, units and average bill match your arithmetic
- [ ] Revenue on the dashboard for today equals the Sales page for today
- [ ] **Profit**: revenue − cost of goods = gross; gross − expenses = estimated
      net
- [ ] **Payments**: what was taken at the counter plus what went on credit
      equals revenue
- [ ] **Brands** and **Products** add up to the same revenue as Sales

## 5. The branch selector (criterion 2)

- [ ] One branch, then the other → two different sets of figures
- [ ] Every branch → the two add up to the total
- [ ] Signed in as the **branch manager**, the other branch is not in the
      picker, and its figures never appear

## 6. Main type and NEW CUT (criterion 3)

- [ ] **Products → By main type** lists each type separately
- [ ] GLOBAL appears **twice**: once plain, once as **GLOBAL · NEW CUT**
- [ ] Their margins differ — which is the point of splitting them
- [ ] **Inventory** shows stock by type the same way
- [ ] **Profit** offers a main-type filter; **NEW CUT only** appears *after*
      choosing GLOBAL and disappears when you pick another type. *NEW CUT is
      a designation inside GLOBAL, never a sixth type*

## 6b. Insights (FR-35)

- [ ] **Insights** shows revenue, average bill, margin and collection rate,
      each against the period before — with a direction, not just a figure
- [ ] **Which days earn** groups by weekday. *"Dead on Tuesdays" is
      actionable; "the 14th was slow" is not*
- [ ] Top products, brands and branches are listed
- [ ] The five main types are compared, GLOBAL split by NEW CUT
- [ ] Slow-moving stock is listed, each linking to its device
- [ ] Signed in as **staff**, margin is absent but everything else is there

## 6c. The rest of the measures

- [ ] **Inventory** shows **turnover**, **low stock** and **out of stock**
- [ ] Set a product's minimum above its stock → it appears under *Needs
      reordering*; drop the stock to zero → it moves to out of stock
- [ ] **Credit** shows **collected in this period** and a **collection rate**,
      and lists customers **late more than once**
- [ ] A rate above 100% is not a bug — money arrives for older bills
- [ ] **Suppliers** shows *What we buy, and from whom*
- [ ] The **Overview** shows cash, accounts, customer dues and stock value
      beside the trade figures

## 7. Inventory movement (FR-21)

- [ ] The movement table reads Opening → Purchases → Sales → Returns →
      Transfers → Adjustments → Current
- [ ] **Opening + in − out = Current.** *A movement report that does not
      reconcile is worse than none*
- [ ] **Handsets are counted, not just accessories.** Register a phone and sell
      it inside the period → purchases and sales each go up by one. *The stock
      ledger covers accessories; a phone shop's movement has to read the device
      history too*
- [ ] **Dead stock** lists handsets that were in stock before the period and
      are still here, oldest first

## 8. Reaching a handset (criterion 5)

- [ ] From the dashboard, click **Stock value** → Inventory
- [ ] Click **Handsets** → the device list
- [ ] Click a device → its full history
- [ ] That is **three clicks** from the dashboard to one IMEI
- [ ] The other route also works: Overview → a branch → a bill → the IMEI on
      that bill opens the handset's history. *On a printed invoice the IMEI is
      plain text — paper has nowhere to click*

## 9. Speed (criterion 4)

- [ ] Set the range to a whole year with every branch selected
- [ ] Every page answers in a couple of seconds at most

## What M10 does not do

- **No nightly rollups.** Every figure is live from the documents. Fast enough
  at this size; revisit if the data grows
- **No exports yet** — that is M11
- **No automated recommendations** (PRD FR-35.4 puts them in a later version)
- **Charts are simple bars**, with no axes, tooltips or zoom
- **Estimated net profit is gross less recorded expenses.** Salaries and rent
  count only if somebody booked them as expenses

# M11 — Reports, Exports, Imports & Opening Balances

Sign in as **admin** unless a step says otherwise.

## 1. The report centre (FR-25.1 – FR-25.3)

- [ ] **Reports** in the sidebar opens the centre
- [ ] Ten reports: Sales, Purchases, Inventory, Financial, Credit, Tax,
      Reconciliation, Branch comparison, Customers, Suppliers
- [ ] Each has From, To and a branch picker, and the filters are in the URL —
      copy the address to someone and they see the same figures
- [ ] The preview shows the first 100 rows and says how many there are
- [ ] Sales revenue for a period matches the Analytics page for the same period
- [ ] **Inventory** groups by main type, with **GLOBAL · NEW CUT** as its own
      value — never a sixth type
- [ ] **Credit** carries the 0–7, 8–30, 31–60 and over-60 buckets
- [ ] **Customers** and **Suppliers** list everyone with what they traded in
      the period and what is owed *now* — a list to call, and a list to pay
- [ ] Signed in as **staff**, the Financial report says it needs permission to
      see cost prices
- [ ] Changing the period says **Rebuilding…** while it works. *A report that
      looks frozen gets asked for three times*
- [ ] **Save this view**, name it, and it appears as a chip
- [ ] Go to another report, click the chip, and the first one comes back with
      its dates and branch
- [ ] Saving again under the same name **replaces** it rather than being
      refused
- [ ] Remove the view with its ×, and it goes

## 2. Exports (FR-33.3)

For at least Sales and Inventory:

- [ ] **CSV** downloads and opens in Excel with the accents intact
- [ ] **Excel** downloads as a real `.xlsx`, and the money column **adds up**
      when you select it. *A spreadsheet that cannot sum its own money column
      is not much use*
- [ ] **PDF** downloads, is landscape, and repeats the column headings on every
      page
- [ ] A very large PDF is refused with a message pointing at CSV, rather than
      silently cutting rows off

## 3. The catalogue (carried in from M5)

- [ ] **Settings → Catalogue** lists brands and categories with how many
      products each holds
- [ ] **Add a brand** → it appears, and shows in the product form's picker
- [ ] **Rename** it → the change shows everywhere
- [ ] **Deactivate** it → it stays listed, marked inactive. *Invoices already
      issued refer to it, so nothing is deleted*
- [ ] A duplicate name is refused
- [ ] **Add a category**, choosing whether it is tracked individually and by
      IMEI or serial
- [ ] On a category that **already has products**, changing how it is tracked
      is refused with a reason. *That would reinterpret stock that already
      exists*
- [ ] The page explains why **main types** are not managed here

## 4. The import wizard (FR-33.1)

Make a CSV with a heading row and a few customers, including one row with an
empty name.

- [ ] **Import data** → choose Customers → pick the file
- [ ] It says how many rows it read, and **nothing has been created yet**
- [ ] The column mapping is **guessed** — "Full Name" finds *name*, "Mobile"
      finds *phone*
- [ ] The guess can be **changed**; a required field left unmapped is refused
      with a message naming it
- [ ] **Check the file** → it says how many are ready and how many have
      problems
- [ ] The bad row is named by its **line number as the spreadsheet shows it**
- [ ] **Download the full list of problems** gives a CSV of just those rows,
      with the row as uploaded beside the reason
- [ ] **Import** → only the good rows go in; the bad ones are left out and
      nothing is half-created
- [ ] The customers really exist afterwards
- [ ] Uploading the **same file again** is refused. *It would double
      everything in it*
- [ ] Signed in as **staff**, the import page redirects away

Then save the same list as **.xlsx** and do it again:

- [ ] The `.xlsx` uploads directly — no converting to CSV first
- [ ] An IMEI column typed as a number comes through as its digits, not as
      `3.81E+14`. *An IMEI that arrives in scientific notation matches nothing*
- [ ] A date cell arrives as a day, not as a timestamp
- [ ] An old **.xls** is refused with a message saying to save it as .xlsx

## 5. Handsets, with more than one IMEI (FR-33.2)

- [ ] Import a devices file with `IMEI No` and `IMEI 2` columns
- [ ] Both IMEIs land on the **same handset**, not two
- [ ] This works even while *IMEI fields per device* is set to 1 in Settings.
      *The file decides how many the handset has, not the form*
- [ ] A row with a main type that is not one of the five is rejected by name
- [ ] A row naming a product the shop does not have is rejected, and says so

## 6. Opening balances (FR-34.1 – FR-34.3)

**Settings → Opening balances**, three tabs.

- [ ] Declare **opening stock** for an accessory → the stock figure and the
      inventory report both show it
- [ ] Declare **opening cash** for a branch → the cash drawer shows it as the
      opening movement
- [ ] Declaring it twice for the same branch is refused
- [ ] Declare a customer's **existing due** → they appear on the dues screen,
      in the aging buckets, in the credit report and in the dashboard's
      "customers owe". *A balance nobody can see is worse than not importing
      it*
- [ ] Declare a supplier's **existing due** → it shows in supplier dues
- [ ] Every opening entry is dated as at the day you declared, not the day you
      typed it
- [ ] **Import a file instead** on the stock and dues tabs opens the wizard
      already set to the right kind
- [ ] A dues file naming somebody the shop does not have rejects **that row**
      and imports the rest. *A due against a name nobody recognises is worse
      than a missing row*
- [ ] A stock file uploaded without choosing a branch is refused straight
      away, not one row at a time

## What M11 does not do

- **Only `.xlsx`, not the old binary `.xls`** — Excel saves one as the other in
  a click, and the message says so
- **Only the first sheet of a workbook** — several sheets is a question about
  which one, and guessing imports the wrong list
- **No saved report filters yet**; the URL carries them, which covers sharing
  but not naming
- **No scheduled or emailed reports**
- **No undo on an import.** A wrong batch is corrected the way anything else
  is — by voiding or adjusting what it created
- **OQ-9 is closed**: the go-live loading order, the checks after each step,
  and what is deliberately not migrated are in **docs/04 §10**

# M13 — Notifications, Alerts & Warranty

**Delivers.** PRD FR-27.1 – FR-27.3, FR-29.1, FR-29.2.

Sign in as **admin** unless a step says otherwise. Alerts are evaluated hourly
by the worker; **Check now** on the alerts page does it immediately, which is
what these steps use.

## 1. The bell and the centre (FR-27.3)

- [ ] A bell sits in the header, next to the search
- [ ] With nothing outstanding it shows no number
- [ ] **Alerts** appears in the sidebar under Dashboard
- [ ] The page opens with two tabs: the alerts, and what you are told about

## 2. Each of the seven triggers (FR-27.1)

Make each condition, then press **Check now**.

- [ ] **Low stock** — set a product's minimum above what is on the shelf. The
      alert names the product, the branch and the minimum
- [ ] A product at **zero** is marked more urgently than one merely low
- [ ] **Customer overdue** — a credit bill past its due date. The alert names
      the customer, the amount and how many days
- [ ] **Supplier due** — money owed for longer than the threshold. *No branch
      on this one: owing a supplier is the business's problem*
- [ ] **Cash mismatch** — close a day with the counted cash deliberately
      wrong. The alert is marked critical
- [ ] **Day not closed** — a branch that took money on a past day with no
      closing. *Today never appears: it is still open by definition*
- [ ] **Stock adjusted** — make an adjustment; the alert carries the reason
      and the note
- [ ] **Warranty expiring** — a handset in stock whose cover ends within 30
      days

## 3. It does not shout (FR-27.1)

- [ ] Press **Check now** twice more — no duplicates appear
- [ ] Fix one condition (restock the product), then **Check now** — the alert
      disappears
- [ ] Break it again and **Check now** — it comes back. *An alert that could
      only ever fire once would be worse than none*

## 4. Who sees what (FR-27.2)

- [ ] As **admin**, alerts are grouped by branch
- [ ] As a **branch manager**, only their branch appears — and no heading,
      because there is only one
- [ ] As **staff**, low stock and adjustments appear; supplier dues, customer
      dues and cash mismatches do not. *An alert nobody may act on is noise
      and a leak*
- [ ] On the settings tab, staff see only the kinds they can act on
- [ ] Staff cannot turn a rule off for the shop — only mute it for themselves

## 5. Reading is personal

- [ ] Mark one alert read — the bell's count drops
- [ ] **Mark all read** — the count goes
- [ ] Sign in as another user: **their** count is unchanged. *One manager
      clearing the bell must not hide a till shortage from the owner*
- [ ] **Everything, including dealt with** shows what was read and resolved

## 6. What you are told about

- [ ] **Mute** a kind — the button changes and the shop's setting is untouched
- [ ] As admin, turn a kind **off for the shop** — its existing alerts
      disappear
- [ ] Change a threshold (say overdue from 7 days to 30) and **Check now** —
      fewer alerts

## 7. Warranty (FR-29)

- [ ] A purchase line asks for **Warranty (months)** and **Warranty by**
- [ ] Book in a handset with 12 months from a named provider
- [ ] Its device page shows the expiry, the length, the provider and whether
      it is **still in warranty** — without you doing the arithmetic
- [ ] **Inventory → Warranty** lists handsets by how soon cover ends
- [ ] An unsold handset shows **In stock** as its owner
- [ ] Sell it, refresh, and the same row now names the **customer**, linking
      to them. *"Still covered" is only useful beside "whose is it?"*
- [ ] A handset imported from a file with `Warranty` and `Warranty By`
      columns carries both
- [ ] The window (7 / 30 / 60 / 90 days / a year) is in the URL and can be
      shared
- [ ] One already expired is marked as such
- [ ] A branch user sees only their branch's handsets

## What M13 does not do

- **No email or WhatsApp** (PRD OQ-6). In-app only in v1, as FR-27.3 asks. A
  channel that leaves the building is a decision about cost, a provider and
  consent — every alert is already a row a channel could read
- **No per-alert snooze**; mute is per kind, for you
- **No job queue.** The worker is an interval loop: both jobs are idempotent
  and safe to miss and repeat. The first job that must not be lost is when
  that changes

# M14 — Backup, Data Protection, Hardening & Go-Live

**Delivers.** PRD FR-31.2, FR-31.3, FR-32.1 – FR-32.3, and §9 non-functional
requirements.

Most of this module is checked by scripts and tests rather than by clicking.
What is left for a person is the part no test can do: proving the restore
works on the real server, and watching the shop use it.

## 1. Backups (FR-32.1)

On the **server**, not a developer's machine:

- [ ] `./scripts/backup.sh` completes and prints a size and a table count
- [ ] The dump lands in R2 (`restic snapshots` lists it)
- [ ] Break it on purpose — stop the database and run it again. It **fails
      loudly**, non-zero. *A backup script that exits 0 after a failed dump is
      worse than none*
- [ ] The cron line is in place and has run unattended at least once
- [ ] A failed run reaches you (email or Sentry), not just a log file

## 2. The restore drill (FR-32.1)

- [ ] `./scripts/restore-drill.sh` passes
- [ ] It reports plausible counts — sales, devices, ledger, cash
- [ ] It reports **append-only guards enforce: true**
- [ ] **Write down how long it took.** That is how long the shop is shut for
- [ ] Do it once more from an R2 snapshot, not a local file. *The local copy
      is not the backup that survives the server*
- [ ] Agree the acceptable data-loss window with the shop: four-hourly dumps
      lose up to four hours. WAL archiving takes it to about five minutes

## 3. The owner's export (FR-32.3)

- [ ] **Settings → Your data** shows the row count and what it contains
- [ ] **Download everything** produces a CSV with a section per table
- [ ] It opens in Excel with accents intact
- [ ] Customers, devices, sales and payments are all in it, as data
- [ ] It contains **no password hashes** and no reset tokens
- [ ] It says plainly that it is your data, not a system backup
- [ ] The export appears in **Recent exports** afterwards
- [ ] Signed in as a manager (not the owner), the page redirects away

## 4. Nothing is destroyed (FR-31.2, FR-31.3)

- [ ] Void a sale — it stays, marked voided, with its reason
- [ ] Reverse a purchase — the handsets become voided, and their **history is
      still there**
- [ ] Look up one of those IMEIs — the device page still tells its whole story
- [ ] Book the same IMEI in again on a corrected purchase. *Only the claim on
      the number was released, not the history*
- [ ] Void an expense and a customer payment — both stay, marked
- [ ] There is no button anywhere that deletes money or stock

## 5. Hardening

- [ ] Get the password wrong twenty times quickly — it starts refusing with a
      wait, before the account lock
- [ ] **Sign in correctly as many times as you like** — a successful sign-in
      is never counted. *All the shop's staff share one connection; counting
      good logins would lock the shop out of its own till after a power cut*
- [ ] Try from a different device — **that** person can still sign in. *One
      shop being attacked must not lock out another*
- [ ] Wait out the window and sign in normally
- [ ] Request a password reset repeatedly — it is limited the same way
- [ ] A file link (`/api/files/...`) opened while signed out is refused
- [ ] The same link, copied and used an hour later, is refused
- [ ] `npm audit` shows no high or critical advisories

## 6. Speed on real data (§9.1)

Against a full-size database (`scripts/perf-seed.sql`, or the shop's own after
go-live):

- [ ] Global search on a full IMEI — under half a second
- [ ] A partial IMEI — under half a second
- [ ] A device history page — under a second and a half
- [ ] The dashboard — under two seconds
- [ ] Twelve months of analytics — under five seconds
- [ ] Do these at the shop's busiest hour, not at midnight

## 7. Go-live

- [ ] **Uploads are sorted** — either the S3 driver is implemented, or
      `.storage/` is a named volume *and* is in the backup. See docs/04 §3b.1.
      *On the default settings, attachments are destroyed by the next deploy*
- [ ] Attach a photo, deploy, and check it is **still there**
- [ ] Everything in the Go-Live Checklist (docs/04 §11)
- [ ] Existing data loaded in the order in docs/04 §10, each step checked
- [ ] Staff trained: billing, returns, dues, the daily closing
- [ ] **Two weeks running in parallel with paper**, one branch
- [ ] At the end of it, cash, stock and dues agree with the paper — or every
      difference is explained. *This is the real acceptance test*

## What M14 does not do

- **No WAL archiving yet.** Four-hourly dumps mean losing at most four hours.
  Point-in-time recovery (about five minutes) is roughly half a day of
  `pgBackRest` setup on the server — recommended for money data, and the
  decision is the shop's
- **Rate limiting is per process.** One app container, so this is the whole
  mechanism; scaling to a second container means moving it to Redis
- **No automated penetration testing.** The endpoint sweep proves every route
  declares who may call it; it is not a substitute for someone trying
