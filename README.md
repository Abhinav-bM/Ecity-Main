# ECITY — Mobile Shop Management

Multi-branch mobile shop management: inventory by IMEI, billing, credit, cash
reconciliation and reporting.

**Current state: Module M0 (Foundations) complete.** Authentication, roles and
granular permissions, branch context and the audit log. Inventory, purchases,
sales and reporting arrive in M2 onward — see `docs/02-Module-Breakdown.md`.

## Documents

| File | What it covers |
|---|---|
| `docs/01-PRD.md` | Product requirements, FR-1 … FR-38, open questions |
| `docs/02-Module-Breakdown.md` | The 15-module build plan, M0 … M14 |
| `docs/03-Engineering-Design.md` | Stack, architecture, data decisions, hosting cost |
| `docs/04-Deployment-Guide.md` | Buying the server, deploying, backups, runbook |

## Stack

TypeScript · Next.js 15 (App Router) · React 19 · Tailwind v4 · shadcn/ui ·
PostgreSQL 16 · Drizzle ORM · Zod · TanStack Query/Table · Vitest · Playwright

Everything runs as one deployable application. There is no separate backend
service and no serverless platform — see `docs/03` §2.1 for why.

## Getting started

You need **Node 22+** and **Docker** (for Postgres).
Docker Desktop or OrbStack both work on macOS.

```bash
cp .env.example .env          # then set AUTH_SECRET: openssl rand -base64 32
docker compose up -d          # Postgres 16 on localhost:5432
npm install
npm run db:migrate            # create the schema
npm run db:seed               # business, branches, roles, three users
npm run dev                   # http://localhost:3000
```

Seeded sign-ins (all use `SEED_PASSWORD`, default `ChangeMe!2026`):

| Email | Role | Branches |
|---|---|---|
| `admin@ecity.local` | Admin / Owner | all (consolidated) |
| `manager@ecity.local` | Branch Manager | MAIN only |
| `staff@ecity.local` | Staff | MAIN only |

