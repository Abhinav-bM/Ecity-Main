#!/usr/bin/env bash
#
# Empty a STAGING database so testing can start from nothing.
#
# Two modes, because "clear everything" means two different things depending
# on whether you mind re-entering your password:
#
#   --fresh  (default)  Drop the database and rebuild it from migrations and
#                       the seed. Truly nothing left. The admin password goes
#                       back to SEED_PASSWORD.
#
#   --keep-logins       Empty every table that holds trading data, but leave
#                       users, roles, permissions, the business and its
#                       branches alone. Your admin password still works.
#
# It refuses to run unless you name the database out loud, because the only
# difference between this and a catastrophe is which server you are on.
set -euo pipefail

MODE="${1:---fresh}"

# ---------------------------------------------------------------------------
# Where is this running?
#
# On a developer's machine there is a psql and a Node toolchain, and
# DATABASE_URL points at a local database. On the server there is neither:
# the guide puts only docker-compose.yml, the Caddyfile and .env on the box
# (§4), so every database command has to go through the containers — the same
# way the deploy runs its migrations.
#
# Getting this wrong is not subtle. The first version of this script called
# `psql` and `npm run db:seed` directly and would simply have said
# "command not found" on the server.
# ---------------------------------------------------------------------------
if command -v docker >/dev/null 2>&1 && docker compose ps db >/dev/null 2>&1; then
  MODE_HOST="docker"
  DB_NAME="${POSTGRES_DB:-ecity}"
  DB_USER="${POSTGRES_USER:-ecity}"
  WHERE="the db container on this server"
  psql_run()  { docker compose exec -T db psql -U "$DB_USER" -d "${1:-$DB_NAME}" "${@:2}"; }
  psql_file() { docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1; }
  node_run()  { docker compose run --rm migrate "$@"; }
else
  MODE_HOST="direct"
  : "${DATABASE_URL:?no docker compose here, so set DATABASE_URL}"
  DB_NAME=$(printf '%s' "$DATABASE_URL" | sed -E 's|.*/([^/?]+).*|\1|')
  WHERE=$(printf '%s' "$DATABASE_URL" | sed -E 's|.*@([^/:]+).*|\1|')
  psql_run()  { psql "${DATABASE_URL%/*}/${1:-$DB_NAME}" "${@:2}"; }
  psql_file() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1; }
  node_run()  { "$@"; }
fi

cat <<BANNER

  This empties the database: $DB_NAME
  Reached through:           $WHERE
  Mode:                      $MODE

  Every sale, purchase, payment, device and ledger entry will be gone.
  There is no undo. If this is production, stop now.

BANNER

# Typing the name is the guard. A y/n prompt is muscle memory; a name is not.
read -r -p "Type the database name to continue: " TYPED
[[ "$TYPED" == "$DB_NAME" ]] || { echo "Did not match. Nothing was changed."; exit 1; }

case "$MODE" in
  --fresh)
    echo "› dropping and recreating $DB_NAME"
    # Connect to the maintenance database, not the one being dropped: you
    # cannot drop a database you are connected to.
    #
    # WITH (FORCE) disconnects anything still attached — the app holds a pool
    # open, and without this the drop fails with "database is being accessed
    # by other users". Stopping the app first is still the tidier way.
    psql_run postgres -c "drop database if exists \"$DB_NAME\" with (force);"
    psql_run postgres -c "create database \"$DB_NAME\";"

    echo "› applying migrations"
    node_run npm run db:migrate

    # The minimum to sign in: permissions, roles, the business, one admin.
    # No branches, tax rates, payment methods or catalogue — those are the
    # shop's own, and a seeded guess is something the owner has to undo.
    echo "› seeding: permissions, roles, business, admin login"
    node_run npm run db:seed
    ;;

  --keep-logins)
    echo "› emptying trading data, keeping logins and settings"
    # TRUNCATE, not DELETE. The ledgers, device_event and audit_log carry
    # append-only triggers that refuse a DELETE by design (docs/03 §4.2) —
    # DELETE would fail on exactly the tables that most need clearing.
    # TRUNCATE does not fire row triggers, and CASCADE follows the foreign
    # keys so the order does not have to be worked out by hand.
    psql_file <<'SQL'
truncate table
  sale_payment, sale_item, sale,
  refund, return_item, sales_return, trade_in,
  customer_payment_allocation, customer_payment, customer_ledger_entry,
  purchase_item, purchase,
  supplier_payment_allocation, supplier_payment, supplier_ledger_entry,
  transfer_item, stock_transfer, stock_adjustment,
  device_identifier, device_event, device_unit,
  branch_stock, stock_ledger,
  cash_movement, cash_drawer_day, daily_closing,
  account_transaction, account,
  expense,
  customer, supplier, product,
  notification_read, notification, notification_rule,
  import_row, import_job, export_job, saved_report,
  attachment, document_sequence, audit_log
restart identity cascade;
SQL
    # RESTART IDENTITY resets the id counters, so the first invoice of the
    # test run is INV-00001 rather than continuing from wherever you were.
    echo "› syncing the permission catalogue"
    node_run npm run db:sync-roles
    ;;

  *)
    echo "Unknown mode: $MODE (use --fresh or --keep-logins)" >&2
    exit 1
    ;;
esac

echo
echo "✓ $DB_NAME is empty and ready."
[[ "$MODE" == "--fresh" ]] && echo "  Sign in as admin@ecity.local with SEED_PASSWORD."
