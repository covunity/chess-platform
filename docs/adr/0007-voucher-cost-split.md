# ADR-0007 — Pro-rata Cost Split for Voucher & Campaign Discounts

- **Status:** Accepted
- **Date:** 2026-05-20
- **PRD:** `docs/prd/0006-voucher-and-campaign.md`
- **Related:** ADR-0002 (account tiers + fee snapshot), PRD-0005 (PayOS automation)

## Context

PRD-0006 introduces voucher codes (manual, learner-entered) and campaigns (auto-applied, platform-wide) that reduce the price a learner pays for a course. The platform already snapshots `platform_fee_pct`, `platform_fee_amount`, and `creator_payout_amount` onto `orders` at creation time (ADR-0002, E-07) using `floor(price * pct / 100)` integer arithmetic (E-08).

Discounts disrupt this snapshot. When a learner pays less than the course's listed price, **someone has to absorb the gap** between the listed price and the amount received. Three parties could absorb it:

1. **Platform** — keeps creator payout based on the original (pre-discount) price; platform fee shrinks (or goes negative).
2. **Creator** — platform takes its full fee on the original price; creator payout shrinks (or goes negative).
3. **Both, pro-rata** — discount is split between platform and creator in the same ratio as their original shares.

Vouchers and campaigns can stack (campaign first, then voucher), and either can be percentage- or fixed-amount-based with an optional cap. The final price may even floor at 0 (free path D-05). Whichever model we pick must remain stable across all these combinations.

## Decision

Adopt **pro-rata cost splitting** as the only model in Phase 2. No `cost_bearer` enum is added — the schema stores only the snapshot amounts derived from the formula below.

### Formula (snapshot at `create_order_with_fee_snapshot`)

```
campaign_discount = applyDiscount(original_price,            campaign)
intermediate      = original_price - campaign_discount
voucher_discount  = applyDiscount(intermediate,              voucher)
final_price       = max(intermediate - voucher_discount, 0)

creator_payout_amount = floor(final_price * (100 - platform_fee_pct) / 100)
platform_fee_amount   = final_price - creator_payout_amount
```

Where `applyDiscount(price, d)`:

- `percentage`: `min(floor(price * d.value / 100), COALESCE(d.max_discount_amount, ∞))`
- `fixed_amount`: `min(d.value, price)`

All values are integer VND. Floor rounding everywhere; no decimals.

### Implications

- The platform fee percentage (from the creator's tier) is applied to the **final price**, not the original price. The platform's nominal cut is computed *after* discount, which means the platform "shares" the discount cost in the same ratio as its fee share.
- Creator and platform amounts are computed deterministically and snapshotted onto the order. Editing voucher/campaign after the order is created does not change historical payouts.
- Final price may be 0 — the existing free-course path (D-05) auto-activates enrollment in the same transaction.

### Worked example

Course price = 1,000,000 ₫. Creator tier = `individual` (platform_fee_pct = 20).

Campaign = `-20%` (active, applicable to this course). Voucher = `-100,000 ₫` (fixed).

```
campaign_discount     = min(floor(1,000,000 * 20 / 100), ∞)  = 200,000
intermediate          = 1,000,000 - 200,000                   = 800,000
voucher_discount      = min(100,000, 800,000)                 = 100,000
final_price           = max(800,000 - 100,000, 0)             = 700,000

creator_payout_amount = floor(700,000 * 80 / 100)             = 560,000
platform_fee_amount   = 700,000 - 560,000                     = 140,000
```

Compare to no-discount baseline: creator 800,000, platform 200,000. Pro-rata split: creator loses 240,000, platform loses 60,000 — matching their 80:20 share of the discount pool.

## Consequences

### Positive

- **Neither party ever goes negative.** The discount is always smaller than the pool it's drawn from, and each party's share is proportional to their pre-discount stake.
- **Single source of truth.** The same formula handles voucher-only, campaign-only, voucher+campaign, percentage, fixed_amount, capped, and free-path (final = 0) cases. No branching by discount source.
- **No new schema state for cost allocation.** The `orders` table stores only the resulting amounts; the formula is in one RPC.
- **Snapshot semantics align with ADR-0002 E-07.** Past orders are stable; tier changes and discount edits do not retroactively alter payouts.
- **Phase 3 escape hatch.** If we later want creator-funded vouchers or platform-funded marketing campaigns, we add a `cost_bearer` enum to `vouchers`/`campaigns` and branch the formula. The current model is the safe default.

### Negative / risks

- **Creator earns less per sold copy when a voucher applies, even though they did not author the voucher.** Admin-created vouchers reduce creator income proportionally. Creators must be informed at onboarding that admin-platform discounts apply to their courses unless `applicable_courses` whitelist excludes them.
- **Platform fee on heavily-discounted orders can become very small.** A 90 % discount on a 1,000,000 ₫ course leaves only 20,000 ₫ for the platform. Operationally acceptable for Phase 2 (BizDev controls quota), but Phase 3 may need a per-voucher `cost_bearer` override for promo budgets.
- **Floor rounding can drift by 1 ₫ across many transactions.** Acceptable since VND has no sub-unit; cumulative drift is in the noise floor of admin payouts.

## Alternatives considered

### Alt A — Platform absorbs all discount cost

Creator payout always uses `original_price`; platform fee = `final_price - creator_payout`. Rejected: with vouchers > tier fee %, platform fee goes negative (i.e. platform loses money on the sale). Operationally dangerous and gives no protection against admin misconfiguration.

### Alt B — Creator absorbs all discount cost

Platform fee uses `original_price`; creator payout = `final_price - platform_fee`. Rejected: with large discounts, creator payout goes negative (i.e. creator owes money to ship the course). Creators will refuse to opt-in to platform campaigns.

### Alt C — Cost bearer enum (`platform | creator | shared_proportional`)

Add a column to each of `vouchers` and `campaigns` choosing who absorbs the cost; default `shared_proportional`. Rejected for Phase 2 because:

1. It forces UI to expose a "who pays?" radio that admins won't understand without docs.
2. Requires per-discount validation to prevent the platform/creator from going negative when `platform` or `creator` is picked.
3. The `shared_proportional` default would be selected ≈100 % of the time at MVP — the column would be inert.

Phase 3 can revisit if BizDev wants explicit "platform-funded marketing campaign" semantics.

### Alt D — Apply discount only on platform fee (not creator)

Discount comes out of the platform's cut first, only spilling into creator's share if it exceeds the fee. Equivalent to Alt A in the worst case (platform negative) and complicates the breakdown UI ("first 200k from platform, next 80k from creator"). Rejected.

## Implementation references

- PRD: `docs/prd/0006-voucher-and-campaign.md`
- Migration: `supabase/migrations/068_voucher_rpcs.sql` (preview_purchase + create_order_with_fee_snapshot updated + cancel_order updated + expire_stale_orders updated)
- ADR-0002 (E-07, E-08, E-09) for the snapshot pattern and floor-rounding rules
