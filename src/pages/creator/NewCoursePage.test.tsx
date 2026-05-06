import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import NewCoursePage from './NewCoursePage'

const { mockCreateCourse, mockNavigate } = vi.hoisted(() => ({
  mockCreateCourse: vi.fn(),
  mockNavigate: vi.fn(),
}))

vi.mock('../../lib/creatorApi', () => ({ createCourse: mockCreateCourse }))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('react-router-dom', async (importOriginal) => {
  const mod = await importOriginal<typeof import('react-router-dom')>()
  return { ...mod, useNavigate: () => mockNavigate }
})

const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <NewCoursePage />
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('NewCoursePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({ profile: { id: 'u1', role: 'coach' } })
    mockCreateCourse.mockResolvedValue({ course: { id: 'c-new', title: 'Test' }, error: null })
  })

  it('renders title input', () => {
    renderPage()
    expect(screen.getByTestId('course-title-input')).toBeInTheDocument()
  })

  it('renders description textarea', () => {
    renderPage()
    expect(screen.getByTestId('course-description-input')).toBeInTheDocument()
  })

  it('renders price input', () => {
    renderPage()
    expect(screen.getByTestId('course-price-input')).toBeInTheDocument()
  })

  it('renders level select', () => {
    renderPage()
    expect(screen.getByTestId('course-level-select')).toBeInTheDocument()
  })

  it('renders language select', () => {
    renderPage()
    expect(screen.getByTestId('course-language-select')).toBeInTheDocument()
  })

  it('renders tags input', () => {
    renderPage()
    expect(screen.getByTestId('course-tags-input')).toBeInTheDocument()
  })

  it('renders thumbnail uploader zone', () => {
    renderPage()
    expect(screen.getByTestId('thumbnail-upload-zone')).toBeInTheDocument()
  })

  it('shows validation error when submitting with empty title', async () => {
    renderPage()
    await userEvent.click(screen.getByTestId('submit-course-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('title-error')).toBeInTheDocument()
    })
  })

  it('calls createCourse and navigates on valid submit', async () => {
    renderPage()

    await userEvent.type(screen.getByTestId('course-title-input'), 'My New Course')
    await userEvent.click(screen.getByTestId('submit-course-btn'))

    await waitFor(() => {
      expect(mockCreateCourse).toHaveBeenCalledWith(
        expect.anything(),
        'u1',
        expect.objectContaining({ title: 'My New Course' })
      )
    })
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/creator/courses/c-new/edit')
    })
  })

  it('shows validation error for title exceeding 200 chars', async () => {
    renderPage()
    const longTitle = 'a'.repeat(201)
    await userEvent.type(screen.getByTestId('course-title-input'), longTitle)
    await userEvent.click(screen.getByTestId('submit-course-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('title-error')).toBeInTheDocument()
    })
  })

  it('adds tag chips when comma-separated input provided', async () => {
    renderPage()
    const tagsInput = screen.getByTestId('course-tags-input')
    await userEvent.type(tagsInput, 'tactics,endgame')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => {
      expect(screen.getByText('tactics')).toBeInTheDocument()
      expect(screen.getByText('endgame')).toBeInTheDocument()
    })
  })

  it('navigates back on cancel', async () => {
    renderPage()
    await userEvent.click(screen.getByTestId('cancel-btn'))
    expect(mockNavigate).toHaveBeenCalledWith(-1)
  })
})
