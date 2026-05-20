-- Issue #275 — Idempotent payos-create-payment Edge Function
--
-- Adds a JSONB cache column that records the full PayOS create-payment
-- response on first-create. The Edge Function then replays this payload on
-- subsequent calls for the same order (typically a Learner browser refresh
-- on /checkout/:orderId after the QR has loaded), avoiding both a second
-- PayOS API round-trip and the previous "409 payment_already_created" UX bug.
--
-- Shape stored (best-effort; reads should null-check each field):
--   {
--     qrCode:        string  -- EMV QR text payload, rendered client-side
--     accountNumber: string  -- virtual account assigned by PayOS
--     accountName:   string  -- merchant display name
--     bin:           string  -- bank BIN (e.g. "970422" for MB Bank)
--     amount:        number  -- VND, integer
--     description:   string  -- mirror of orders.code
--     checkoutUrl:   string  -- PayOS-hosted fallback page
--     paymentLinkId: string  -- same as orders.payos_payment_link_id
--   }
--
-- Legacy orders created before this migration was deployed have
-- payos_payment_link_id set but payos_payment_payload NULL. The Edge
-- Function rejects those with `payment_legacy_no_cache` (HTTP 409); they
-- self-resolve via the 24h expiry cron from migration 054.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payos_payment_payload jsonb;

COMMENT ON COLUMN public.orders.payos_payment_payload IS
  'Cached PayOS /v2/payment-requests response (qrCode, account info, '
  'checkoutUrl, paymentLinkId). Populated on first-create by the '
  'payos-create-payment Edge Function so refresh calls are idempotent '
  '(issue #275). NULL for legacy rows from before slice-1b deployment.';
