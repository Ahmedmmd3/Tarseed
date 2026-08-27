# Threat Model

## Project Overview

ترصيد is a public, autoscale-deployed Arabic cashier/accounting application. The production system includes a TypeScript/Express API in `artifacts/api-server`, a PostgreSQL database accessed through Drizzle in `lib/db`, and the browser client in `artifacts/wudooh`. It supports team accounts, tenant-scoped ERP data, inventory/accounting, backups, e-invoicing, Stripe billing, and a separate platform super-admin surface. The client also maintains local browser state for offline-first workflows.

## Assets

- **Team accounts, sessions, and password-reset tokens** -- compromise exposes a tenant's business records and permits unauthorized changes.
- **Platform-admin accounts and sessions** -- compromise enables cross-tenant administration, subscription changes, billing-portal access, and audit-log access.
- **Tenant business data** -- products, stock, invoices, accounting records, customers, expenses, HR/team data, and backups contain sensitive commercial and personal information.
- **Billing and subscription state** -- Stripe customer/subscription identifiers and server-side subscription actions affect paid access and money-related workflows.
- **E-invoicing credentials and documents** -- tax authority credentials, certificates, signed invoices, and compliance data require strict tenant and role isolation.
- **Application secrets and integrations** -- database credentials, session-signing material, Stripe credentials, email credentials, and object-storage access must remain server-side.

## Trust Boundaries

- **Browser to API** -- all client requests, cookies, request bodies, and identifiers are attacker-controlled until authenticated and authorized server-side.
- **Unauthenticated to authenticated** -- registration, login, reset, and invite flows cross this boundary and must resist spoofing, enumeration, replay, and CSRF.
- **Team member to tenant/admin** -- ordinary users must not access another tenant or perform owner/admin actions; platform admins are a separate higher-privilege boundary.
- **API to PostgreSQL/object storage** -- authorization must be applied before reads and writes; raw IDs, tenant IDs, filenames, and backup contents cannot be trusted.
- **API to Stripe, email, and tax authority services** -- outbound requests use privileged credentials and must be bound to validated server-side state, fixed destinations, and verified callbacks.
- **Server to browser-rendered HTML and local browser storage** -- user data must not become executable markup, and local storage/IndexedDB must not be treated as an authorization boundary.

## Scan Anchors

- **Production API entry point**: `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`; routes under `artifacts/api-server/src/routes/`.
- **Highest-risk server code**: `team-auth.ts`, `middleware/team-auth.ts`, `middleware/platform-auth.ts`, `routes/erp-data.ts`, `routes/backup.ts`, `routes/billing.ts`, `routes/e-invoicing.ts`, `routes/platform-admin.ts`, and `lib/private-object-store.ts`.
- **Client boundary**: `artifacts/wudooh/src/context/store.tsx`, hooks under `artifacts/wudooh/src/hooks/`, and pages invoking `/api`.
- **Public/authenticated/admin surfaces**: auth/health and Stripe webhook are public; ERP, accounting, inventory, backup, e-invoicing, and billing are team-authenticated; platform-admin routes require platform-admin authentication. Authorization must be confirmed per object/action, not inferred from the UI.
- **Dev-only**: `artifacts/mockup-sandbox`, test files, build artifacts, source maps, and generated declarations are not production behavior unless deployment configuration proves otherwise.

## Threat Categories

### Spoofing

Login, password reset, team sessions, platform-admin sessions, and cookies are the primary identity controls. Passwords must be strongly hashed; session tokens must be unpredictable, scoped, expiring, revocable, and never accepted from client-controlled alternatives. Reset and invite tokens must be single-use and bound to their intended account. Public auth and webhook routes need abuse controls and callback/signature verification.

### Tampering

Every write must derive user, organization, ownership, role, price, subscription, and inventory scope from server-side state. Generic data writes, restore operations, team-management fields, billing actions, e-invoicing submission, and webhook processing require strict schemas and authorization. SQL must remain parameterized and concurrent financial/inventory updates must preserve invariants.

### Repudiation

Sensitive account, role, billing, restore, e-invoicing, and platform-admin operations should record the authenticated actor and event context in protected audit records without leaking secrets into logs. Security alerts and webhook processing must not be forgeable by unauthenticated callers.

### Information Disclosure

Reads, lists, exports, backups, signed object URLs, invoices, tax credentials, and admin overviews must be scoped to the authenticated tenant and role. Responses and logs must exclude password hashes, reset/session tokens, certificates, private keys, database details, and third-party secrets. Error responses must not disclose internals.

### Denial of Service

Public auth, webhook, backup/restore, report, and external-integration paths need bounded bodies, computational work, outbound timeouts, and abuse controls. In-memory controls must not be assumed to protect a horizontally scaled deployment or permit unbounded attacker-controlled state.

### Elevation of Privilege

Team and platform-admin boundaries must be enforced in middleware and route/service queries. Client-side route guards, hidden controls, local storage, request-supplied organization IDs, and role fields are not security controls. Object lookup and mutation must prove the caller's membership/role for the exact object and action before disclosure or state change. Outbound integration and file paths must not permit SSRF or traversal.
