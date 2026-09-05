#!/usr/bin/env bash
# Regenerate every docs/*.pdf from its Markdown source.
# Requires: pip3 install --user reportlab
set -euo pipefail
cd "$(dirname "$0")/.."

render() { python3 scripts/md2pdf.py "docs/$1.md" "docs/$1.pdf" "$2" \
  "ECITY — Mobile Shop Management Web App" "$3"; }

COMPANION='Companion documents: PRD, Module Breakdown, Engineering Design, Deployment Guide, Database Guide'

render 01-PRD                    "Product Requirements Document" \
  "Version 1.3  ·  2026||Source: mobile_shop_management_feature_list_v3.pdf||$COMPANION"
render 02-Module-Breakdown       "Module Breakdown & Build Plan" \
  "Version 1.6  ·  2026||15 modules, sequenced for one developer||$COMPANION"
render 03-Engineering-Design     "Engineering Design & Tech Stack" \
  "Version 1.5  ·  2026||TypeScript stack, architecture, self-hosted on one server||$COMPANION"
render 04-Deployment-Guide       "Deployment Guide" \
  "Version 1.2  ·  2026||Buying the server, deploying, backups and the runbook||$COMPANION"
render 05-Database-Guide         "Database Guide" \
  "Version 1.0  ·  2026||Setting up PostgreSQL, and the tasks you will repeat||$COMPANION"
render 06-Manual-Test-Checklist  "Manual Test Checklist" \
  "Version 1.1  ·  2026||What a person still has to judge, module by module||$COMPANION"