Sign in as the manager and then as the admin to see branch scoping and the
permission model actually doing something.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `start` | Production build and run |
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm run lint` | ESLint 9 flat config |
| `npm test` | Vitest — unit always, integration when a database is reachable |
| `npm run test:e2e` | Playwright — 100 tests across 4 viewports; needs the app running and seeded |
| `npm run test:e2e -- --project=mobile` | Just the phone viewport |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Idempotent seed |
| `npm run worker` | Background worker (session purge; pg-boss lands in M12) |

## Layout

```
src/
  app/
    (auth)/         login, forgot-password, reset-password
    (app)/          authenticated shell: dashboard, settings/*
    api/            route handlers
  components/       app shell, branch switcher, user menu, ui/ primitives
  server/
    auth/           password hashing, sessions, permissions
    db/             schema, client, migrations, seed, audit writer
    services/       ALL business rules live here
    http.ts         the route wrapper: authn, authz, validation, errors
  lib/              permissions catalogue, zod schemas, formatting
drizzle/            SQL migrations
tests/              unit · integration · e2e
```

## Theming

The colour scheme is entirely CSS custom properties in `src/app/globals.css`,
split in two:

1. **Neutral base** — surfaces, text, borders, states. Shared by every theme.
2. **Brand layer** — `--primary`, `--ring`, sidebar accents, chart palette.
   This is the only part a client re-skin touches.

**Default is `onyx` — black primary.** Also shipped: `navy`, `emerald`, `amber`.

Switch with one environment variable, no code change and no rebuild of any
component:

```bash
APP_THEME=navy          # onyx (default) | navy | emerald | amber
APP_COLOR_SCHEME=system # light | dark | system
```

The layout stamps it as `<html data-theme="…">`, so every shadcn component
picks it up automatically. A bad value falls back to `onyx` rather than
throwing — a typo in a client's env must not take the shop offline.

**Adding a client theme:**

1. Copy a `[data-theme='…']` block in `globals.css`, change the values
2. Add the matching `.dark[data-theme='…']` block
3. Register it in `src/lib/theme.ts` with a label and a `browserChrome` hex
4. Set `APP_THEME=<name>` in that client's `.env`

Colours are in **oklch**, which keeps perceived lightness consistent when you
change hue — a green at the same lightness as the black reads as equally
strong, which is not true in hex.

Two rules that keep this working: **never hardcode a colour** in a component
(no `#hex`, no `bg-blue-600` — always `bg-primary`, `text-muted-foreground`),
and keep `browserChrome` in step with `--primary`, since
`<meta name="theme-color">` cannot read a CSS variable. `tests/e2e/theme.spec.ts`
enforces both.

## Responsive design

The counter runs on a phone, the shop floor on a tablet, the back office on a
desktop. Every screen has to work at all three.

- shadcn/ui components are added with the CLI (`npx shadcn@latest add …`) and
  live in `src/components/ui/`. Extend them in place — that is what shadcn is
  for — rather than wrapping or forking them.
- Below `md` the sidebar is replaced by a Sheet drawer. There is no screen
  size with no navigation.
- Data tables become one card per row below `md`. A six-column table is not
  readable on a 320px phone, and horizontal scrolling is not a fix.
- The page body must never scroll sideways. Wide content scrolls inside its
  own container.
- Touch targets are at least 44px tall under `(pointer: coarse)`.

**Playwright runs every suite at four viewports** — 320px, Pixel 7, iPad and
1440px desktop (`playwright.config.ts`). `tests/e2e/responsive.spec.ts` asserts
no horizontal overflow, reachable navigation and adequate touch targets at each
one. A layout that only works on desktop fails the build.

## Rules that apply to every change

These are not style preferences. They are the decisions the rest of the system
depends on (`docs/02` §2.2, `docs/03` §4).

1. **Authorisation is server-side, always.** Every route handler calls
   `requirePermission(user, permission, branchId)` through the `route()`
   wrapper. A hidden menu item is not a control.
2. **Money is `bigint` paise.** Never float, never `parseFloat`. A lint rule
   enforces this.
3. **Stock, money and status changes commit in the same transaction** as the
   document that causes them.
4. **Nothing is hard-deleted.** Records move to Cancelled / Voided / Reversed.
5. **Business rules live in `src/server/services/`**, never in a route handler.
   Routes parse, authorise and delegate. This is what keeps the door open to
   splitting the backend out later without a rewrite.
6. **Every device-touching action appends a `device_event` row** (from M2).

## Notes on M0's implementation

**Sessions are hand-rolled, not Auth.js.** `docs/03` originally specified
Auth.js v5 with database sessions. Auth.js's Credentials provider only supports
JWT sessions — database sessions are not available with it, and the PRD needs
server-side revocable sessions (FR-1.1, NFR §9.4). `src/server/auth/session.ts`
implements them directly: a random 32-byte token in an httpOnly cookie, with
only its SHA-256 hash stored, sliding idle expiry and a hard absolute cap.
About 150 lines, and revocation actually works.

**The audit log is append-only in the database**, not just in code — a trigger
raises on any UPDATE or DELETE (`drizzle/0001_audit_append_only.sql`).

**Passwords use scrypt** from `node:crypto`. No native dependency, so the
Alpine image stays simple.

**Theme tokens follow shadcn's naming** (`--primary`, `--muted`, `--sidebar-*`)
in `src/app/globals.css`, so any component copied from the registry works
untouched. Light and dark are both defined. The brand navy from the docs is
`--primary`.

**Role, branch or status changes revoke that user's sessions** so the change
takes effect immediately rather than at their next sign-in.

## Deployment

One Hetzner CX22 running four containers (app, Postgres, worker, Caddy),
≈ ₹550–750/month. `Dockerfile`, `docker-compose.prod.yml` and `Caddyfile` are
here; the step-by-step is `docs/04-Deployment-Guide.md`.

## Before building M1

Two questions from `docs/01` §11 block later modules and are cheap to answer now:

- **OQ-1** — what do **ER** and **ACT** actually mean? Blocks M2.
- **OQ-11** — is the split strictly "NEW → the other billing system,
  everything else → ECITY"? Blocks M4.

And **OQ-10** — get one real Excel export from the existing billing system.
