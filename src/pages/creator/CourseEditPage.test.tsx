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
}))

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

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

  it('calls createLesson when "+ Add lesson" is clicked in a chapter', async () => {
    renderPage()
    await waitFor(() => screen.getByText('Introduction'))

    await userEvent.click(screen.getByTestId('add-lesson-ch1'))

    await waitFor(() => {
      expect(mockCreateLesson).toHaveBeenCalledWith(
        expect.anything(),
        'ch1',
        expect.objectContaining({ title: expect.any(String), type: 'video' })
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
})
