import { describe, it, expect, vi } from 'vitest'
import {
  submitCreatorApplication,
  getMyLatestApplication,
  listCreatorApplications,
  approveCreatorApplication,
  rejectCreatorApplication,
} from './creatorApplicationApi'
import type { SupabaseClient } from '@supabase/supabase-js'

const sample = {
  id: 'app-1',
  user_id: 'u-1',
  status: 'pending',
  motivation: 'Tôi yêu cờ',
  experience: 'GM 2400',
  sample_url: null,
  rejection_reason: null,
  created_at: '2026-05-07T10:00:00Z',
  reviewed_at: null,
  reviewed_by: null,
}

describe('submitCreatorApplication', () => {
  it('inserts an application with trimmed fields', async () => {
    const single = vi.fn().mockResolvedValue({ data: sample, error: null })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })
    const client = { from: vi.fn().mockReturnValue({ insert }) } as unknown as SupabaseClient

    const { application, error } = await submitCreatorApplication(client, 'u-1', {
      motivation: '  Tôi yêu cờ  ',
      experience: 'GM 2400',
      sample_url: '  https://example.com  ',
    })

    expect(error).toBeNull()
    expect(application?.id).toBe('app-1')
    expect(client.from).toHaveBeenCalledWith('account_applications')
    expect(insert).toHaveBeenCalledWith({
      user_id: 'u-1',
      motivation: 'Tôi yêu cờ',
      experience: 'GM 2400',
      sample_url: 'https://example.com',
    })
  })

  it('persists null when sample_url is empty', async () => {
    const single = vi.fn().mockResolvedValue({ data: sample, error: null })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })
    const client = { from: vi.fn().mockReturnValue({ insert }) } as unknown as SupabaseClient

    await submitCreatorApplication(client, 'u-1', { motivation: 'm', experience: 'e' })

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ sample_url: null })
    )
  })

  it('returns error when insert fails', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: 'duplicate' } })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })
    const client = { from: vi.fn().mockReturnValue({ insert }) } as unknown as SupabaseClient

    const { application, error } = await submitCreatorApplication(client, 'u-1', {
      motivation: 'm',
      experience: 'e',
    })

    expect(application).toBeNull()
    expect(error).toEqual({ message: 'duplicate' })
  })
})

describe('getMyLatestApplication', () => {
  it('returns the latest application for the user', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: sample, error: null })
    const limit = vi.fn().mockReturnValue({ maybeSingle })
    const order = vi.fn().mockReturnValue({ limit })
    const eq = vi.fn().mockReturnValue({ order })
    const select = vi.fn().mockReturnValue({ eq })
    const client = { from: vi.fn().mockReturnValue({ select }) } as unknown as SupabaseClient

    const { application, error } = await getMyLatestApplication(client, 'u-1')

    expect(error).toBeNull()
    expect(application?.id).toBe('app-1')
    expect(eq).toHaveBeenCalledWith('user_id', 'u-1')
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(limit).toHaveBeenCalledWith(1)
  })

  it('returns null when no application exists', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const limit = vi.fn().mockReturnValue({ maybeSingle })
    const order = vi.fn().mockReturnValue({ limit })
    const eq = vi.fn().mockReturnValue({ order })
    const select = vi.fn().mockReturnValue({ eq })
    const client = { from: vi.fn().mockReturnValue({ select }) } as unknown as SupabaseClient

    const { application } = await getMyLatestApplication(client, 'u-1')
    expect(application).toBeNull()
  })
})

describe('listCreatorApplications', () => {
  it('lists applications filtered by status', async () => {
    const eq = vi.fn().mockResolvedValue({ data: [{ ...sample, applicant: null }], error: null })
    const limit = vi.fn().mockReturnValue({ eq })
    const order = vi.fn().mockReturnValue({ limit })
    const select = vi.fn().mockReturnValue({ order })
    const client = { from: vi.fn().mockReturnValue({ select }) } as unknown as SupabaseClient

    const { applications, error } = await listCreatorApplications(client, { status: 'pending' })

    expect(error).toBeNull()
    expect(applications).toHaveLength(1)
    expect(eq).toHaveBeenCalledWith('status', 'pending')
  })

  it('lists applications without filter when status is omitted', async () => {
    const limit = vi.fn().mockResolvedValue({ data: [], error: null })
    const order = vi.fn().mockReturnValue({ limit })
    const select = vi.fn().mockReturnValue({ order })
    const client = { from: vi.fn().mockReturnValue({ select }) } as unknown as SupabaseClient

    const { applications } = await listCreatorApplications(client)
    expect(applications).toEqual([])
  })
})

describe('approveCreatorApplication', () => {
  it('calls the approve RPC with the given id', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ...sample, status: 'approved' }, error: null })
    const client = { rpc } as unknown as SupabaseClient

    const { application, error } = await approveCreatorApplication(client, 'app-1')

    expect(error).toBeNull()
    expect(application?.status).toBe('approved')
    expect(rpc).toHaveBeenCalledWith('approve_account_application', { app_id: 'app-1' })
  })
})

describe('rejectCreatorApplication', () => {
  it('calls the reject RPC with id and reason', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ...sample, status: 'rejected', rejection_reason: 'Chưa đủ kinh nghiệm' },
      error: null,
    })
    const client = { rpc } as unknown as SupabaseClient

    const { application, error } = await rejectCreatorApplication(client, 'app-1', 'Chưa đủ kinh nghiệm')

    expect(error).toBeNull()
    expect(application?.status).toBe('rejected')
    expect(application?.rejection_reason).toBe('Chưa đủ kinh nghiệm')
    expect(rpc).toHaveBeenCalledWith('reject_account_application', {
      app_id: 'app-1',
      reason: 'Chưa đủ kinh nghiệm',
    })
  })
})
