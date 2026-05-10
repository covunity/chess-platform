import type { Page } from '@playwright/test'

// ─── Shared test fixture IDs ───────────────────────────────────────────────
export const COURSE_ID = 'course-e2e-0001'
export const FREE_LESSON_ID = 'lesson-free-e2e'
export const PAID_LESSON_ID = 'lesson-paid-e2e'
export const CHAPTER_ID = 'chapter-e2e-0001'
export const LEARNER_ID = 'user-learner-e2e'
export const ADMIN_ID = 'user-admin-e2e'
export const CREATOR_ID = 'user-creator-e2e'
export const ORDER_ID = 'order-pending-e2e'

// Must match Supabase URL injected at build time via playwright.config.ts webServer.env
const SUPABASE_URL = 'http://localhost:54321'

// Derived from the Supabase JS default: `sb-${hostname.split('.')[0]}-auth-token`
// hostname of 'localhost:54321' → 'localhost' → key = 'sb-localhost-auth-token'
const AUTH_STORAGE_KEY = 'sb-localhost-auth-token'

// ─── User personas ─────────────────────────────────────────────────────────
export interface MockUser {
  id: string
  email: string
  role: 'learner' | 'admin' | 'creator'
  name: string
}

export const mockLearner: MockUser = {
  id: LEARNER_ID,
  email: 'learner@e2e.test',
  role: 'learner',
  name: 'E2E Learner',
}

export const mockAdmin: MockUser = {
  id: ADMIN_ID,
  email: 'admin@e2e.test',
  role: 'admin',
  name: 'E2E Admin',
}

export const mockCreator: MockUser = {
  id: CREATOR_ID,
  email: 'creator@e2e.test',
  role: 'creator',
  name: 'E2E Creator',
}

// ─── Session builder ───────────────────────────────────────────────────────
function buildSession(user: MockUser) {
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

function buildUserRow(user: MockUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar_url: null,
    role: user.role,
    account_tier_id: 'individual',
    created_at: '2026-01-01T00:00:00.000Z',
  }
}

// ─── Mock course data ──────────────────────────────────────────────────────
// get_course_lesson_list RPC returns flat rows with chapter_id
const lessonListRows = [
  {
    id: FREE_LESSON_ID,
    chapter_id: CHAPTER_ID,
    title: 'Bài miễn phí',
    type: 'chess',
    position: 1,
    free_preview: true,
    duration_seconds: 300,
  },
  {
    id: PAID_LESSON_ID,
    chapter_id: CHAPTER_ID,
    title: 'Bài trả phí',
    type: 'chess',
    position: 2,
    free_preview: false,
    duration_seconds: 600,
  },
]

// courses table response (chapters without lessons — lessons come from RPC)
const courseRow = {
  id: COURSE_ID,
  title: 'Khoá học cờ vua E2E',
  description: 'Khoá học dành cho kiểm thử E2E',
  thumbnail_url: null,
  price: 100000,
  original_price: null,
  promo_ends_at: null,
  level: 'beginner',
  language: 'vi',
  tags: [],
  creator_id: CREATOR_ID,
  what_you_learn: [],
  prerequisites: null,
  created_at: '2026-01-01T00:00:00.000Z',
  creator: { name: 'Creator E2E' },
  reviews: [],
  enrollments: [],
  chapters: [
    { id: CHAPTER_ID, title: 'Chương 1', position: 1 },
  ],
}

// Full lesson detail returned by getLessonForPlayer
const freeLessonDetail = {
  id: FREE_LESSON_ID,
  title: 'Bài miễn phí',
  type: 'chess',
  pgn_data: '1. e4 e5',
  board_perspective: 'white',
  coach_note: null,
  video_provider: null,
  video_provider_id: null,
  video_status: null,
}

