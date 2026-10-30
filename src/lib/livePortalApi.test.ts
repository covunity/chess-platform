import { describe, it, expect, vi } from 'vitest'
import {
  getEnrolledLiveCourses,
  getCourseAssignments,
  submitAssignment,
  getCourseChatMessages,
  sendCourseChatMessage,
  subscribeToCourseChat,
} from './livePortalApi'
import type { SupabaseClient } from '@supabase/supabase-js'

describe('livePortalApi', () => {
  it('filters only live courses from enrollments', async () => {
    const mockData = [
      {
        course_id: 'c1',
        courses: {
          id: 'c1',
          title: 'Khóa trực tuyến',
          course_type: 'live',
          price: 0,
          creator_id: 'u1',
          creator: { name: 'Thầy Dạy Cờ' },
        },
      },
      {
        course_id: 'c2',
        courses: {
          id: 'c2',
          title: 'Khóa video',
          course_type: 'standard',
          price: 100000,
          creator_id: 'u1',
        },
      },
    ]

    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: mockData, error: null }),
        }),
      }),
    } as unknown as SupabaseClient

    const { courses, error } = await getEnrolledLiveCourses(client, 'u-student')
    expect(error).toBeNull()
    expect(courses).toHaveLength(1)
    expect(courses[0].id).toBe('c1')
    expect(courses[0].title).toBe('Khóa trực tuyến')
    expect(courses[0].creator_name).toBe('Thầy Dạy Cờ')
  })

  it('matches submissions with assignments', async () => {
    const mockAssignments = [
      { id: 'a1', course_id: 'c1', title: 'Bài tập 1', due_date: '2026-12-01', max_score: 10 },
      { id: 'a2', course_id: 'c1', title: 'Bài tập 2', due_date: '2026-10-01', max_score: 10 },
    ]

    const mockSubmissions = [
      { id: 'sub-1', assignment_id: 'a2', content: 'Lời giải của em', score: 9.5, teacher_feedback: 'Rất tốt' },
    ]

    const client = {
      from: vi.fn((table: string) => {
        if (table === 'live_assignments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: mockAssignments, error: null }),
              }),
            }),
          }
        }
        if (table === 'live_assignment_submissions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: mockSubmissions, error: null }),
            }),
          }
        }
        return {}
      }),
    } as unknown as SupabaseClient

    const { assignments, error } = await getCourseAssignments(client, 'c1', 'u-student')
    expect(error).toBeNull()
    expect(assignments).toHaveLength(2)
    expect(assignments[0].submission).toBeNull()
    expect(assignments[1].submission?.score).toBe(9.5)
    expect(assignments[1].submission?.teacher_feedback).toBe('Rất tốt')
  })

  it('calls upsert to submit assignment', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null })
    const client = {
      from: vi.fn().mockReturnValue({
        upsert: upsertMock,
      }),
    } as unknown as SupabaseClient

    const { success, error } = await submitAssignment(client, 'a1', 'u1', 'Lời giải chi tiết')
    expect(error).toBeNull()
    expect(success).toBe(true)
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assignment_id: 'a1',
        user_id: 'u1',
        content: 'Lời giải chi tiết',
      }),
      { onConflict: 'assignment_id,user_id' }
    )
  })

  it('fetches and maps course chat messages', async () => {
    const mockChats = [
      {
        id: 'msg-1',
        course_id: 'c1',
        sender_id: 'u1',
        content: 'Xin chào lớp học!',
        created_at: '2026-10-23T10:00:00Z',
        sender: { name: 'Thầy Dạy Cờ', role: 'teacher' },
      },
    ]

    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: mockChats, error: null }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient

    const { messages, error } = await getCourseChatMessages(client, 'c1')
    expect(error).toBeNull()
    expect(messages).toHaveLength(1)
    expect(messages[0].sender_name).toBe('Thầy Dạy Cờ')
    expect(messages[0].sender_role).toBe('teacher')
    expect(messages[0].content).toBe('Xin chào lớp học!')
  })

  it('sends course chat message and maps response', async () => {
    const mockInserted = {
      id: 'msg-new',
      course_id: 'c1',
      sender_id: 'u2',
      content: 'Em đã nộp bài ạ',
      created_at: '2026-10-23T10:05:00Z',
      sender: { name: 'Học Viên Nam', role: 'learner' },
    }

    const client = {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockInserted, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient

    const { message, error } = await sendCourseChatMessage(client, 'c1', 'u2', 'Em đã nộp bài ạ')
    expect(error).toBeNull()
    expect(message?.id).toBe('msg-new')
    expect(message?.sender_name).toBe('Học Viên Nam')
    expect(message?.sender_role).toBe('student')
    expect(message?.content).toBe('Em đã nộp bài ạ')
  })

  it('subscribes to realtime course chat channel and cleans up on return', () => {
    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    }
    const removeChannelMock = vi.fn()
    const client = {
      channel: vi.fn().mockReturnValue(mockChannel),
      removeChannel: removeChannelMock,
    } as unknown as SupabaseClient

    const unsubscribe = subscribeToCourseChat(client, 'c1', vi.fn())
    expect(client.channel).toHaveBeenCalledWith('course_portal_chat_c1')
    expect(mockChannel.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        table: 'course_portal_chats',
        filter: 'course_id=eq.c1',
      }),
      expect.any(Function)
    )

    unsubscribe()
    expect(removeChannelMock).toHaveBeenCalledWith(mockChannel)
  })
})
