import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import CourseTagsSelect from './CourseTagsSelect'
import type { CreatorTag } from '../lib/creatorTagsApi'

const { mockListCreatorTags, mockCreateCreatorTag } = vi.hoisted(() => ({
  mockListCreatorTags: vi.fn(),
  mockCreateCreatorTag: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/creatorTagsApi', () => ({
  listCreatorTags: mockListCreatorTags,
  createCreatorTag: mockCreateCreatorTag,
  deleteCreatorTag: vi.fn(),
  normalizeTagName: (raw: string) => raw.trim().slice(0, 300),
  MAX_TAG_LENGTH: 300,
}))

function makeTag(name: string): CreatorTag {
  return {
    id: 't-' + name,
    creator_id: 'u1',
    tag_name: name,
    created_at: '2026-01-01T00:00:00Z',
  }
}

function renderSelect(props: Partial<React.ComponentProps<typeof CourseTagsSelect>> = {}) {
  const onChange = vi.fn()
  const utils = render(
    <I18nextProvider i18n={i18n}>
      <CourseTagsSelect creatorId="u1" value={[]} onChange={onChange} {...props} />
    </I18nextProvider>
  )
  return { ...utils, onChange }
}

describe('CourseTagsSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListCreatorTags.mockResolvedValue({ tags: [], error: null })
    mockCreateCreatorTag.mockImplementation((_c: unknown, creatorId: string, name: string) =>
      Promise.resolve({ tag: makeTag(name), error: null })
    )
  })

  it('loads creator tags on mount', async () => {
    renderSelect()
    await waitFor(() => {
      expect(mockListCreatorTags).toHaveBeenCalledWith(expect.anything(), 'u1')
    })
  })

  it('shows all popular tags in the dropdown', async () => {
    renderSelect()
    await waitFor(() => expect(mockListCreatorTags).toHaveBeenCalled())
    const select = screen.getByTestId('popular-tag-select')
    const options = select.querySelectorAll('option')
    // placeholder + 5 popular tags
    expect(options.length).toBe(6)
    expect(options[1].textContent).toBe('Khai cuộc')
  })

  it('selecting a popular tag emits it as first element', async () => {
    const { onChange } = renderSelect()
    await waitFor(() => expect(mockListCreatorTags).toHaveBeenCalled())
    const select = screen.getByTestId('popular-tag-select')
    await userEvent.selectOptions(select, 'openings')
    expect(onChange).toHaveBeenCalledWith(['openings'])
  })

  it('changing popular tag replaces the previous one', async () => {
    const { onChange } = renderSelect({ value: ['openings', 'Najdorf'] })
    await waitFor(() => expect(mockListCreatorTags).toHaveBeenCalled())
    const select = screen.getByTestId('popular-tag-select')
    expect(select).toHaveValue('openings')
    await userEvent.selectOptions(select, 'tactics')
    expect(onChange).toHaveBeenCalledWith(['tactics', 'Najdorf'])
  })

  it('shows selected popular tag as the select value, not as a chip', async () => {
    renderSelect({ value: ['openings'] })
    await waitFor(() => expect(mockListCreatorTags).toHaveBeenCalled())
    const select = screen.getByTestId('popular-tag-select') as HTMLSelectElement
    expect(select.value).toBe('openings')
    expect(screen.queryByTestId('selected-tags')).not.toBeInTheDocument()
  })

  it('typing a custom tag and pressing Enter creates and emits it', async () => {
    const { onChange } = renderSelect()
    await waitFor(() => expect(mockListCreatorTags).toHaveBeenCalled())
    const input = screen.getByTestId('custom-tag-input')
    await userEvent.type(input, 'Najdorf{Enter}')
    await waitFor(() => {
      expect(mockCreateCreatorTag).toHaveBeenCalledWith(expect.anything(), 'u1', 'Najdorf')
    })
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(['Najdorf'])
    })
  })

  it('clicking Add button creates the custom tag', async () => {
    const { onChange } = renderSelect()
    await waitFor(() => expect(mockListCreatorTags).toHaveBeenCalled())
    const input = screen.getByTestId('custom-tag-input')
    await userEvent.type(input, 'Sicilian')
    const addBtn = screen.getByTestId('add-custom-tag-btn')
    await userEvent.click(addBtn)
    await waitFor(() => {
      expect(mockCreateCreatorTag).toHaveBeenCalledWith(expect.anything(), 'u1', 'Sicilian')
    })
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(['Sicilian'])
    })
  })

  it('renders custom tags as chips (not popular tags)', async () => {
    renderSelect({ value: ['openings', 'custom-tag'] })
    await waitFor(() => expect(mockListCreatorTags).toHaveBeenCalled())
    const chips = screen.getByTestId('selected-tags')
    expect(chips).toHaveTextContent('custom-tag')
    expect(chips).not.toHaveTextContent('Khai cuộc')
  })

  it('removes a custom tag when clicking the × button', async () => {
    const { onChange } = renderSelect({ value: ['openings', 'Najdorf', 'Sicilian'] })
    await waitFor(() => expect(mockListCreatorTags).toHaveBeenCalled())
    const removeBtn = screen.getByLabelText('Remove Najdorf')
    await userEvent.click(removeBtn)
    expect(onChange).toHaveBeenCalledWith(['openings', 'Sicilian'])
  })

  it('enforces 300 char max on custom input', async () => {
    renderSelect()
    await waitFor(() => expect(mockListCreatorTags).toHaveBeenCalled())
    const input = screen.getByTestId('custom-tag-input') as HTMLInputElement
    expect(input.maxLength).toBe(300)
  })
})
