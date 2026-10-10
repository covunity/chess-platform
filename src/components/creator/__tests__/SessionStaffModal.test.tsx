import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../../i18n'
import SessionStaffModal from '../SessionStaffModal'
import * as liveSessionApi from '../../../lib/liveSessionApi'
import type { LiveSession, LiveSessionStaff } from '../../../types/liveSession'

vi.mock('../../../lib/liveSessionApi', () => ({
  listLiveSessionStaff: vi.fn(),
  addLiveSessionAssistant: vi.fn(),
  removeLiveSessionAssistant: vi.fn(),
  lookupUserForAssistant: vi.fn(),
}))

describe('TASK 7 — SessionStaffModal UI & Staff Management', () => {
  const mockSession: LiveSession = {
    id: 'session-123',
    course_id: 'course-456',
    title: 'Buổi học cờ vua nâng cao',
    description: '',
    scheduled_start_at: '2026-10-10T10:00:00Z',
    scheduled_end_at: '2026-10-10T11:30:00Z',
    status: 'SCHEDULED',
    livekit_room_name: 'room-123',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  }

  const mockStaff: LiveSessionStaff[] = [
    {
      id: 'staff-1',
      liveSessionId: 'session-123',
      userId: 'user-assistant-1',
      role: 'assistant',
      createdAt: '2026-10-02T00:00:00Z',
      userEmail: 'assistant1@test.com',
      userName: 'Trợ giảng Một',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(liveSessionApi.listLiveSessionStaff).mockResolvedValue({ staff: mockStaff, error: null })
    vi.mocked(liveSessionApi.addLiveSessionAssistant).mockResolvedValue({ success: true, error: null })
    vi.mocked(liveSessionApi.removeLiveSessionAssistant).mockResolvedValue({ success: true, error: null })
    vi.mocked(liveSessionApi.lookupUserForAssistant).mockResolvedValue({
      users: [{ id: 'user-new-1', email: 'newassistant@test.com', name: 'Trợ giảng Mới' }],
      error: null,
    })
  })

  it('renders modal with session title and loads existing staff', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <SessionStaffModal
          session={mockSession}
          courseCreatorId="creator-owner"
          onClose={vi.fn()}
        />
      </I18nextProvider>
    )

    expect(screen.getByText('Quản lý Trợ giảng')).toBeInTheDocument()
    expect(screen.getByText('Buổi học cờ vua nâng cao')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Trợ giảng Một')).toBeInTheDocument()
      expect(screen.getByText('assistant1@test.com')).toBeInTheDocument()
    })
  })

  it('searches for users and adds an assistant', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <SessionStaffModal
          session={mockSession}
          courseCreatorId="creator-owner"
          onClose={vi.fn()}
        />
      </I18nextProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('Trợ giảng Một')).toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText(/Tìm theo email, tên hoặc User ID/i)
    fireEvent.change(searchInput, { target: { value: 'newassistant' } })

    await waitFor(() => {
      expect(liveSessionApi.lookupUserForAssistant).toHaveBeenCalledWith(undefined, 'newassistant')
      expect(screen.getByText('Trợ giảng Mới')).toBeInTheDocument()
    })

    const assignItem = screen.getByText('Trợ giảng Mới')
    fireEvent.click(assignItem)

    await waitFor(() => {
      expect(liveSessionApi.addLiveSessionAssistant).toHaveBeenCalledWith(undefined, 'session-123', 'user-new-1')
      expect(liveSessionApi.listLiveSessionStaff).toHaveBeenCalledTimes(2) // Initial + after add
    })
  })

  it('removes an assistant when remove button is clicked', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <SessionStaffModal
          session={mockSession}
          courseCreatorId="creator-owner"
          onClose={vi.fn()}
        />
      </I18nextProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('Trợ giảng Một')).toBeInTheDocument()
    })

    const removeBtn = screen.getByTitle('Xóa trợ giảng')
    fireEvent.click(removeBtn)

    await waitFor(() => {
      expect(liveSessionApi.removeLiveSessionAssistant).toHaveBeenCalledWith(undefined, 'session-123', 'user-assistant-1')
    })
  })

  it('filters out course creator from assistant search results', async () => {
    vi.mocked(liveSessionApi.lookupUserForAssistant).mockResolvedValue({
      users: [{ id: 'creator-owner', email: 'creator@test.com', name: 'Chủ sở hữu' }],
      error: null,
    })

    render(
      <I18nextProvider i18n={i18n}>
        <SessionStaffModal
          session={mockSession}
          courseCreatorId="creator-owner"
          onClose={vi.fn()}
        />
      </I18nextProvider>
    )

    const searchInput = screen.getByPlaceholderText(/Tìm theo email, tên hoặc User ID/i)
    fireEvent.change(searchInput, { target: { value: 'creator' } })

    await waitFor(() => {
      expect(liveSessionApi.lookupUserForAssistant).toHaveBeenCalledWith(undefined, 'creator')
    })

    // Course creator is filtered out and must NOT appear in search dropdown
    expect(screen.queryByText('Chủ sở hữu')).toBeNull()
  })

  it('disables modifications when session status is ENDED', async () => {
    const endedSession: LiveSession = {
      ...mockSession,
      status: 'ENDED',
    }

    render(
      <I18nextProvider i18n={i18n}>
        <SessionStaffModal
          session={endedSession}
          courseCreatorId="creator-owner"
          onClose={vi.fn()}
        />
      </I18nextProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('Trợ giảng Một')).toBeInTheDocument()
    })

    expect(screen.getByText(/Buổi học đã kết thúc hoặc bị hủy, không thể thay đổi danh sách trợ giảng/i)).toBeInTheDocument()

    // Search input and remove buttons must not exist
    expect(screen.queryByPlaceholderText(/Tìm theo email, tên hoặc User ID/i)).toBeNull()
    expect(screen.queryByTitle('Xóa trợ giảng')).toBeNull()
  })
})