const paidLessonDetail = {
  id: PAID_LESSON_ID,
  title: 'Bài trả phí',
  type: 'chess',
  pgn_data: '1. d4 d5',
  board_perspective: 'white',
  coach_note: null,
  video_provider: null,
  video_provider_id: null,
  video_status: null,
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Injects a Supabase session into localStorage before the page hydrates. */
export async function setAuthState(page: Page, user: MockUser | null) {
  await page.addInitScript(
    ({ key, session }: { key: string; session: unknown }) => {
      if (session !== null) {
        localStorage.setItem(key, JSON.stringify(session))
      }
    },
    { key: AUTH_STORAGE_KEY, session: user ? buildSession(user) : null },
  )
}

interface MockOptions {
  user: MockUser | null
  isEnrolled: boolean
  hasPendingOrder: boolean
}

/**
 * Mounts page.route() intercepts that simulate Supabase responses.
 * Must be called before page.goto().
 */
export async function mountSupabaseMocks(page: Page, opts: MockOptions) {
  const { user, isEnrolled, hasPendingOrder } = opts

  // ── Auth token refresh ────────────────────────────────────────────────────
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
        body: JSON.stringify({ error: 'invalid_grant', error_description: 'No session' }),
      })
    }
  })

  // ── Auth user ─────────────────────────────────────────────────────────────
  await page.route(`${SUPABASE_URL}/auth/v1/user**`, async route => {
    if (user) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildSession(user).user),
      })
    } else {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Not authenticated' }),
      })
    }
  })

  // ── users table (profile) ─────────────────────────────────────────────────
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

  // ── courses table ─────────────────────────────────────────────────────────
  await page.route(`${SUPABASE_URL}/rest/v1/courses**`, async route => {
    const accept = route.request().headers()['accept'] ?? ''
    const isSingle = accept.includes('application/vnd.pgrst.object+json')
    const body = isSingle ? JSON.stringify(courseRow) : JSON.stringify([courseRow])
    await route.fulfill({ status: 200, contentType: 'application/json', body })
  })

  // ── enrollments table ─────────────────────────────────────────────────────
  await page.route(`${SUPABASE_URL}/rest/v1/enrollments**`, async route => {
    const method = route.request().method()
    if (method === 'HEAD') {
      // checkUserEnrollment uses { count: 'exact', head: true }
      // PostgREST returns count in Content-Range header: `*/N` or `0-0/N`
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Range': isEnrolled && user ? '0-0/1' : '*/0',
          'Content-Type': 'application/json',
        },
        body: '',
      })
    } else {
      const rows = isEnrolled && user
        ? [{ id: 'enroll-e2e', user_id: user.id, course_id: COURSE_ID, status: 'active' }]
        : []
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) })
    }
  })

  // ── orders table ──────────────────────────────────────────────────────────
  await page.route(`${SUPABASE_URL}/rest/v1/orders**`, async route => {
    const method = route.request().method()
    if (method === 'POST') {
      // Order creation — return a new pending order
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify([{ id: ORDER_ID, status: 'pending', code: 'ORD-E2E-001' }]),
      })
      return
    }
    if (hasPendingOrder && user) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: ORDER_ID,
          user_id: user.id,
          course_id: COURSE_ID,
          status: 'pending',
          amount: 100000,
          code: 'ORD-E2E-001',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        }),
      })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
    }
  })

  // ── lessons table ─────────────────────────────────────────────────────────
  // With RLS from #150: non-enrolled users get 0 rows for paid lessons.
  await page.route(`${SUPABASE_URL}/rest/v1/lessons**`, async route => {
    const url = route.request().url()
    const isPaidQuery = url.includes(PAID_LESSON_ID)
    const canSeePaid = isEnrolled || user?.role === 'admin'

    let detail: typeof freeLessonDetail | typeof paidLessonDetail | null
    if (isPaidQuery) {
      detail = canSeePaid ? paidLessonDetail : null
    } else {
      detail = freeLessonDetail
    }

    const accept = route.request().headers()['accept'] ?? ''
    const isSingle = accept.includes('application/vnd.pgrst.object+json')

    if (detail === null) {
      // RLS blocks → PGRST116 no rows
      await route.fulfill({
        status: 406,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'PGRST116', message: 'The result contains 0 rows' }),
      })
    } else if (isSingle) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([detail]) })
    }
  })

  // ── RPC calls ─────────────────────────────────────────────────────────────
  await page.route(`${SUPABASE_URL}/rest/v1/rpc/**`, async route => {
    const url = route.request().url()

    if (url.includes('create_order_with_fee_snapshot')) {
      if (!user) {
        await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Not authenticated' }) })
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: ORDER_ID,
            course_id: COURSE_ID,
            user_id: user.id,
            status: 'pending',
            amount: 100000,
            code: 'ORD-E2E-001',
          }),
        })
      }
      return
    }

    if (url.includes('get_course_lesson_list')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(lessonListRows),
      })
      return
    }

    if (url.includes('get_video_playback_info')) {
      const canAccess = isEnrolled || user?.role === 'admin'
      if (!canAccess) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          // RPC raises SQLSTATE 42501 — PostgREST returns this as a 200 with error body
          body: JSON.stringify({ code: '42501', message: 'forbidden', details: null, hint: null }),
        })
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{
            video_status: 'ready',
            video_provider: 'supabase',
            video_provider_id: 'test/video.mp4',
          }]),
        })
      }
      return
    }

    // Catch-all for other RPCs
    await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
  })

  // ── lesson_progress table ─────────────────────────────────────────────────
  await page.route(`${SUPABASE_URL}/rest/v1/lesson_progress**`, async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })

  // ── bookmarks table ───────────────────────────────────────────────────────
  await page.route(`${SUPABASE_URL}/rest/v1/bookmarks**`, async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
  })

  // ── Storage (signed URLs) ─────────────────────────────────────────────────
  await page.route(`${SUPABASE_URL}/storage/v1/**`, async route => {
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Unauthorized' }),
    })
  })
}
