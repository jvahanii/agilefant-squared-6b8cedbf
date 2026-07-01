#!/usr/bin/env bash
# sync-supabase.sh
#
# Run this script after every `git pull` that brought in new migration files.
# It reconciles your local Supabase CLI state with the remote database so that
# CLI commands stop complaining about out-of-sync migrations.
#
# Prerequisites:
#   - supabase CLI installed  (https://supabase.com/docs/guides/cli)
#   - Logged in: supabase login
#   - Project linked: supabase link --project-ref <project-ref>
#
# Usage:
#   bash scripts/sync-supabase.sh
#   bash scripts/sync-supabase.sh --repair   # also mark all local migrations as applied

set -euo pipefail

REPAIR=${1:-}

echo "==> Syncing local Supabase CLI state with remote database..."

# Fetch the current remote schema and record it in the local migration history.
# This makes the CLI aware of any migrations that were applied directly to the
# remote DB without going through your local machine.
supabase db remote commit

echo "==> Remote state committed to local history."

if [[ "$REPAIR" == "--repair" ]]; then
  echo "==> Marking all local migration files as applied..."

  shopt -s nullglob
  for migration in supabase/migrations/*.sql; do
    # Extract the timestamp prefix (first 14 chars: YYYYMMDDHHmmss)
    timestamp=$(basename "$migration" | cut -c1-14)
    if [[ "$timestamp" =~ ^[0-9]{14}$ ]]; then
      echo "    repair: $timestamp"
      supabase migration repair --status applied "$timestamp" || true
    fi
  done

  echo "==> All migrations marked as applied."
fi

echo ""
echo "Done. Your local CLI state is now in sync with the remote database."
echo "You can safely continue working and run 'git push' / 'supabase db push'."
