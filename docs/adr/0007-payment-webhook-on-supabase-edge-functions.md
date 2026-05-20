# ADR-0007 — Payment webhook on Supabase Edge Functions

- **Status:** Accepted
- **Date:** 2026-05-19
- **Slice:** PRD-0005 (PayOS payment automation)

## Context

PRD-0005 introduces PayOS as the payment gateway, replacing the manual QR
flow from PRD-0002. Two server-side surfaces are required that the current
stack does not yet host:

1. **HTTP webhook endpoint** — PayOS calls our server when a payment is
   confirmed. The handler must verify an HMAC-SHA256 signature against
   `PAYOS_CHECKSUM_KEY`, then transition the order to `active` and create
   an enrollment atomically. This cannot run in the Vite SPA (no server
   runtime, secrets would leak to the client).
2. **Scheduled job** — A 30-minute cron expires `pending` orders older
   than 24 hours.

The current stack is Vite SPA + Supabase Postgres/Auth/Storage. There is
no `supabase/functions/` directory; the only existing serverless surface
is whatever Vercel hosts for the frontend bundle.

## Decision

Host both surfaces inside Supabase:

- **Webhook** → Supabase Edge Function (`supabase/functions/payos-webhook`),
  Deno runtime, invoked by PayOS at
  `https://<project-ref>.supabase.co/functions/v1/payos-webhook`.
- **Cron** → `pg_cron` extension, calling a SQL function
  `expire_stale_orders()` every 30 minutes directly inside Postgres.

Secrets (`PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`) live in
Edge Function env via `supabase secrets set`. Sandbox vs production
separation is achieved with two Supabase projects, matching the existing
`.env` pattern for Vercel preview/production.

The companion `payos-create-payment` Edge Function performs the outbound
PayOS API call when the Learner clicks "Mua khoá học". Frontend never
holds any PayOS credential.

## Alternatives considered

**B. Vercel Serverless Functions + Vercel Cron.** Node ecosystem is
familiar, code lives next to the frontend, deploys with one push. Two
real costs:

- Vercel Hobby cron runs at most **once per day** — 30-minute cadence
  requires the Pro plan (~$20/month). Phase 2 does not otherwise need
  Vercel Pro.
- The function would need Supabase service-role key to write through RLS,
  duplicating secret surface across vendors. PayOS is being chosen
  expressly to "avoid dual integration later" (PRD-0005 §3); a split
  webhook/cron infrastructure undercuts that rationale.

**C. Hybrid (Vercel webhook + `pg_cron`).** Splits the surface across
two vendors with no compensating benefit; rejected.

## Consequences

**Positive**
- Same vendor handles auth, DB, RLS, secrets, and now payment hooks —
  consistent with the "avoid dual integration" rationale that drove the
  PayOS gateway choice.
- `pg_cron` runs SQL directly inside the database. No HTTP hop, no
  Edge Function invocation cost for the cron path; the function is
  transactional with the orders table.
- Webhook handler sits sub-100ms from `orders` for the `confirm_order_via_payos`
  RPC. Latency budget against the 5–30s PayOS confirm target is
  comfortable.
- Phase 2 cost remains $0 on Supabase free tier (500k Edge Function
  invocations / month covers expected webhook volume by 3 orders of
  magnitude).

**Negative**
- Deno runtime in Edge Functions is less familiar than Node, and shared
  TypeScript code with the frontend needs a deliberate strategy (Deno's
  npm specifiers, or duplicate small helpers). Mitigated by keeping
  Edge Functions narrow — verify HMAC, call RPC, done.
- Local dev requires `supabase functions serve` + an exposed tunnel
  (ngrok) for PayOS sandbox webhooks. Not exotic, but a new dev-env
  step.
- Cron-as-SQL is opaque to non-DBA readers. Mitigated by keeping the
  function body short and migration-versioned.

**Neutral**
- Locks in Supabase as the backend vendor for the entire payment path,
  including any future PRD that needs server-side logic (refund
  automation, batched payout webhooks). This is the intended direction
  per PRD-0005 §3.
