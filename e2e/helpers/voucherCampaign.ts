/**
 * Voucher + Campaign E2E helpers (PRD-0006 slice 6, issue #310).
 *
 * The codebase mocks Supabase via `page.route()` (ADR-0003) — there is no
 * local Supabase to seed. Helpers here therefore "seed" by registering route
 * handlers that respond as though the data exists. The same handlers can
 * mutate in-memory state across a single test (e.g. simulating webhook
 * delivery flips the mocked order from pending → active).
 */
import type { Page, Route } from '@playwright/test'
import {
  COURSE_ID,
  CHAPTER_ID,
  CREATOR_ID,
  ORDER_ID,
  type MockUser,
} from './mockApi'

export const SUPABASE_URL = 'http://localhost:54321'
export const AUTH_STORAGE_KEY = 'sb-localhost-auth-token'

// ─── Fixture-only ids ──────────────────────────────────────────────────────
export const CAMPAIGN_ID = 'campaign-tet-sale-e2e'
export const VOUCHER_ID = 'voucher-welcome10-e2e'

// ─── Voucher/Campaign shape ────────────────────────────────────────────────

export interface VoucherFixture {
  id: string
  code: string
  discount_type: 'percentage' | 'fixed_amount'
  discount_value: number
  max_discount_amount: number | null
  applicable_courses: string[] | null
  total_quota: number | null
  total_uses: number
  per_user_limit: number
  starts_at: string
  ends_at: string
  is_active: boolean
  campaign_id: string | null
  /**
   * Errcode the mocked preview/create_order RPCs should raise on the next
   * call. Reset to null after one call. Lets tests force a specific edge.
   */
  errorCode?:
    | 'voucher_not_found'
    | 'voucher_inactive'
    | 'voucher_expired'
    | 'voucher_quota_exceeded'
    | 'voucher_user_limit'
    | 'voucher_course_not_eligible'
    | null
}

export interface CampaignFixture {
  id: string
  name: string
  description: string | null
  discount_type: 'percentage' | 'fixed_amount'
  discount_value: number
  max_discount_amount: number | null
  applicable_courses: string[] | null
  starts_at: string
  ends_at: string
  is_active: boolean
}

// ─── Default fixtures ──────────────────────────────────────────────────────

const NOW = '2026-05-20T00:00:00Z'
const FUTURE = '2026-12-31T00:00:00Z'
const PAST = '2026-01-01T00:00:00Z'

export function makeDefaultCampaign(overrides: Partial<CampaignFixture> = {}): CampaignFixture {
  return {
    id: CAMPAIGN_ID,
    name: 'Tết Sale -20%',
    description: 'Khuyến mại toàn bộ',
    discount_type: 'percentage',
    discount_value: 20,
    max_discount_amount: null,
    applicable_courses: null,
    starts_at: PAST,
    ends_at: FUTURE,
    is_active: true,
    ...overrides,
  }
}

export function makeDefaultVoucher(overrides: Partial<VoucherFixture> = {}): VoucherFixture {
  return {
    id: VOUCHER_ID,
    code: 'WELCOME10',
    discount_type: 'percentage',
    discount_value: 10,
    max_discount_amount: null,
    applicable_courses: [COURSE_ID],
    total_quota: 100,
    total_uses: 0,
    per_user_limit: 1,
    starts_at: PAST,
    ends_at: FUTURE,
    is_active: true,
    campaign_id: null,
    errorCode: null,
    ...overrides,
  }
}

// ─── Pricing math (mirrors ADR-0007 + voucher SQL) ─────────────────────────

function discountFor(price: number, d: { discount_type: 'percentage' | 'fixed_amount'; discount_value: number; max_discount_amount: number | null }): number {
  if (price <= 0) return 0
  if (d.discount_type === 'percentage') {
    const raw = Math.floor((price * d.discount_value) / 100)
    if (d.max_discount_amount == null) return raw
    return Math.min(raw, d.max_discount_amount)
  }
  return Math.min(d.discount_value, price)
}

// ─── Mocked auth/session (admin variant) ───────────────────────────────────

export function buildSession(user: MockUser) {
  return {
    access_token: `mock-access-${user.id}`,
    refresh_token: `mock-refresh-${user.id}`,
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: {
      id: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      email_confirmed_at: '2026-01-01T00:00:00.000Z',
      confirmed_at: '2026-01-01T00:00:00.000Z',
      last_sign_in_at: '2026-01-01T00:00:00.000Z',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { name: user.name },
      identities: [],
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  }
}

export function buildUserRow(user: MockUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar_url: null,
    role: user.role,
    account_tier_id: 'individual',
    created_at: '2026-01-01T00:00:00.000Z',
    editor_advanced: false,
    bio: null,
  }
}

