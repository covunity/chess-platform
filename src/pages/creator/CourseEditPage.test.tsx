import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import CourseEditPage from './CourseEditPage'

const {
  mockListChapters,
  mockCreateChapter,
  mockUpdateChapter,
  mockDeleteChapter,
  mockReorderChapters,
  mockCreateLesson,
  mockUpdateLesson,
  mockDeleteLesson,
  mockReorderLessons,
  mockCanPublishCourse,
  mockPublishCourse,
  mockUnpublishCourse,
} = vi.hoisted(() => ({
  mockListChapters: vi.fn(),
  mockCreateChapter: vi.fn(),
  mockUpdateChapter: vi.fn(),
  mockDeleteChapter: vi.fn(),
  mockReorderChapters: vi.fn(),
  mockCreateLesson: vi.fn(),
  mockUpdateLesson: vi.fn(),
  mockDeleteLesson: vi.fn(),
  mockReorderLessons: vi.fn(),
  mockCanPublishCourse: vi.fn(),
  mockPublishCourse: vi.fn(),
  mockUnpublishCourse: vi.fn(),
}))

vi.mock('../../lib/creatorApi', () => ({
  listChapters: mockListChapters,
  createChapter: mockCreateChapter,
  updateChapter: mockUpdateChapter,
  deleteChapter: mockDeleteChapter,
  reorderChapters: mockReorderChapters,
  createLesson: mockCreateLesson,
  updateLesson: mockUpdateLesson,
  deleteLesson: mockDeleteLesson,
  reorderLessons: mockReorderLessons,
  canPublishCourse: mockCanPublishCourse,
  publishCourse: mockPublishCourse,
  unpublishCourse: mockUnpublishCourse,
}))

function makeSupabaseChain(data: unknown) {
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'eq', 'single', 'update', 'insert', 'delete', 'order', 'in']
  methods.forEach(m => { chain[m] = vi.fn(() => chain) })
  ;(chain as { then: (r: (v: unknown) => unknown) => Promise<unknown> }).then = (resolve) =>
    Promise.resolve(resolve(data))
  return chain
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => makeSupabaseChain({ data: { status: 'draft' }, error: null })),
  },
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    profile: { id: 'u1', email: 'creator@test.com', name: 'Creator', role: 'creator', account_tier_id: 'individual', created_at: '' },
    user: null,
    loading: false,
    profileLoading: false,
  })),
}))

vi.mock('../../lib/accountTiers', () => ({
  useAccountTiers: vi.fn(() => ({
    tiers: [
      { code: 'individual', name_vi: 'Cá nhân', platform_fee_pct: 20, max_chapters_per_course: 10, is_enterprise: false, requires_approval: true, display_order: 1 },
    ],
    loading: false,
    getTier: (code: string) => code === 'individual'
      ? { code: 'individual', name_vi: 'Cá nhân', platform_fee_pct: 20, max_chapters_per_course: 10, is_enterprise: false, requires_approval: true, display_order: 1 }
      : undefined,
  })),
}))

const mockChapters = [
  {
    id: 'ch1',
    course_id: 'c1',
    title: 'Introduction',
    position: 0,
    created_at: '',
    lessons: [
      { id: 'l1', chapter_id: 'ch1', title: 'Welcome Video', type: 'video', position: 0, free_preview: true, created_at: '' },
      { id: 'l2', chapter_id: 'ch1', title: 'Chess Board Setup', type: 'chess', position: 1, free_preview: false, created_at: '' },
    ],
  },
  {
    id: 'ch2',
    course_id: 'c1',
    title: 'Basic Tactics',
    position: 1,
    created_at: '',
    lessons: [],
  },
]

