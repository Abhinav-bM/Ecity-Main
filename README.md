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
| `npm run test:e2e` | Playwright — needs the app running and seeded |
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
