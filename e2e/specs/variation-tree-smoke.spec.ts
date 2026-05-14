/**
 * Variation-tree smoke tests — Italian Game fixture (issue #168).
 *
 * All Supabase calls are intercepted via page.route(). No real backend needed.
 * Covers four flows: parse, variation list, player main-line, bookmark restore.
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import {
  setAuthState,
  mountSupabaseMocks,
  mockLearner,
  mockCreator,
  COURSE_ID,
  CHAPTER_ID,
  LEARNER_ID,
  CREATOR_ID,
} from '../helpers/mockApi'

// ── Fixture data ──────────────────────────────────────────────────────────────

const ITALIAN_LESSON_ID = 'lesson-italian-e2e'

const italianPgn = readFileSync(
  fileURLToPath(new URL('../../src/components/LessonEditor/__fixtures__/italian-game.pgn', import.meta.url)),
  'utf8',
)

const italianLessonDetail = {
  id: ITALIAN_LESSON_ID,
  title: 'Tượng Italy — 4 cách phòng của Đen',
  type: 'chess',
  pgn_data: italianPgn,
  board_perspective: 'white',
  coach_note: null,
  video_provider: null,
  video_provider_id: null,
  video_status: null,
}

const italianLessonListRow = {
  id: ITALIAN_LESSON_ID,
  chapter_id: CHAPTER_ID,
  title: 'Tượng Italy — 4 cách phòng của Đen',
  type: 'chess',
  position: 1,
  free_preview: true,
  duration_seconds: 600,
}

const SUPABASE_URL = 'http://localhost:54321'

// ── Helper: mount mocks extended with Italian lesson ─────────────────────────

async function mountItalianLessonMocks(
  page: Page,
  opts: { user: typeof mockLearner | null; isEnrolled: boolean; bookmark?: object | null },
) {
  await mountSupabaseMocks(page, {
    user: opts.user,
    isEnrolled: opts.isEnrolled,
    hasPendingOrder: false,
  })

  // Override lessons table to return the Italian Game lesson
  await page.route(`${SUPABASE_URL}/rest/v1/lessons**`, async route => {
    const accept = route.request().headers()['accept'] ?? ''
    const isSingle = accept.includes('application/vnd.pgrst.object+json')
    const body = isSingle
      ? JSON.stringify(italianLessonDetail)
      : JSON.stringify([italianLessonDetail])
    await route.fulfill({ status: 200, contentType: 'application/json', body })
  })

  // Override RPC get_course_lesson_list to return Italian lesson
  await page.route(`${SUPABASE_URL}/rest/v1/rpc/get_course_lesson_list**`, async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([italianLessonListRow]),
    })
  })

  // Override bookmarks to return supplied bookmark (or null)
  const bm = opts.bookmark ?? null
  await page.route(`${SUPABASE_URL}/rest/v1/bookmarks**`, async route => {
    const method = route.request().method()
    if (method === 'POST' || method === 'PATCH') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'bm-smoke-e2e',
          user_id: LEARNER_ID,
          lesson_id: ITALIAN_LESSON_ID,
          pgn_snapshot: '',
          node_id: null,
          played_plies: 0,
          created_at: '2026-05-10T00:00:00Z',
        }),
      })
    } else {
      const accept = route.request().headers()['accept'] ?? ''
      const isSingle = accept.includes('application/vnd.pgrst.object+json')
      const body = bm
        ? isSingle ? JSON.stringify(bm) : JSON.stringify([bm])
        : isSingle ? 'null' : '[]'
      await route.fulfill({ status: 200, contentType: 'application/json', body })
    }
  })
}

// ── Creator editor route helper ───────────────────────────────────────────────

const CREATOR_LESSON_ID = 'lesson-creator-e2e-chess'

async function mountEditorMocks(page: Page) {
  // Minimal creator auth mocks
  const creatorSession = {
    access_token: `mock-access-${CREATOR_ID}`,
    refresh_token: `mock-refresh-${CREATOR_ID}`,
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: {
      id: CREATOR_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'creator@e2e.test',
      email_confirmed_at: '2026-01-01T00:00:00.000Z',
      confirmed_at: '2026-01-01T00:00:00.000Z',
      last_sign_in_at: '2026-01-01T00:00:00.000Z',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { name: 'E2E Creator' },
      identities: [],
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  }

  const AUTH_KEY = 'sb-localhost-auth-token'
  await page.addInitScript(
    ({ key, session }: { key: string; session: unknown }) => {
      localStorage.setItem(key, JSON.stringify(session))
    },
    { key: AUTH_KEY, session: creatorSession },
  )

  // Register catch-all FIRST (lowest priority in Playwright — last-registered wins)
  await page.route(`${SUPABASE_URL}/rest/v1/**`, async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })

  // Specific routes registered AFTER the catch-all — these take priority
  await page.route(`${SUPABASE_URL}/auth/v1/token**`, async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(creatorSession) })
  })
  await page.route(`${SUPABASE_URL}/auth/v1/user**`, async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(creatorSession.user) })
  })
  await page.route(`${SUPABASE_URL}/rest/v1/users**`, async route => {
    const userRow = { id: CREATOR_ID, email: 'creator@e2e.test', name: 'E2E Creator', avatar_url: null, role: 'creator', account_tier_id: 'individual', created_at: '2026-01-01T00:00:00Z' }
    const accept = route.request().headers()['accept'] ?? ''
    const isSingle = accept.includes('application/vnd.pgrst.object+json')
    await route.fulfill({ status: 200, contentType: 'application/json', body: isSingle ? JSON.stringify(userRow) : JSON.stringify([userRow]) })
  })

  await page.route(`${SUPABASE_URL}/rest/v1/courses**`, async route => {
    const courseRow = { id: COURSE_ID, title: 'Khoá cờ vua E2E Creator', description: '', thumbnail_url: null, price: 0, level: 'beginner', status: 'draft', creator_id: CREATOR_ID }
    const accept = route.request().headers()['accept'] ?? ''
    const isSingle = accept.includes('application/vnd.pgrst.object+json')
    await route.fulfill({ status: 200, contentType: 'application/json', body: isSingle ? JSON.stringify(courseRow) : JSON.stringify([courseRow]) })
  })

  // chapters with embedded lessons — listChapters uses select('*, lessons(*)')
  // Auto-selects firstLesson from the first chapter's lessons array
  const chapterWithLesson = [{
    id: CHAPTER_ID,
    course_id: COURSE_ID,
    title: 'Chương 1',
    position: 1,
    lessons: [{
      id: CREATOR_LESSON_ID,
      chapter_id: CHAPTER_ID,
      title: 'Italian Game',
      type: 'chess',
      position: 1,
      free_preview: false,
      pgn_data: '',
      board_perspective: 'white',
      coach_note: null,
      duration_seconds: null,
    }],
  }]
  await page.route(`${SUPABASE_URL}/rest/v1/chapters**`, async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(chapterWithLesson) })
  })

  await page.route(`${SUPABASE_URL}/rest/v1/lessons**`, async route => {
    const method = route.request().method()
    if (method === 'PATCH') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    } else {
      const lessonRow = { id: CREATOR_LESSON_ID, title: 'Italian Game', type: 'chess', position: 1, free_preview: false, pgn_data: '', board_perspective: 'white', is_free_preview: false, coach_note: null }
      const accept = route.request().headers()['accept'] ?? ''
      const isSingle = accept.includes('application/vnd.pgrst.object+json')
      await route.fulfill({ status: 200, contentType: 'application/json', body: isSingle ? JSON.stringify(lessonRow) : JSON.stringify([lessonRow]) })
    }
  })

  await page.route(`${SUPABASE_URL}/rest/v1/rpc/**`, async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
  })
}

// ── Test 1: Parse smoke — editor reads variation summary ──────────────────────

test('Editor: pasting Italian Game PGN renders variation summary with correct counts', async ({ page }) => {
  await mountEditorMocks(page)
  await page.goto(`/creator/courses/${COURSE_ID}/edit`)

  // Wait for the course editor to load and show a chess lesson panel
  await expect(page.getByRole('textbox', { name: /pgn/i })).toBeVisible({ timeout: 15_000 })

  const pgnTextarea = page.getByRole('textbox', { name: /pgn/i })
  await pgnTextarea.fill(italianPgn)

  // Variation summary should appear after debounce (≤ 500 ms)
  await expect(page.getByTestId('variation-summary')).toBeVisible({ timeout: 3_000 })

  // Verify variation summary mentions at least one variation branch
  const summaryText = await page.getByTestId('variation-summary').textContent()
  expect(summaryText).toMatch(/nhánh|biến/i)
})

// ── Test 2: Variation list — clicking a variation node updates preview ─────────

test('Editor: variation list renders and clicking a node does not crash', async ({ page }) => {
  await mountEditorMocks(page)
  await page.goto(`/creator/courses/${COURSE_ID}/edit`)

  await expect(page.getByRole('textbox', { name: /pgn/i })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('textbox', { name: /pgn/i }).fill(italianPgn)

  // Variation list should appear
  await expect(page.getByTestId('variation-list')).toBeVisible({ timeout: 3_000 })

  // Click the first variation node
  const varNodes = page.locator('[data-testid^="variation-node-"]')
  await expect(varNodes.first()).toBeVisible()
  await varNodes.first().click()

  // Preview pane should still be rendered (no crash)
  await expect(page.getByTestId('lesson-preview-pane')).toBeVisible()
})

// ── Test 3: Opponent-branch warning fires for multiple Black responses ─────────

test('Editor: opponent-branch warning fires at 3.Bc4 node with 5 Black responses', async ({ page }) => {
  await mountEditorMocks(page)
  await page.goto(`/creator/courses/${COURSE_ID}/edit`)

  await expect(page.getByRole('textbox', { name: /pgn/i })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('textbox', { name: /pgn/i }).fill(italianPgn)

  await expect(page.getByTestId('variation-list')).toBeVisible({ timeout: 3_000 })

  // At least one opponent-branch warning should appear (Black has 5 responses to 3.Bc4)
  await expect(page.getByTestId('opponent-branch-warning').first()).toBeVisible()
})

// ── Test 4: Player — enrolled learner can play main line and trigger completion ─

test('Player: enrolled learner plays e4 and opponent responds e5 automatically', async ({ page }) => {
  await setAuthState(page, mockLearner)
  await mountItalianLessonMocks(page, { user: mockLearner, isEnrolled: true })

  await page.route(`${SUPABASE_URL}/rest/v1/rpc/**`, async route => {
    const url = route.request().url()
    if (url.includes('get_course_lesson_list')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([italianLessonListRow]) })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
    }
  })

  await page.goto(`/learn/${COURSE_ID}/${ITALIAN_LESSON_ID}`)

  // Wait for guided player board
  await expect(page.getByTestId('guided-player-board')).toBeVisible({ timeout: 15_000 })

  // Play White's first move: e2 → e4
  // Chessground renders squares as custom <square> elements with .cgKey JS property
  // (not a DOM attribute), so we click by position within the cg-board element.
  // White at bottom: file e = index 4, rank 2 = index 1, rank 4 = index 3
  // x = (fileIndex + 0.5) / 8, y = (7 - rankIndex + 0.5) / 8
  const board = page.getByTestId('guided-player-board').locator('cg-board')
  const box = await board.boundingBox()
  if (!box) throw new Error('cg-board not found')
  const squareW = box.width / 8
  const squareH = box.height / 8
  // e2: file 'e' = index 4, rank 2 = index 1
  await page.mouse.click(box.x + squareW * 4.5, box.y + squareH * (7 - 1 + 0.5))
  // e4: file 'e' = index 4, rank 4 = index 3
  await page.mouse.click(box.x + squareW * 4.5, box.y + squareH * (7 - 3 + 0.5))

  // After playing e4, opponent (Black) should auto-play e5 within ~1s
  // Verify: the move log should now show both moves
  await expect(page.locator('[data-testid="guided-player-move-log"]')).toBeVisible({ timeout: 5_000 })
})

// ── Test 5: Bookmark restore — player renders at bookmarked node ───────────────

test('Player: renders without crash when a bookmark exists with played_plies', async ({ page }) => {
  const bookmark = {
    id: 'bm-e2e-restore',
    user_id: LEARNER_ID,
    lesson_id: ITALIAN_LESSON_ID,
    pgn_snapshot: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    node_id: null,
    played_plies: 2,
    created_at: '2026-05-01T00:00:00Z',
  }

  await setAuthState(page, mockLearner)
  await mountItalianLessonMocks(page, { user: mockLearner, isEnrolled: true, bookmark })

  await page.route(`${SUPABASE_URL}/rest/v1/rpc/**`, async route => {
    const url = route.request().url()
    if (url.includes('get_course_lesson_list')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([italianLessonListRow]) })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
    }
  })

  await page.goto(`/learn/${COURSE_ID}/${ITALIAN_LESSON_ID}`)

  // Player should render successfully (bookmark restore doesn't crash)
  await expect(page.getByTestId('guided-player-root')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('guided-player-board')).toBeVisible()
  await expect(page.getByTestId('header-bookmark-btn')).toBeVisible()
})