// ─── Course fixture (defaults to 100k VND) ─────────────────────────────────

interface CourseFixture {
  id: string
  title: string
  price: number
}

export function makeDefaultCourse(overrides: Partial<CourseFixture> = {}): CourseFixture {
  return {
    id: COURSE_ID,
    title: 'Khoá học cờ vua E2E',
    price: 100000,
    ...overrides,
  }
}

// ─── State that mutates across a single test ───────────────────────────────

export interface VoucherCampaignState {
  course: CourseFixture
  campaign: CampaignFixture | null
  voucher: VoucherFixture | null
  /** Current order. Tests flip `status` to 'active' to simulate a webhook. */
  order: {
    id: string
    code: string
    user_id: string
    course_id: string
    status: 'pending' | 'active' | 'cancelled'
    amount: number
    original_price: number
    campaign_id: string | null
    campaign_discount_amount: number
    voucher_id: string | null
    voucher_code: string | null
    voucher_discount_amount: number
  } | null
  user: MockUser | null
  isEnrolled: boolean
}

// ─── Mount full mocks (admin/learner aware) ────────────────────────────────

export interface MountOptions {
  user: MockUser | null
  state: VoucherCampaignState
  /**
   * Optional hook so tests can register additional route handlers after the
   * base mounts. The handlers will *override* base mocks for the routes
   * they register (Playwright route resolution: last-wins).
   */
  extra?: (page: Page) => Promise<void>
}

/** Sets a Supabase session BEFORE page.goto(). */
export async function setAuth(page: Page, user: MockUser | null) {
  await page.addInitScript(
    ({ key, session }: { key: string; session: unknown }) => {
      if (session !== null) {
        localStorage.setItem(key, JSON.stringify(session))
      }
    },
    { key: AUTH_STORAGE_KEY, session: user ? buildSession(user) : null },
  )
}

/**
 * Registers route handlers that simulate Supabase REST/RPC for the voucher
 * + campaign flow.  All handlers read from the `state` object passed in, so
 * tests can mutate it mid-flight (e.g. flip `state.order.status = 'active'`
 * to mimic a PayOS webhook delivery).
 */
