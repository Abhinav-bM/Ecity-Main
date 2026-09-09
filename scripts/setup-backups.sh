#!/usr/bin/env bash
#
# Turn on off-site backups. Run once, on the server.
#
#   cd ~/app && ./scripts/setup-backups.sh
#
# Four things have to happen before backups exist: restic installed, the
# repository initialised, a schedule in cron, and — the one people skip — a
# real backup taken and checked. Skipping the last leaves a cron entry that
# has never succeeded, which looks exactly like one that has.
#
# Safe to run again. Everything below checks before it acts, so a second run
# repairs whatever is missing rather than duplicating it.
set -euo pipefail

cd "$(dirname "$0")/.."

# ── 1. Configuration ────────────────────────────────────────────────────────
[[ -f .env ]] || { echo "No .env here. Run this from the app directory." >&2; exit 1; }
set -a && . ./.env && set +a

for name in R2_ACCOUNT_ID RESTIC_PASSWORD; do
  [[ -n "${!name:-}" ]] || { echo "✗ $name is not set in .env" >&2; exit 1; }
done

ACCESS_KEY="${R2_ACCESS_KEY_ID:-${S3_ACCESS_KEY_ID:-}}"
SECRET_KEY="${R2_SECRET_ACCESS_KEY:-${S3_SECRET_ACCESS_KEY:-}}"
[[ -n "$ACCESS_KEY" && -n "$SECRET_KEY" ]] || {
  echo "✗ S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are not set in .env" >&2
  exit 1
}

export RESTIC_REPOSITORY="s3:https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com/${R2_BACKUP_BUCKET:-ecity-backups}"
export AWS_ACCESS_KEY_ID="$ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$SECRET_KEY"
export RESTIC_PASSWORD

echo "› repository: $RESTIC_REPOSITORY"

# ── 2. restic ───────────────────────────────────────────────────────────────
if command -v restic >/dev/null 2>&1; then
  echo "✓ restic already installed ($(restic version | head -1))"
else
  echo "› installing restic"
  sudo apt-get update -qq
  sudo apt-get install -y -qq restic
fi

# ── 3. The repository ───────────────────────────────────────────────────────
# `cat config` is the cheapest thing that proves the repository exists *and*
# that RESTIC_PASSWORD decrypts it — a wrong password fails here rather than
# at 3am in a cron log.
if restic cat config >/dev/null 2>&1; then
  echo "✓ repository already initialised, and the password opens it"
else
  echo "› initialising the repository"
  restic init
fi

# ── 4. The schedule ─────────────────────────────────────────────────────────
# cron runs with almost no environment, so the job loads .env itself.
CRON_LINE="30 */4 * * * cd $(pwd) && set -a && . ./.env && set +a && ./scripts/backup.sh >> /var/log/ecity-backup.log 2>&1"

if crontab -l 2>/dev/null | grep -qF 'scripts/backup.sh'; then
  echo "✓ schedule already in cron"
else
  echo "› scheduling every four hours"
  # Every four hours, not nightly: a disk failure at 8pm should cost a
  # quarter of a trading day, not all of it.
  (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
fi

sudo touch /var/log/ecity-backup.log 2>/dev/null || true
sudo chown "$(id -u):$(id -g)" /var/log/ecity-backup.log 2>/dev/null || true

# ── 5. Prove it ─────────────────────────────────────────────────────────────
echo
echo "› taking one backup now, to prove the whole path works"
./scripts/backup.sh

echo
restic snapshots --latest 3
cat <<DONE

✓ Backups are on.

  Every four hours, encrypted, to Cloudflare R2.
  Kept: 7 daily, 4 weekly, 6 monthly.
  Log:  /var/log/ecity-backup.log

  Two things left that no script can do for you:

  1. Store RESTIC_PASSWORD somewhere that is NOT this server. If the machine
     dies and that key died with it, everything above is unreadable.
  2. Run ./scripts/restore-drill.sh once a month. A backup nobody has
     restored is a file you hope is a backup.
DONE
