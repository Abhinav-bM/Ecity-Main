-- Grow a database to the PRD §9.1 sizing assumption.
--
--   up to 10 branches, 50 users, ~500 sales/day, ~250k device units and
--   ~2M device events over five years
--
-- Run against a scratch database, never against real data. Built with
-- generate_series inside Postgres rather than a loop in the application:
-- two million rows over a connection is minutes of round trips, and the
-- point of this is to have the data, not to demonstrate insert speed.
--
-- The shape matters as much as the size. Devices spread across branches and
-- five years of dates, events clustered on devices the way real history is
-- (a few per unit), and sales spread over the same period — a table of
-- identical rows would let the planner do things it cannot do in a shop.

\set ON_ERROR_STOP on

-- Start from nothing every time. A half-seeded run left behind by an error
-- would otherwise be measured as though it were full size, and the whole
-- point is knowing what the numbers mean.
delete from device_event where device_id in (select id from device_unit where business_id = 9000);
delete from device_identifier where device_id in (select id from device_unit where business_id = 9000);
delete from sale_payment where sale_id in (select id from sale where business_id = 9000);
delete from sale where business_id = 9000;
delete from device_unit where business_id = 9000;
delete from customer where business_id = 9000;
delete from product where business_id = 9000;
delete from category where business_id = 9000;
delete from payment_method where business_id = 9000;
delete from branch where business_id = 9000;

-- Anchor everything to one business so it can be dropped in one statement.
insert into business (id, name) values (9000, 'Perf Test Shop')
  on conflict (id) do nothing;

insert into branch (business_id, code, name)
select 9000, 'PERF' || g, 'Perf Branch ' || g
from generate_series(1, 10) g
on conflict do nothing;

insert into category (business_id, name, is_serialised, identifier_type)
values (9000, 'Perf Mobiles', true, 'IMEI')
on conflict do nothing;

insert into product (business_id, name, category_id, is_serialised)
select 9000, 'Perf Phone ' || g, (select id from category where business_id = 9000 limit 1), true
from generate_series(1, 200) g
on conflict do nothing;

insert into customer (business_id, name, phone)
select 9000, 'Perf Customer ' || g, '9' || lpad(g::text, 9, '0')
from generate_series(1, 20000) g
on conflict do nothing;

-- 250k handsets across ten branches and five years.
insert into device_unit (
  business_id, product_id, primary_identifier, main_type, status,
  current_branch_id, purchase_price_paise, selling_price_paise, created_at
)
select
  9000,
  (select id from product where business_id = 9000 order by id limit 1 offset (g % 200)),
  (860000000000000 + g)::text,
  (array['NEW','USED','ER','ACT','GLOBAL'])[1 + (g % 5)]::main_type,
  case when g % 3 = 0 then 'SOLD' else 'IN_STOCK' end::device_status,
  (select id from branch where business_id = 9000 order by id limit 1 offset (g % 10)),
  (10000 + (g % 50000)) * 100,
  (15000 + (g % 60000)) * 100,
  now() - ((g % 1825) || ' days')::interval
from generate_series(1, 250000) g;

insert into device_identifier (device_id, value, type, slot, is_primary)
select id, primary_identifier, 'IMEI', 1, true from device_unit where business_id = 9000;

-- ~2M events: eight per handset for a quarter of them, fewer for the rest,
-- which is roughly how a real fleet looks.
insert into device_event (device_id, seq, event_type, occurred_at, payload)
select
  d.id, s.seq,
  (array['PURCHASED','RECEIVED','SOLD','RETURNED','TRANSFERRED_OUT','TRANSFERRED_IN','ADJUSTED','INSPECTED'])[s.seq]::device_event_type,
  d.created_at + (s.seq || ' hours')::interval,
  '{}'::jsonb
from device_unit d
cross join lateral generate_series(1, case when d.id % 4 = 0 then 8 else 3 end) as s(seq)
where d.business_id = 9000;

-- Five years of trading: ~500 a day.
insert into sale (
  business_id, branch_id, customer_id, invoice_number, sold_at,
  subtotal_paise, total_paise, status
)
select
  9000,
  (select id from branch where business_id = 9000 order by id limit 1 offset (g % 10)),
  (select id from customer where business_id = 9000 order by id limit 1 offset (g % 20000)),
  'PERF-' || g,
  now() - ((g % 1825) || ' days')::interval,
  (5000 + (g % 40000)) * 100,
  (5000 + (g % 40000)) * 100,
  'COMPLETED'
from generate_series(1, 900000) g;

-- Most bills are settled at the counter. Without this every one of the
-- 900k sales is a debt, which is not a shop — it is a shop that has never
-- collected a rupee, and it would send the dues queries down a path no real
-- data takes. About one in twenty is left open, which is what a credit book
-- actually looks like.
insert into payment_method (business_id, code, name, type, affects_cash_drawer)
values (9000, 'CASH', 'Cash', 'CASH', true)
on conflict do nothing;

insert into sale_payment (sale_id, payment_method_id, amount_paise)
select s.id, (select id from payment_method where business_id = 9000 limit 1), s.total_paise
from sale s
where s.business_id = 9000 and s.id % 20 <> 0;

analyze;