export async function mountVoucherCampaignMocks(page: Page, opts: MountOptions): Promise<void> {
  const { user, state } = opts

  // ── Auth ────────────────────────────────────────────────────────────────
  await page.route(`${SUPABASE_URL}/auth/v1/token**`, async route => {
    if (user) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildSession(user)),
      })
    } else {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_grant' }),
      })
    }
  })

  await page.route(`${SUPABASE_URL}/auth/v1/user**`, async route => {
    if (user) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildSession(user).user),
      })
    } else {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
    }
  })

  // ── users table (profile) ───────────────────────────────────────────────
  await page.route(`${SUPABASE_URL}/rest/v1/users**`, async route => {
    if (user) {
      const accept = route.request().headers()['accept'] ?? ''
      const isSingle = accept.includes('application/vnd.pgrst.object+json')
      const body = isSingle ? JSON.stringify(buildUserRow(user)) : JSON.stringify([buildUserRow(user)])
      await route.fulfill({ status: 200, contentType: 'application/json', body })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
  })

  // ── courses table ───────────────────────────────────────────────────────
  await page.route(`${SUPABASE_URL}/rest/v1/courses**`, async route => {
    const accept = route.request().headers()['accept'] ?? ''
    const isSingle = accept.includes('application/vnd.pgrst.object+json')
    const url = route.request().url()

    // listAdminCourses() — the admin form / multi-select lazy-load —
    // requests only `select=id,title` ordered by title. Detect by EXACT
    // match on the encoded `select=id%2Ctitle&` (note the trailing & or
    // end-of-string) so we don't false-match longer SELECT lists that
    // start with `id,title,...`.
    const thinListPattern = /[?&]select=id%2Ctitle&|[?&]select=id%2Ctitle$|[?&]select=id,title&|[?&]select=id,title$/
    if (thinListPattern.test(url)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: state.course.id, title: state.course.title }]),
      })
      return
    }

    const courseRow = {
      id: state.course.id,
      title: state.course.title,
      description: 'Khoá học dành cho kiểm thử E2E',
      thumbnail_url: null,
      price: state.course.price,
      original_price: null,
      promo_ends_at: null,
      level: 'beginner',
      language: 'vi',
      tags: [],
      creator_id: CREATOR_ID,
      what_you_learn: [],
      prerequisites: null,
      status: 'published',
      created_at: '2026-01-01T00:00:00.000Z',
      creator: { name: 'Creator E2E' },
      reviews: [],
      enrollments: [],
      chapters: [{ id: CHAPTER_ID, title: 'Chương 1', position: 1 }],
      free_preview_count: 0,
      lessons_count: 1,
      duration_hours: 1,
    }
    const body = isSingle ? JSON.stringify(courseRow) : JSON.stringify([courseRow])
    await route.fulfill({ status: 200, contentType: 'application/json', body })
  })

  // ── enrollments ─────────────────────────────────────────────────────────
  await page.route(`${SUPABASE_URL}/rest/v1/enrollments**`, async route => {
    const method = route.request().method()
    if (method === 'HEAD') {
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Range': state.isEnrolled && user ? '0-0/1' : '*/0',
          'Content-Type': 'application/json',
        },
        body: '',
      })
    } else {
      const rows = state.isEnrolled && user
        ? [{ id: 'enroll-e2e', user_id: user.id, course_id: state.course.id, status: 'active' }]
        : []
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) })
    }
  })

  // ── orders table (read-only — order creation goes via RPC) ──────────────
  await page.route(`${SUPABASE_URL}/rest/v1/orders**`, async route => {
    const method = route.request().method()
    if (method !== 'GET' && method !== 'HEAD') {
      // PATCH/PUT/POST aren't used outside RPC in this flow
      await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
      return
    }
    // HEAD with count=exact: PostgREST returns the count in Content-Range.
    // Used by getStalePendingOrderCount / getRefundPendingOrderCount.
    if (method === 'HEAD') {
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Range': '*/0',
          'Content-Type': 'application/json',
        },
        body: '',
      })
      return
    }
    const accept = route.request().headers()['accept'] ?? ''
    const isSingle = accept.includes('application/vnd.pgrst.object+json')
    const url = route.request().url()

    // Admin orders list: includes campaign:campaign_id(name) — return array
    if (url.includes('campaign%3Acampaign_id') || url.includes('campaign:campaign_id')) {
      const rows: unknown[] = []
      if (state.order) {
        rows.push({
          id: state.order.id,
          course_id: state.order.course_id,
          user_id: state.order.user_id,
          status: state.order.status,
          amount: state.order.amount,
          code: state.order.code,
          notes: null,
          platform_fee_pct: 20,
          platform_fee_amount: Math.floor((state.order.amount * 20) / 100),
          creator_payout_amount: state.order.amount - Math.floor((state.order.amount * 20) / 100),
          creator_payout: state.order.amount - Math.floor((state.order.amount * 20) / 100),
          account_tier_code: 'individual',
          confirmed_at: state.order.status === 'active' ? '2026-05-20T00:00:00Z' : null,
          confirmed_by: state.order.status === 'active' ? 'admin-e2e' : null,
          cancelled_at: null,
          cancelled_by: null,
          cancelled_reason: null,
          manual_confirm_reason: null,
          created_at: '2026-05-20T00:00:00Z',
          updated_at: '2026-05-20T00:00:00Z',
          original_price: state.order.original_price,
          campaign_id: state.order.campaign_id,
          campaign_discount_amount: state.order.campaign_discount_amount,
          voucher_id: state.order.voucher_id,
          voucher_code: state.order.voucher_code,
          voucher_discount_amount: state.order.voucher_discount_amount,
          buyer: user ? { id: user.id, name: user.name, email: user.email, avatar_url: null } : null,
          course: { id: state.course.id, title: state.course.title },
          campaign: state.order.campaign_id && state.campaign
            ? { id: state.campaign.id, name: state.campaign.name }
            : null,
        })
      }
      // PostgREST returns Content-Range when count is requested
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Range': `0-${Math.max(0, rows.length - 1)}/${rows.length}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(rows),
      })
      return
    }

    // getOrder() — single by id (Checkout page)
    if (isSingle && state.order && url.includes(state.order.id)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: state.order.id,
          course_id: state.order.course_id,
          user_id: state.order.user_id,
          status: state.order.status,
          amount: state.order.amount,
          code: state.order.code,
          notes: null,
          platform_fee_pct: 20,
          platform_fee_amount: Math.floor((state.order.amount * 20) / 100),
          creator_payout_amount: state.order.amount - Math.floor((state.order.amount * 20) / 100),
          creator_payout: state.order.amount - Math.floor((state.order.amount * 20) / 100),
          account_tier_code: 'individual',
          confirmed_at: state.order.status === 'active' ? '2026-05-20T00:00:00Z' : null,
          confirmed_by: state.order.status === 'active' ? 'admin-e2e' : null,
          cancelled_at: state.order.status === 'cancelled' ? '2026-05-20T00:00:00Z' : null,
          cancelled_by: null,
          cancelled_reason: null,
          manual_confirm_reason: null,
          created_at: '2026-05-20T00:00:00Z',
          updated_at: '2026-05-20T00:00:00Z',
          course: { id: state.course.id, title: state.course.title, thumbnail_url: null },
        }),
      })
      return
    }

    // getPendingOrderForCourse — used by CourseDetailPage + ConfirmPurchase guard
    const hasPending = state.order && state.order.status === 'pending'
    if (isSingle) {
      // maybeSingle() → null when no row
      if (hasPending && state.order) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: state.order.id,
            course_id: state.order.course_id,
            user_id: state.order.user_id,
            status: 'pending',
            amount: state.order.amount,
            code: state.order.code,
            created_at: '2026-05-20T00:00:00Z',
            updated_at: '2026-05-20T00:00:00Z',
          }),
        })
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
      }
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })

  // ── campaigns table (admin list) ────────────────────────────────────────
  await page.route(`${SUPABASE_URL}/rest/v1/campaigns**`, async route => {
    const rows = state.campaign ? [state.campaign] : []
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) })
  })

  // ── vouchers table (admin list) ─────────────────────────────────────────
  await page.route(`${SUPABASE_URL}/rest/v1/vouchers**`, async route => {
    const rows = state.voucher ? [state.voucher] : []
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) })
  })

  // ── voucher_usages table (admin drawer) ─────────────────────────────────
  await page.route(`${SUPABASE_URL}/rest/v1/voucher_usages**`, async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })

  // ── chapters / lessons / lesson_progress / bookmarks — minimal stubs ────
  await page.route(`${SUPABASE_URL}/rest/v1/chapters**`, async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.route(`${SUPABASE_URL}/rest/v1/lessons**`, async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.route(`${SUPABASE_URL}/rest/v1/lesson_progress**`, async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.route(`${SUPABASE_URL}/rest/v1/bookmarks**`, async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })

  // ── RPC catch-all (most logic lives here) ───────────────────────────────
  await page.route(`${SUPABASE_URL}/rest/v1/rpc/**`, async route => {
    await handleRpc(route, state)
  })

  // ── PayOS Edge Function — returns a stub QR payload ─────────────────────
  await page.route(`${SUPABASE_URL}/functions/v1/payos-create-payment**`, async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        qrCode: '00020101021238...stubbed-payos-qr-code',
        accountNumber: '0123456789',
        accountName: 'GAMBITLY E2E',
        bin: '970422',
        amount: state.order?.amount ?? 0,
        description: state.order?.code ?? 'ORD-E2E',
        checkoutUrl: null,
      }),
    })
  })

  // ── Storage (signed URLs) — never used in this flow ────────────────────
  await page.route(`${SUPABASE_URL}/storage/v1/**`, async route => {
    await route.fulfill({ status: 403, contentType: 'application/json', body: '{}' })
  })

  if (opts.extra) await opts.extra(page)
}

