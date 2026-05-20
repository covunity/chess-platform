import { test, expect } from '@playwright/test'
import {
  setAuthState,
  mountSupabaseMocks,
  mockLearner,
  mockAdmin,
  COURSE_ID,
  FREE_LESSON_ID,
  PAID_LESSON_ID,
  ORDER_ID,
} from './helpers/mockApi'

// ── Test 1: Anonymous → paid lesson ──────────────────────────────────────────
test('Anonymous user accessing paid lesson is redirected to paywall', async ({ page }) => {
  await setAuthState(page, null)
  await mountSupabaseMocks(page, { user: null, isEnrolled: false, hasPendingOrder: false })

  await page.goto(`/learn/${COURSE_ID}/${PAID_LESSON_ID}`)

  await expect(page).toHaveURL(new RegExp(`/courses/${COURSE_ID}.*paywall=true`), { timeout: 10_000 })
  await expect(page.getByTestId('paywall-banner')).toBeVisible()
})

// ── Test 2: Non-enrolled learner → paid lesson ────────────────────────────────
test('Non-enrolled learner accessing paid lesson is redirected to paywall', async ({ page }) => {
  await setAuthState(page, mockLearner)
  await mountSupabaseMocks(page, { user: mockLearner, isEnrolled: false, hasPendingOrder: false })

  await page.goto(`/learn/${COURSE_ID}/${PAID_LESSON_ID}`)

  await expect(page).toHaveURL(new RegExp(`/courses/${COURSE_ID}.*paywall=true`), { timeout: 10_000 })
  await expect(page.getByTestId('paywall-banner')).toBeVisible()
})

// ── Test 3a: Free preview lesson — anonymous user ─────────────────────────────
test('Anonymous user can view free preview lesson without redirect', async ({ page }) => {
  await setAuthState(page, null)
  await mountSupabaseMocks(page, { user: null, isEnrolled: false, hasPendingOrder: false })

  await page.goto(`/learn/${COURSE_ID}/${FREE_LESSON_ID}`)

  // Must NOT redirect to paywall
  await expect(page).not.toHaveURL(/paywall/, { timeout: 10_000 })
  await expect(page).toHaveURL(new RegExp(`/learn/${COURSE_ID}`))
})

// ── Test 3b: Free preview lesson — non-enrolled logged-in user ────────────────
test('Non-enrolled learner can view free preview lesson without redirect', async ({ page }) => {
  await setAuthState(page, mockLearner)
  await mountSupabaseMocks(page, { user: mockLearner, isEnrolled: false, hasPendingOrder: false })

  await page.goto(`/learn/${COURSE_ID}/${FREE_LESSON_ID}`)

  await expect(page).not.toHaveURL(/paywall/, { timeout: 10_000 })
  await expect(page).toHaveURL(new RegExp(`/learn/${COURSE_ID}`))
})

// ── Test 4: Buy → pending → admin confirm → unlocked ─────────────────────────
// 4a: Learner with pending order sees pending banner when trying paid lesson
test('Learner with pending order is redirected to pending-order page on course detail', async ({ page }) => {
  await setAuthState(page, mockLearner)
  await mountSupabaseMocks(page, { user: mockLearner, isEnrolled: false, hasPendingOrder: true })

  await page.goto(`/learn/${COURSE_ID}/${PAID_LESSON_ID}`)

  // Redirected to course detail with pendingOrder param
  await expect(page).toHaveURL(new RegExp(`/courses/${COURSE_ID}.*pendingOrder=true`), { timeout: 10_000 })
})

// 4a-full: Learner clicks "Mua khoá học" → /confirm-purchase intermediate page
// PRD-0006 slice 2 (#305) inserted /confirm-purchase/:courseId between the CTA
// and /checkout/:orderId so the learner can preview campaign + voucher breakdown
// before the order row is created.
test('Learner can complete purchase flow: click buy → confirm-purchase page', async ({ page }) => {
  await setAuthState(page, mockLearner)
  await mountSupabaseMocks(page, { user: mockLearner, isEnrolled: false, hasPendingOrder: false })

  await page.goto(`/courses/${COURSE_ID}`)

  const ctaButton = page.locator('button.btn-accent').filter({ hasText: /[Mm]ua|purchase/i }).first()
  await expect(ctaButton).toBeVisible({ timeout: 10_000 })
  await ctaButton.click()

  await expect(page).toHaveURL(new RegExp(`/confirm-purchase/${COURSE_ID}`), { timeout: 10_000 })
})

// 4b: Pending order banner visible on course detail page
test('Pending order banner is visible on course detail when learner has pending order', async ({ page }) => {
  await setAuthState(page, mockLearner)
  await mountSupabaseMocks(page, { user: mockLearner, isEnrolled: false, hasPendingOrder: true })

  await page.goto(`/courses/${COURSE_ID}?pendingOrder=true`)

  await expect(page.getByTestId('pending-order-banner')).toBeVisible({ timeout: 10_000 })
})

// 4c: Enrolled learner (admin confirmed payment) can open paid lesson
test('Enrolled learner can access paid lesson after admin confirms payment', async ({ page }) => {
  await setAuthState(page, mockLearner)
  await mountSupabaseMocks(page, { user: mockLearner, isEnrolled: true, hasPendingOrder: false })

  await page.goto(`/learn/${COURSE_ID}/${PAID_LESSON_ID}`)

  // Must NOT redirect to paywall
  await expect(page).not.toHaveURL(/paywall/, { timeout: 10_000 })
  await expect(page).toHaveURL(new RegExp(`/learn/${COURSE_ID}`))
})

// ── Test 6: Admin watermark + write skip ─────────────────────────────────────
test('Admin user can access paid lesson, sees watermark, and writes no lesson progress', async ({ page }) => {
  await setAuthState(page, mockAdmin)
  await mountSupabaseMocks(page, { user: mockAdmin, isEnrolled: false, hasPendingOrder: false })

  // Track any lesson_progress POST calls — admin write-skip means none should fire
  const progressWrites: string[] = []
  await page.route('**/rest/v1/lesson_progress**', async route => {
    if (route.request().method() === 'POST' || route.request().method() === 'PATCH') {
      progressWrites.push(route.request().url())
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })

  await page.goto(`/learn/${COURSE_ID}/${PAID_LESSON_ID}`)

  // Admin must NOT be redirected to paywall
  await expect(page).not.toHaveURL(/paywall/, { timeout: 10_000 })
  await expect(page).toHaveURL(new RegExp(`/learn/${COURSE_ID}`))

  // Admin-preview watermark must be visible
  await expect(page.getByTestId('admin-watermark')).toBeVisible({ timeout: 10_000 })

  // Give the page 2s to settle — no progress-write should have been made (write-skip guard)
  await page.waitForTimeout(2000)
  expect(progressWrites).toHaveLength(0)
})
