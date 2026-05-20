/**
 * E2E: voucher + campaign full flow (PRD-0006 slice 6, issue #310).
 *
 * Covers the happy path (admin seeds → learner buys → PayOS webhook →
 * enrollment → admin observability) plus 8 edge cases (quota, expiry,
 * per-user limit, course-eligibility, cancel-returns-quota, expire-returns-
 * quota, free path, campaign overlap rejection).
 *
 * All Supabase calls go through page.route() per ADR-0003. We do not seed
 * a live DB; helpers/voucherCampaign.ts mocks the relevant RPCs from an
 * in-memory state object that mutates across the test (so cancelling an
 * order in the UI flips the mocked order to 'cancelled', etc.).
 */
import { test, expect } from '@playwright/test'
import {
  mockLearner,
  mockAdmin,
  COURSE_ID,
} from './helpers/mockApi'
import {
  setAuth,
  mountVoucherCampaignMocks,
  makeDefaultCampaign,
  makeDefaultVoucher,
  makeDefaultCourse,
  simulatePayosWebhook,
  type VoucherCampaignState,
} from './helpers/voucherCampaign'

function freshLearnerState(overrides: Partial<VoucherCampaignState> = {}): VoucherCampaignState {
  return {
    course: makeDefaultCourse(),
    campaign: makeDefaultCampaign(),
    voucher: makeDefaultVoucher(),
    order: null,
    user: mockLearner,
    isEnrolled: false,
    ...overrides,
  }
}

// ── Happy path ─────────────────────────────────────────────────────────────