// ─── RPC dispatcher ────────────────────────────────────────────────────────

async function handleRpc(route: Route, state: VoucherCampaignState): Promise<void> {
  const url = route.request().url()
  const reqBody = route.request().postDataJSON() as Record<string, unknown> | null

  // get_active_campaign_for_course — returns the campaign row (or null)
  if (url.includes('get_active_campaign_for_course')) {
    const applies =
      state.campaign &&
      state.campaign.is_active &&
      (state.campaign.applicable_courses == null ||
        state.campaign.applicable_courses.includes(state.course.id))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(applies ? state.campaign : null),
    })
    return
  }

  // preview_purchase — voucher-aware breakdown
  if (url.includes('preview_purchase')) {
    const voucherCode = (reqBody?.p_voucher_code as string | null) ?? null

    const campaignApplies =
      state.campaign &&
      state.campaign.is_active &&
      (state.campaign.applicable_courses == null ||
        state.campaign.applicable_courses.includes(state.course.id))
    const campaignDiscount = campaignApplies
      ? discountFor(state.course.price, state.campaign!)
      : 0

    let voucherDiscount = 0
    let voucherId: string | null = null
    let voucherCodeOut: string | null = null

    if (voucherCode) {
      const v = state.voucher
      // PostgREST raises RPC errors as HTTP 4xx with a {code,message,details,hint} body.
      // Supabase JS surfaces the message field on the `error` object.
      const respondVoucherError = async (msg: string) => {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'P0001', message: msg, details: null, hint: null }),
        })
      }
      if (!v || v.code !== voucherCode.toUpperCase()) {
        await respondVoucherError('voucher_not_found')
        return
      }
      if (v.errorCode) {
        const errcode = v.errorCode
        v.errorCode = null // one-shot
        await respondVoucherError(errcode)
        return
      }
      if (!v.is_active) {
        await respondVoucherError('voucher_inactive')
        return
      }
      if (new Date(v.ends_at).getTime() < new Date(NOW).getTime()) {
        await respondVoucherError('voucher_expired')
        return
      }
      if (v.applicable_courses && !v.applicable_courses.includes(state.course.id)) {
        await respondVoucherError('voucher_course_not_eligible')
        return
      }
      if (v.total_quota !== null && v.total_uses >= v.total_quota) {
        await respondVoucherError('voucher_quota_exceeded')
        return
      }

      const afterCampaign = state.course.price - campaignDiscount
      voucherDiscount = discountFor(afterCampaign, v)
      voucherId = v.id
      voucherCodeOut = v.code
    }

    const finalPrice = Math.max(state.course.price - campaignDiscount - voucherDiscount, 0)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        original_price: state.course.price,
        campaign_id: campaignApplies ? state.campaign!.id : null,
        campaign_name: campaignApplies ? state.campaign!.name : null,
        campaign_discount_amount: campaignDiscount,
        voucher_id: voucherId,
        voucher_code: voucherCodeOut,
        voucher_discount_amount: voucherDiscount,
        final_price: finalPrice,
        platform_fee_pct: 20,
        platform_fee_amount: Math.floor((finalPrice * 20) / 100),
        creator_payout_amount: finalPrice - Math.floor((finalPrice * 20) / 100),
      }),
    })
    return
  }

  // create_order_with_fee_snapshot — atomic create + voucher consume
  if (url.includes('create_order_with_fee_snapshot')) {
    const voucherCode = (reqBody?.p_voucher_code as string | null) ?? null
    const campaignApplies =
      state.campaign &&
      state.campaign.is_active &&
      (state.campaign.applicable_courses == null ||
        state.campaign.applicable_courses.includes(state.course.id))
    const campaignDiscount = campaignApplies ? discountFor(state.course.price, state.campaign!) : 0

    let voucherDiscount = 0
    let voucherId: string | null = null
    let voucherCodeOut: string | null = null

    if (voucherCode) {
      const v = state.voucher
      if (!v || v.code !== voucherCode.toUpperCase() || !v.is_active) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'P0001', message: 'voucher_not_found', details: null, hint: null }),
        })
        return
      }
      if (v.errorCode) {
        const errcode = v.errorCode
        v.errorCode = null
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'P0001', message: errcode, details: null, hint: null }),
        })
        return
      }
      const afterCampaign = state.course.price - campaignDiscount
      voucherDiscount = discountFor(afterCampaign, v)
      voucherId = v.id
      voucherCodeOut = v.code

      // consume quota
      v.total_uses += 1
    }

    const finalPrice = Math.max(state.course.price - campaignDiscount - voucherDiscount, 0)
    const isFree = finalPrice === 0

    state.order = {
      id: ORDER_ID,
      code: 'ORD-2026-000001',
      user_id: state.user?.id ?? 'unknown',
      course_id: state.course.id,
      status: isFree ? 'active' : 'pending',
      amount: finalPrice,
      original_price: state.course.price,
      campaign_id: campaignApplies ? state.campaign!.id : null,
      campaign_discount_amount: campaignDiscount,
      voucher_id: voucherId,
      voucher_code: voucherCodeOut,
      voucher_discount_amount: voucherDiscount,
    }
    if (isFree) state.isEnrolled = true

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: state.order.id,
        course_id: state.order.course_id,
        user_id: state.order.user_id,
        status: state.order.status,
        amount: state.order.amount,
        code: state.order.code,
        platform_fee_pct: 20,
        platform_fee_amount: Math.floor((finalPrice * 20) / 100),
        creator_payout_amount: finalPrice - Math.floor((finalPrice * 20) / 100),
        creator_payout: finalPrice - Math.floor((finalPrice * 20) / 100),
        account_tier_code: 'individual',
        original_price: state.order.original_price,
        campaign_id: state.order.campaign_id,
        campaign_discount_amount: state.order.campaign_discount_amount,
        voucher_id: state.order.voucher_id,
        voucher_code: state.order.voucher_code,
        voucher_discount_amount: state.order.voucher_discount_amount,
      }),
    })
    return
  }

  // cancel_order — flips status to cancelled and (in mock) decrements voucher
  if (url.includes('cancel_order')) {
    if (state.order && state.order.status === 'pending') {
      state.order.status = 'cancelled'
      // PRD-0006 slice 4: cancel returns voucher quota
      if (state.order.voucher_id && state.voucher && state.voucher.total_uses > 0) {
        state.voucher.total_uses -= 1
      }
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.order ?? null),
    })
    return
  }

  // confirm_order — admin manual confirm (slice 5 happy-path observability)
  if (url.includes('confirm_order')) {
    if (state.order) state.order.status = 'active'
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.order ?? null),
    })
    return
  }

  // create_campaign — admin form. Triggers overlap error if `overlap` arg set.
  if (url.includes('create_campaign')) {
    if (state.campaign && state.campaign.id === 'overlap-trigger') {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'P0001', message: 'campaign_overlap_with_existing', details: null, hint: null }),
      })
      return
    }
    const newCamp: CampaignFixture = {
      id: `campaign-${Date.now()}`,
      name: (reqBody?.p_name as string) ?? 'New Campaign',
      description: (reqBody?.p_description as string | null) ?? null,
      discount_type: (reqBody?.p_discount_type as 'percentage' | 'fixed_amount') ?? 'percentage',
      discount_value: (reqBody?.p_discount_value as number) ?? 10,
      max_discount_amount: (reqBody?.p_max_discount_amount as number | null) ?? null,
      applicable_courses: (reqBody?.p_applicable_courses as string[] | null) ?? null,
      starts_at: (reqBody?.p_starts_at as string) ?? PAST,
      ends_at: (reqBody?.p_ends_at as string) ?? FUTURE,
      is_active: true,
    }
    state.campaign = newCamp
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(newCamp),
    })
    return
  }

  // create_voucher — admin form.
  if (url.includes('create_voucher')) {
    const newVoucher: VoucherFixture = {
      id: `voucher-${Date.now()}`,
      code: ((reqBody?.p_code as string) ?? 'NEWCODE').toUpperCase(),
      discount_type: (reqBody?.p_discount_type as 'percentage' | 'fixed_amount') ?? 'percentage',
      discount_value: (reqBody?.p_discount_value as number) ?? 10,
      max_discount_amount: (reqBody?.p_max_discount_amount as number | null) ?? null,
      applicable_courses: (reqBody?.p_applicable_courses as string[] | null) ?? null,
      total_quota: (reqBody?.p_total_quota as number | null) ?? null,
      total_uses: 0,
      per_user_limit: (reqBody?.p_per_user_limit as number) ?? 1,
      starts_at: (reqBody?.p_starts_at as string) ?? PAST,
      ends_at: (reqBody?.p_ends_at as string) ?? FUTURE,
      is_active: true,
      campaign_id: (reqBody?.p_campaign_id as string | null) ?? null,
      errorCode: null,
    }
    state.voucher = newVoucher
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(newVoucher),
    })
    return
  }

  // Stale / refund counts — return zero by default
  if (url.includes('get_video_playback_info')) {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        video_status: 'ready',
        video_provider: 'supabase',
        video_provider_id: 'test/video.mp4',
      }]),
    })
    return
  }

  if (url.includes('get_course_lesson_list')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    return
  }

  // Catch-all: respond null for every other RPC.
  await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
}

/**
 * Simulate a PayOS webhook firing: flip the in-memory order to active. The
 * checkout-page polling loop will then redirect the learner to /learn/:id.
 */
export function simulatePayosWebhook(state: VoucherCampaignState): void {
  if (!state.order) throw new Error('simulatePayosWebhook: no order in state')
  state.order.status = 'active'
  state.isEnrolled = true
}
