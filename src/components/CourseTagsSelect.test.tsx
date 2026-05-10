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
  normalizeTagName: (raw: string) => raw.trim().slice(0, 50),
  MAX_TAG_LENGTH: 50,
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

async function openMenu() {
  const container = screen.getByTestId('course-tags-select')
  const input = container.querySelector('input') as HTMLInputElement
  await userEvent.click(input)
  return { container, input }
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

  it('shows popular tags group with translated labels', async () => {
    renderSelect()
    await waitFor(() => expect(mockListCreatorTags).toHaveBeenCalled())
    await openMenu()
    expect(await screen.findByText('Khai cuộc')).toBeInTheDocument()
    expect(screen.getByText('Chiến thuật')).toBeInTheDocument()
  })

  it('selecting a popular tag emits its key value', async () => {
    const { onChange } = renderSelect()
    await waitFor(() => expect(mockListCreatorTags).toHaveBeenCalled())
    await openMenu()
    const opt = await screen.findByText('Khai cuộc')
    await userEvent.click(opt)
    expect(onChange).toHaveBeenCalledWith(['openings'])
  })

  it('lists creator-saved tags in their own group', async () => {
    mockListCreatorTags.mockResolvedValue({ tags: [makeTag('Sicilian')], error: null })
    renderSelect()
    await openMenu()
    expect(await screen.findByText('Sicilian')).toBeInTheDocument()
  })

  it('typing a new tag and selecting create persists and emits the new tag', async () => {
    const { onChange } = renderSelect()
    await waitFor(() => expect(mockListCreatorTags).toHaveBeenCalled())
    const { input } = await openMenu()
    await userEvent.type(input, 'Najdorf')
    const createOption = await screen.findByText(/Tạo thẻ "Najdorf"/i)
    await userEvent.click(createOption)
    await waitFor(() => {
      expect(mockCreateCreatorTag).toHaveBeenCalledWith(expect.anything(), 'u1', 'Najdorf')
    })
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(['Najdorf'])
    })
  })

  it('does not re-create a popular tag when typed verbatim — selects it instead', async () => {
    const { onChange } = renderSelect()
    await waitFor(() => expect(mockListCreatorTags).toHaveBeenCalled())
    const { input } = await openMenu()
    await userEvent.type(input, 'openings')
    // popular options match by label, not key, so typing the key still shows the create-option;
    // when picked, our handler short-circuits and does NOT call createCreatorTag.
    const createOption = await screen.findByText(/Tạo thẻ "openings"/i)
    await userEvent.click(createOption)
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(['openings'])
    })
    expect(mockCreateCreatorTag).not.toHaveBeenCalled()
  })

  it('renders existing selected values as chips', async () => {
    renderSelect({ value: ['openings', 'custom-tag'] })
    await waitFor(() => expect(mockListCreatorTags).toHaveBeenCalled())
    expect(screen.getByText('Khai cuộc')).toBeInTheDocument()
    expect(screen.getByText('custom-tag')).toBeInTheDocument()
  })
})
