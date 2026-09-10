# Cash, Closing and Opening Balances

## 1. Who This Is For

You run the shop, or you are about to hand these three screens to someone who
does. This explains **what they are for and why they behave the way they do** —
not how they are coded. No accounting background is assumed.

The three screens are:

| Screen | Path | When you use it |
|---|---|---|
| Opening balances | `/settings/opening-balances` | Once, on the day you start |
| Cash drawer | `/cash` | Whenever you want to see the till |
| Daily closing | `/closing` | Once per branch, at the end of each day |

They are really one story about cash, told at three different moments.

---

## 2. How They Fit Together

```
Day 0                Every day, all day           End of each day
──────────────       ──────────────────────       ──────────────────
Opening balances  →  Cash drawer               →  Daily closing
"what we already     fills up by itself as        count the notes,
 had"                the shop trades              compare, freeze
                              ▲                          │
                              └──────────────────────────┘
                     today's counted cash becomes
                     tomorrow's opening drawer balance
```

Opening balances happen once. The drawer runs continuously. Closing happens
every evening, and hands the baton back to the next day's drawer.

---

## 3. Opening Balances — "What We Already Had"

### 3.1 The problem it solves

The day you switch to ECITY, the shop is not empty. There is cash in the till,
stock on the shelf, customers who owe you money and suppliers you owe.

None of that has a document behind it. There is no invoice for "the ₹40,000
that was already in the drawer" and no purchase order for "the 30 cables
already on the shelf". So it cannot arrive through the ordinary screens — but
it still has to reach the same ledgers, or **every figure built on top of them
starts out wrong**.

### 3.2 What you enter

Three tabs, and you can do them in any order:

| Tab | What you declare |
|---|---|
| **Cash** | What is in each branch's till, and the balance of each bank / UPI / card account |
| **Stock** | How many of each accessory you are holding, per branch |
| **Dues** | What each customer owes you, and what you owe each supplier |

Everything is declared **as at one date** — the day you are starting from.

### 3.3 Why it is not just a starting number

Each figure is posted through the **same machinery a real sale or purchase
uses**, tagged as an opening entry. A customer's opening due is a genuine line
on their statement; opening stock is a genuine stock movement; opening cash is
a genuine drawer movement.

The practical result: six months later, when someone asks *"why does this
customer owe ₹4,000?"*, the answer is a dated, traceable ledger line — not an
unexplained number that appeared from nowhere.

> **This is a one-time exercise**, and the app protects most of it. Cash,
> account balances, customer dues and supplier dues each refuse a second
> opening figure — you will be told *"this branch already has an opening cash
> figure"* rather than having it added twice. The cash and dues tabs are also
> all-or-nothing: if one line is rejected, none of them are applied, so a retry
> after a mistake is always safe.
>
> **Opening stock is the exception, and it is the one to be careful with.**
> It has no such guard. Submitting the stock tab twice **adds the quantities a
> second time** — 30 cables become 60. If you are unsure whether it went
> through, check the products list before resubmitting rather than pressing the
> button again.

Once declared, a wrong figure is corrected the ordinary way — a payment, a
credit note, or a stock adjustment — never by re-running this screen.

### 3.4 Getting it right

Do the count on a day the shop is shut, or before it opens. The figures must
describe **one single moment**. If you count the till at 10am, sell three
phones, and then count the stock at 2pm, the two halves describe different
shops and nothing will reconcile.

---

## 4. Cash Drawer — "What Is In The Till Right Now"

One drawer per branch, per day. Open `/cash` to see it.

### 4.1 Nobody opens it

There is no "start the day" button, and that is deliberate. The first time cash
moves at a branch, that day's drawer creates itself.

The alternative — requiring someone to press a button each morning — means that
on the morning they forget, the first hour of trade lands nowhere and the day
cannot be reconciled at all. A counter that is selling has a drawer, whether or
not anyone remembered.

### 4.2 What lands in it

Everything cash-like, automatically, from every part of the app:

- cash taken on a sale
- cash collected against a customer's credit
- cash refunded on a return
- cash paid out for an expense
- cash paid to a supplier

