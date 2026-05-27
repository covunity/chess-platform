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
vi.mock('../../lib/creatorTagsApi', () => ({
  listCreatorTags: vi.fn(() => Promise.resolve({ tags: [], error: null })),
  createCreatorTag: vi.fn((_c: unknown, creatorId: string, name: string) =>
    Promise.resolve({
      tag: { id: 't-' + name, creator_id: creatorId, tag_name: name, created_at: '2026-01-01T00:00:00Z' },
      error: null,
    })
  ),
  deleteCreatorTag: vi.fn(() => Promise.resolve({ error: null })),
  normalizeTagName: (raw: string) => raw.trim().slice(0, 50),
  MAX_TAG_LENGTH: 50,
}))
vi.mock('react-router-dom', async (importOriginal) => {
  const mod = await importOriginal<typeof import('react-router-dom')>()
  return { ...mod, useNavigate: () => mockNavigate }
})

const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))

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
  computeFeeFloor: (price: number, pct: number) => Math.floor((price * pct) / 100),
}))

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
    mockUseAuth.mockReturnValue({ profile: { id: 'u1', role: 'creator', account_tier_id: 'individual' } })
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

  it('renders tags select component', () => {
    renderPage()
    expect(screen.getByTestId('course-tags-select')).toBeInTheDocument()
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

  it('selects a popular tag from the dropdown', async () => {
    renderPage()
    const select = await screen.findByTestId('popular-tag-select')
    await waitFor(() => {
      expect(select).not.toBeDisabled()
    })
    await userEvent.selectOptions(select, 'openings')
    await waitFor(() => {
      expect(screen.getByTestId('selected-tags')).toHaveTextContent('Khai cuộc')
    })
  })

  it('navigates back on cancel', async () => {
    renderPage()
    await userEvent.click(screen.getByTestId('cancel-btn'))
    expect(mockNavigate).toHaveBeenCalledWith(-1)
  })

  it('shows free fee preview when price is 0', async () => {
    renderPage()
    // default price is 0
    await waitFor(() => {
      expect(screen.getByTestId('fee-preview')).toBeInTheDocument()
      expect(screen.getByTestId('fee-preview')).toHaveTextContent(/miễn phí/i)
    })
  })

  it('shows paid fee preview with correct amounts when price is set', async () => {
    renderPage()
    const priceInput = screen.getByTestId('course-price-input')
    await userEvent.clear(priceInput)
    await userEvent.type(priceInput, '100000')
    await waitFor(() => {
      const preview = screen.getByTestId('fee-preview')
      // 20% of 100000 = 20000 fee, 80000 payout
      expect(preview).toHaveTextContent('20%')
      expect(preview).toHaveTextContent('20.000')
      expect(preview).toHaveTextContent('80.000')
    })
  })

  it('fee preview updates in real-time as price changes', async () => {
    renderPage()
    const priceInput = screen.getByTestId('course-price-input')

    await userEvent.clear(priceInput)
    await userEvent.type(priceInput, '200000')
    await waitFor(() => {
      const preview = screen.getByTestId('fee-preview')
      // 20% of 200000 = 40000 fee, 160000 payout
      expect(preview).toHaveTextContent('40.000')
    })
  })
})
