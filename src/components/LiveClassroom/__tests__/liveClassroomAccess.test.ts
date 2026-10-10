import { describe, it, expect, vi } from 'vitest'
import { checkLiveClassroomAccess } from '../../../lib/coursesApi'
import type { SupabaseClient } from '@supabase/supabase-js'

describe('checkLiveClassroomAccess', () => {
  it('calls check_live_classroom_access RPC with room and user id', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        is_course_room: true,
        allowed: true,
        role: 'student',
        course_id: 'c-1',
        course_title: 'Khai cuộc Ý',
        live_schedule: 'Thứ 3 hàng tuần',
      },
      error: null,
    })
    const client = { rpc: mockRpc } as unknown as SupabaseClient

    const { access, error } = await checkLiveClassroomAccess(client, 'live-italy', 'user-1')
    expect(error).toBeNull()
    expect(mockRpc).toHaveBeenCalledWith('check_live_classroom_access', {
      p_room_id: 'live-italy',
      p_user_id: 'user-1',
    })
    expect(access).toEqual({
      is_course_room: true,
      allowed: true,
      role: 'student',
      course_id: 'c-1',
      course_title: 'Khai cuộc Ý',
      live_schedule: 'Thứ 3 hàng tuần',
    })
  })

  it('passes null user id when unauthenticated', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        is_course_room: true,
        allowed: false,
        reason: 'unauthenticated',
        course_id: 'c-1',
        course_title: 'Khai cuộc Ý',
      },
      error: null,
    })
    const client = { rpc: mockRpc } as unknown as SupabaseClient

    const { access, error } = await checkLiveClassroomAccess(client, 'live-italy', null)
    expect(error).toBeNull()
    expect(mockRpc).toHaveBeenCalledWith('check_live_classroom_access', {
      p_room_id: 'live-italy',
      p_user_id: null,
    })
    expect(access?.allowed).toBe(false)
    expect(access?.reason).toBe('unauthenticated')
  })

  it('handles not_enrolled status correctly', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        is_course_room: true,
        allowed: false,
        reason: 'not_enrolled',
        course_id: 'c-1',
        course_title: 'Khai cuộc Ý',
        live_schedule: 'Thứ 3 hàng tuần',
      },
      error: null,
    })
    const client = { rpc: mockRpc } as unknown as SupabaseClient

    const { access, error } = await checkLiveClassroomAccess(client, 'live-italy', 'unenrolled-user')
    expect(error).toBeNull()
    expect(access?.allowed).toBe(false)
    expect(access?.reason).toBe('not_enrolled')
    expect(access?.course_title).toBe('Khai cuộc Ý')
  })

  it('returns error when RPC fails', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: new Error('RPC failure'),
    })
    const client = { rpc: mockRpc } as unknown as SupabaseClient

    const { access, error } = await checkLiveClassroomAccess(client, 'live-italy', 'user-1')
    expect(access).toBeNull()
    expect(error).toBeTruthy()
  })
})