function renderPage(courseId = 'c1') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/creator/courses/${courseId}/edit`]}>
        <Routes>
          <Route path="/creator/courses/:courseId/edit" element={<CourseEditPage />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('CourseEditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListChapters.mockResolvedValue({ chapters: mockChapters, error: null })
    mockCreateChapter.mockResolvedValue({ chapter: { id: 'ch3', course_id: 'c1', title: 'New Chapter', position: 2, created_at: '' }, error: null })
    mockUpdateChapter.mockResolvedValue({ chapter: { ...mockChapters[0], title: 'Renamed' }, error: null })
    mockDeleteChapter.mockResolvedValue({ error: null })
    mockReorderChapters.mockResolvedValue({ error: null })
    mockCreateLesson.mockResolvedValue({ lesson: { id: 'l3', chapter_id: 'ch1', title: 'New Lesson', type: 'video', position: 2, free_preview: false, created_at: '' }, error: null })
    mockCanPublishCourse.mockResolvedValue({ ready: false, reasons: ['no_lessons'] })
    mockPublishCourse.mockResolvedValue({ course: null, error: null })
    mockUnpublishCourse.mockResolvedValue({ course: null, error: null })
    mockUpdateLesson.mockResolvedValue({ lesson: null, error: null })
    mockDeleteLesson.mockResolvedValue({ error: null })
    mockReorderLessons.mockResolvedValue({ error: null })
  })

  it('shows CURRICULUM eyebrow in sidebar', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('curriculum-sidebar')).toBeInTheDocument())
  })

  it('renders chapter titles after loading', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Introduction')).toBeInTheDocument()
      expect(screen.getByText('Basic Tactics')).toBeInTheDocument()
    })
  })

  it('renders lesson titles under chapters', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Welcome Video')).toBeInTheDocument()
      expect(screen.getByText('Chess Board Setup')).toBeInTheDocument()
    })
  })

  it('calls createChapter when "+ Add chapter" is clicked', async () => {
    renderPage()
    await waitFor(() => screen.getByText('Introduction'))

    await userEvent.click(screen.getByTestId('add-chapter-btn'))

    await waitFor(() => {
      expect(mockCreateChapter).toHaveBeenCalledWith(
        expect.anything(),
        'c1',
        expect.objectContaining({ title: expect.any(String) })
      )
    })
  })

  it('calls deleteChapter when delete chapter button clicked and confirmed', async () => {
    renderPage()
    await waitFor(() => screen.getByText('Introduction'))

    await userEvent.click(screen.getByTestId('delete-chapter-ch1'))
    await waitFor(() => screen.getByTestId('confirm-delete-chapter-dialog'))
    await userEvent.click(screen.getByTestId('confirm-delete-chapter-btn'))

    await waitFor(() => {
      expect(mockDeleteChapter).toHaveBeenCalledWith(expect.anything(), 'ch1')
    })
  })

  it('opens new lesson dialog and calls createLesson on confirm', async () => {
    renderPage()
    await waitFor(() => screen.getByText('Introduction'))

    await userEvent.click(screen.getByTestId('add-lesson-ch1'))

    const dialog = await waitFor(() => screen.getByTestId('new-lesson-dialog'))
    expect(dialog).toBeInTheDocument()

    await userEvent.type(screen.getByTestId('new-lesson-title'), 'My Lesson')
    await userEvent.click(screen.getByTestId('lesson-type-chess'))
    await userEvent.click(screen.getByTestId('new-lesson-create-btn'))

    await waitFor(() => {
      expect(mockCreateLesson).toHaveBeenCalledWith(
        expect.anything(),
        'ch1',
        expect.objectContaining({ title: 'My Lesson', type: 'chess' })
      )
    })
  })

  it('calls deleteLesson when delete lesson button clicked and confirmed', async () => {
    renderPage()
    await waitFor(() => screen.getByText('Welcome Video'))

    await userEvent.click(screen.getByTestId('delete-lesson-l1'))
    await waitFor(() => screen.getByTestId('confirm-delete-lesson-dialog'))
    await userEvent.click(screen.getByTestId('confirm-delete-lesson-btn'))

    await waitFor(() => {
      expect(mockDeleteLesson).toHaveBeenCalledWith(expect.anything(), 'l1')
    })
  })

  it('shows free-preview toggle per lesson', async () => {
    renderPage()
    await waitFor(() => screen.getByTestId('free-preview-l1'))
    expect(screen.getByTestId('free-preview-l1')).toBeInTheDocument()
  })

  it('shows chapter counter with current/max', async () => {
    renderPage()
    await waitFor(() => screen.getByText('Introduction'))
    const counter = screen.getByTestId('chapter-counter')
    // 2 mock chapters, max 10 from mocked individual tier
    expect(counter).toHaveTextContent('2/10')
  })

  it('add-chapter button is enabled when below tier limit', async () => {
    renderPage()
    await waitFor(() => screen.getByTestId('add-chapter-btn'))
    expect(screen.getByTestId('add-chapter-btn')).not.toBeDisabled()
  })

  it('add-chapter button is disabled at tier limit', async () => {
    // Override mockChapters to have 10 chapters (individual tier max)
    const tenChapters = Array.from({ length: 10 }, (_, i) => ({
      id: `ch${i + 1}`,
      course_id: 'c1',
      title: `Chapter ${i + 1}`,
      position: i,
      created_at: '',
      lessons: [],
    }))
    mockListChapters.mockResolvedValueOnce({ chapters: tenChapters, error: null })

    renderPage()
    await waitFor(() => screen.getByTestId('add-chapter-btn'))
    expect(screen.getByTestId('add-chapter-btn')).toBeDisabled()
  })
})