**Card and UPI payments do not.** Those move the relevant *account* balance
instead. Each payment method carries a flag saying whether it touches the till,
and that flag is read in exactly one place — so cash and non-cash can never be
routed inconsistently by two different screens.

This matters: without it, a till would be credited with money that actually
went to a bank, and would never reconcile.

### 4.3 Expected cash is calculated, never stored

```
expected cash = opening balance + everything in − everything out
```

That sum is recomputed **every time you look at the screen**. It is never saved
as a running total.

This sounds like a technical detail. It is the single most important property
of the whole system. A stored running total can drift away from the movements
it claims to summarise — and once it has, you can never tell which of the two
is lying. Deriving it means the total and the evidence behind it cannot
disagree, and the screen lists every movement making up the figure.

### 4.4 "Today" means the shop's today

The business date is the calendar day **in India**, not on the server. Between
midnight and 05:30 those are different dates. A sale rung up at 1am belongs to
the day the shop is actually trading, and both the drawer and every form in the
app agree on which day that is.

---

## 5. Daily Closing — "Count It And See If It Matches"

At the end of the day, at `/closing`, someone counts the physical notes and
types the figure in.

### 5.1 What it tells you

```
difference = what you counted − what the system expected
```

A shortage or a surplus is shown plainly. It is not hidden, rounded away, or
quietly absorbed — the point of the exercise is to surface it while the day is
still fresh enough to explain.

The screen also summarises the day around that figure, so the cash number has
context:

- sales, and returns
- credit given out, and credit collected
- refunds paid
- supplier payments
- expenses

### 5.2 Closing freezes the day

Once closed, that day's drawer is sealed. The closing is a signature saying
*"this is what was there."*

Three consequences follow:

**Late entries are flagged, not blocked.** If something genuinely has to be
posted into a day that is already closed, it can be — but only by someone with
permission to correct a closed day, and the entry is marked as having landed
after the close. The gap between the signed figure and a freshly recomputed one
stays **visible**, rather than the original quietly changing underneath.

**A day can be reopened** — for the mistake everyone actually makes, which is
closing at six and then taking a sale at seven.

**But not once a later day has been closed.** At that point the app refuses and
tells you to post a correction into the day instead. This is what stops
"reopen an old day" from becoming a way to rewrite last month.

### 5.3 The handover to tomorrow

Tomorrow's drawer opens with **the cash you counted**, not the cash the system
expected.

This is the right way round, and worth understanding. If you were ₹200 short
today, tomorrow starts ₹200 short too. The drawer begins with what is genuinely
in it, and the discrepancy stays on the record as its own visible event —
rather than being silently absorbed overnight, which is exactly how a small
recurring loss goes unnoticed for a year.

---

## 6. The Idea Underneath All Three

**Derived, never stored.**

- Opening balances are real ledger entries, not starting figures
- Drawer totals are summed from their movements on every single read
- Closing compares a counted figure against a computed one, and keeps both

Nothing anywhere is a number that someone can quietly nudge. That is what makes
the figures worth trusting at the end of a month — and it is why the shortage
the system reports is a fact about the shop, not a fact about the software.

---

## 7. Common Questions

**We forgot to close yesterday. What now?**
Nothing is lost. Open `/closing`, change the date to yesterday, and close it.
The drawer for that day still holds every movement.

**The count is short. Do I have to fix it before closing?**
No — close with the true counted figure. The difference is recorded and stays
visible. Adjusting the count to make it balance destroys the only evidence that
anything went missing.

**A customer paid by UPI but the till is short by that amount.**
Check the payment method used on the bill. UPI should be set not to affect the
cash drawer; if it was recorded as cash, the till expects notes that were never
handed over.

**Can I delete a wrong movement?**
No. Money entries are append-only. A mistake is corrected by a second entry —
a void, a refund, an adjustment — so both the error and the correction stay on
the record.

**Do I redo opening balances when I add a branch?**
No. A new branch simply starts empty and fills up through ordinary trade. If it
opens with stock transferred from another branch, that is a stock transfer, not
an opening balance.