test('Happy path: campaign + voucher + PayOS webhook → enrollment → admin observability', async ({ page }) => {
  const state = freshLearnerState()
  await setAuth(page, mockLearner)
  await mountVoucherCampaignMocks(page, { user: mockLearner, state })

  // Step 2: learner opens course detail → sees campaign price + badge + strikethrough
  await page.goto(`/courses/${COURSE_ID}`)
  await expect(page.getByTestId('campaign-discounted-price')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('campaign-strikethrough-price')).toBeVisible()
  await expect(page.getByTestId('campaign-badge')).toBeVisible()

  // Step 3: click "Mua khoá học" → /confirm-purchase/X
  // The CTA button is the only `.btn-accent.btn-lg` on the page for a learner.
  const cta = page.locator('button.btn-accent.btn-lg').first()
  await cta.click()
  await expect(page).toHaveURL(new RegExp(`/confirm-purchase/${COURSE_ID}`), { timeout: 10_000 })

  // Step 4: confirm page shows breakdown — original + campaign discount.
  await expect(page.getByTestId('confirm-original-price')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('confirm-campaign-discount')).toBeVisible()
  await expect(page.getByTestId('confirm-total-price')).toBeVisible()

  // Step 5: type voucher (lowercase) → Áp dụng → success banner + voucher row + subtotal
  await page.getByTestId('voucher-input').fill('welcome10')
  await page.getByTestId('voucher-apply-btn').click()
  await expect(page.getByTestId('voucher-applied-banner')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('confirm-voucher-discount')).toBeVisible()
  // When BOTH campaign and voucher apply, a Tạm tính row appears.
  await expect(page.getByTestId('confirm-subtotal-row')).toBeVisible()

  // Step 6: Đặt mua → /checkout/:orderId
  await page.getByTestId('confirm-submit-btn').click()
  await expect(page).toHaveURL(/\/checkout\//, { timeout: 10_000 })

  // Step 7: simulate PayOS webhook → order active → CheckoutPage redirects.
  // The page polls every 5s; we flip the mocked order to active then reload
  // so the on-mount getOrder() picks up the new status without waiting.
  simulatePayosWebhook(state)
  await page.reload()
  // On reload the CheckoutPage redirects to /learn/:courseId. LessonPlayer
  // then resolves the first lesson — in the mocked env there's no lesson
  // list, so it bounces back to /courses/:courseId without paywall=true.
  // We assert the user has LEFT /checkout (the active order routed them out)
  // and is NOT bounced to a paywall — the two states that prove enrollment.
  await expect(page).not.toHaveURL(/\/checkout\//, { timeout: 10_000 })
  await expect(page).not.toHaveURL(/paywall=true/)
  // Final assertion against the in-memory state: order is active.
  expect(state.order?.status).toBe('active')
})

test('Happy path admin observability: order shows voucher_code + campaign_name', async ({ page }) => {
  // Seed an already-active order with both a campaign and a voucher applied.
  const state = freshLearnerState()
  state.order = {
    id: 'order-pending-e2e',
    code: 'ORD-2026-000001',
    user_id: mockLearner.id,
    course_id: COURSE_ID,
    status: 'active',
    amount: 72000,
    original_price: 100000,
    campaign_id: state.campaign!.id,
    campaign_discount_amount: 20000,
    voucher_id: state.voucher!.id,
    voucher_code: state.voucher!.code,
    voucher_discount_amount: 8000,
  }
  state.isEnrolled = true

  await setAuth(page, mockAdmin)
  await mountVoucherCampaignMocks(page, { user: mockAdmin, state })

  await page.goto('/admin/orders')
  // Switch to the "All" tab where every order (including active) is listed.
  await page.getByTestId('orders-tab-all').click()

  const orderRow = page.getByTestId(`order-row-${state.order.id}`)
  await expect(orderRow).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId(`order-voucher-cell-${state.order.id}`)).toContainText('WELCOME10')
  await expect(page.getByTestId(`order-campaign-cell-${state.order.id}`)).toContainText('Tết Sale')

  // Click breakdown toggle → breakdown rows visible.
  await page.getByTestId(`order-details-btn-${state.order.id}`).click()
  await expect(page.getByTestId(`order-breakdown-${state.order.id}`)).toBeVisible()
  await expect(page.getByTestId('breakdown-original')).toBeVisible()
  await expect(page.getByTestId('breakdown-campaign')).toBeVisible()
  await expect(page.getByTestId('breakdown-voucher')).toBeVisible()
  await expect(page.getByTestId('breakdown-final')).toBeVisible()
})

// ── Edge case 1: Voucher quota exhausted ──────────────────────────────────
//
// Learner A's purchase has already consumed the only seat (total_quota=1,
// total_uses=1). Learner B inputs the same code → preview_purchase raises
// voucher_quota_exceeded → toast i18n key `voucher.error.quotaExceeded`.

test('Edge — voucher quota exhausted: second learner sees quotaExceeded error', async ({ page }) => {
  const state = freshLearnerState({
    voucher: makeDefaultVoucher({ total_quota: 1, total_uses: 1 }),
  })
  await setAuth(page, mockLearner)
  await mountVoucherCampaignMocks(page, { user: mockLearner, state })

  await page.goto(`/confirm-purchase/${COURSE_ID}`)
  await page.getByTestId('voucher-input').fill('WELCOME10')
  await page.getByTestId('voucher-apply-btn').click()

  const err = page.getByTestId('voucher-error')
  await expect(err).toBeVisible({ timeout: 10_000 })
  // Match Vietnamese i18n string for voucher.error.quotaExceeded (from vi.json)
  await expect(err).toContainText('hết lượt sử dụng')
})

// ── Edge case 2: Voucher not matching course ──────────────────────────────

test('Edge — voucher not for this course: courseNotEligible error', async ({ page }) => {
  const state = freshLearnerState({
    voucher: makeDefaultVoucher({ applicable_courses: ['other-course-id'] }),
  })
  await setAuth(page, mockLearner)
  await mountVoucherCampaignMocks(page, { user: mockLearner, state })

  await page.goto(`/confirm-purchase/${COURSE_ID}`)
  await page.getByTestId('voucher-input').fill('WELCOME10')
  await page.getByTestId('voucher-apply-btn').click()

  const err = page.getByTestId('voucher-error')
  await expect(err).toBeVisible({ timeout: 10_000 })
  await expect(err).toContainText('không áp dụng cho khoá học này')
})

// ── Edge case 3: Voucher expired ──────────────────────────────────────────

test('Edge — voucher expired: expired error', async ({ page }) => {
  const state = freshLearnerState({
    voucher: makeDefaultVoucher({ ends_at: '2026-01-01T00:00:00Z' }),
  })
  await setAuth(page, mockLearner)
  await mountVoucherCampaignMocks(page, { user: mockLearner, state })

  await page.goto(`/confirm-purchase/${COURSE_ID}`)
  await page.getByTestId('voucher-input').fill('WELCOME10')
  await page.getByTestId('voucher-apply-btn').click()

  const err = page.getByTestId('voucher-error')
  await expect(err).toBeVisible({ timeout: 10_000 })
  await expect(err).toContainText('hết hạn')
})

// ── Edge case 4: Per-user limit hit ───────────────────────────────────────
//
// Same user has already redeemed the voucher (per_user_limit=1) — the server
// raises voucher_user_limit. We force the errcode via state.voucher.errorCode
// since "user already used" requires per-user-history which we don't track
// in mocks.

test('Edge — per-user limit hit: userLimitReached error', async ({ page }) => {
  const state = freshLearnerState({
    voucher: makeDefaultVoucher({ per_user_limit: 1, errorCode: 'voucher_user_limit' }),
  })
  await setAuth(page, mockLearner)
  await mountVoucherCampaignMocks(page, { user: mockLearner, state })

  await page.goto(`/confirm-purchase/${COURSE_ID}`)
  await page.getByTestId('voucher-input').fill('WELCOME10')
  await page.getByTestId('voucher-apply-btn').click()

  const err = page.getByTestId('voucher-error')
  await expect(err).toBeVisible({ timeout: 10_000 })
  await expect(err).toContainText('dùng hết số lần')
})

// ── Edge case 5: Cancel returns quota ─────────────────────────────────────
//
// Learner places an order using a voucher with quota=1 (total_uses → 1), then
// cancels via the CheckoutPage cancel dialog. The mocked cancel_order RPC
// decrements total_uses. A subsequent preview_purchase with the same code
// returns success.

test('Edge — cancel returns quota: voucher reusable after cancel', async ({ page }) => {
  const state = freshLearnerState({
    voucher: makeDefaultVoucher({ total_quota: 1, total_uses: 0 }),
  })
  await setAuth(page, mockLearner)
  await mountVoucherCampaignMocks(page, { user: mockLearner, state })

  await page.goto(`/confirm-purchase/${COURSE_ID}`)
  await page.getByTestId('voucher-input').fill('WELCOME10')
  await page.getByTestId('voucher-apply-btn').click()
  await expect(page.getByTestId('voucher-applied-banner')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('confirm-submit-btn').click()
  await expect(page).toHaveURL(/\/checkout\//, { timeout: 10_000 })

  // Open cancel dialog on CheckoutPage and confirm
  // The cancel button is the second .btn-ghost in the action footer.
  const cancelBtn = page.locator('button.btn-ghost').filter({ hasText: /Huỷ|Hủy/ })
  await cancelBtn.click()
  await expect(page.getByTestId('cancel-dialog')).toBeVisible()
  await page.getByTestId('cancel-reason-input').fill('Test cancel returns quota')
  await page.getByTestId('cancel-confirm-btn').click()

  // After cancel, learner is redirected to /account/orders. Now re-apply the
  // voucher on a fresh confirm-purchase page — should succeed because
  // total_uses was rolled back.
  await expect(page).toHaveURL(/\/account\/orders/, { timeout: 10_000 })

  // Reset order state so the page treats us as having no pending order.
  state.order = null
  await page.goto(`/confirm-purchase/${COURSE_ID}`)
  await page.getByTestId('voucher-input').fill('WELCOME10')
  await page.getByTestId('voucher-apply-btn').click()
  await expect(page.getByTestId('voucher-applied-banner')).toBeVisible({ timeout: 10_000 })
})

// ── Edge case 6: Expire returns quota ─────────────────────────────────────
//
// Equivalent semantics to cancel — total_uses rolled back. Tests that even
// when the order has been expired by the cron job, the voucher can be
// reapplied. We simulate by directly resetting total_uses.

test('Edge — expire returns quota: voucher reusable after expire', async ({ page }) => {
  const state = freshLearnerState({
    voucher: makeDefaultVoucher({ total_quota: 1, total_uses: 1 }),
  })
  await setAuth(page, mockLearner)
  await mountVoucherCampaignMocks(page, { user: mockLearner, state })

  // Initial attempt → quotaExceeded
  await page.goto(`/confirm-purchase/${COURSE_ID}`)
  await page.getByTestId('voucher-input').fill('WELCOME10')
  await page.getByTestId('voucher-apply-btn').click()
  await expect(page.getByTestId('voucher-error')).toBeVisible({ timeout: 10_000 })

  // pg_cron `expire_stale_orders()` flips an old pending → expired and
  // decrements total_uses. We simulate by mutating state directly.
  state.voucher!.total_uses = 0

  // Re-apply — now succeeds.
  await page.getByTestId('voucher-input').fill('WELCOME10')
  await page.getByTestId('voucher-apply-btn').click()
  await expect(page.getByTestId('voucher-applied-banner')).toBeVisible({ timeout: 10_000 })
})

// ── Edge case 7: Free path (100% voucher) ─────────────────────────────────
//
// Voucher gives 100% off → final_price=0 → order auto-active + enrollment in
// the same RPC transaction → learner redirects directly to /learn/:courseId.

test('Edge — free path: 100% voucher auto-enrolls and skips checkout', async ({ page }) => {
  const state = freshLearnerState({
    course: makeDefaultCourse({ price: 50000 }),
    campaign: null, // isolate the voucher leg
    voucher: makeDefaultVoucher({ discount_value: 100 }),
  })
  await setAuth(page, mockLearner)
  await mountVoucherCampaignMocks(page, { user: mockLearner, state })

  await page.goto(`/confirm-purchase/${COURSE_ID}`)
  await page.getByTestId('voucher-input').fill('WELCOME10')
  await page.getByTestId('voucher-apply-btn').click()
  await expect(page.getByTestId('voucher-applied-banner')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('confirm-submit-btn').click()

  // Free path skips /checkout entirely. ConfirmPurchasePage navigates to
  // /learn/:courseId directly with state.freeCourseToast. The lesson player
  // then resolves the first lesson — in this mocked env there's no lesson
  // list, so it bounces to /courses/:courseId WITHOUT paywall=true (the user
  // is enrolled). We assert: not on /confirm-purchase, not on a paywall.
  await expect(page).not.toHaveURL(/\/confirm-purchase\//, { timeout: 10_000 })
  await expect(page).not.toHaveURL(/paywall=true/)
  // The order was auto-active per E-09 and a voucher_usages row would have
  // been written — we assert via the in-memory state on the helper side.
  expect(state.order?.status).toBe('active')
  expect(state.order?.voucher_code).toBe('WELCOME10')
})

// ── Edge case 8: Campaign overlap rejection ───────────────────────────────
//
// Admin attempts to create a second campaign overlapping an existing one.
// The mocked create_campaign RPC raises `campaign_overlap_with_existing`
// → AdminCampaignsPage shows the form error.

test('Edge — campaign overlap: admin form shows campaign_overlap_with_existing error', async ({ page }) => {
  // Seed an "overlap-trigger" campaign so the next create_campaign call
  // returns the overlap error (see handleRpc in helpers/voucherCampaign.ts).
  const state = freshLearnerState({
    campaign: { ...makeDefaultCampaign(), id: 'overlap-trigger' },
  })
  await setAuth(page, mockAdmin)
  await mountVoucherCampaignMocks(page, { user: mockAdmin, state })

  await page.goto('/admin/campaigns')
  await page.getByTestId('admin-campaigns-create-btn').click()
  await expect(page.getByTestId('admin-campaigns-form-dialog')).toBeVisible({ timeout: 10_000 })

  // Fill out a minimally-valid form: name, discount=20, dates.
  await page.getByTestId('campaign-name-input').fill('Overlap Campaign')
  await page.getByTestId('campaign-discount-value-input').fill('20')
  await page.getByTestId('campaign-starts-at-input').fill('2026-06-01T00:00')
  await page.getByTestId('campaign-ends-at-input').fill('2026-06-30T00:00')

  await page.getByTestId('admin-campaigns-save-btn').click()

  // The form error banner must show the overlap message (Vietnamese i18n
  // string from `admin.campaigns.form.errors.overlap`).
  await expect(page.getByTestId('admin-campaigns-form-error')).toBeVisible({ timeout: 10_000 })
})
