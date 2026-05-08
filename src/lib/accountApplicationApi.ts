import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountTierCode } from './accountTiers'

export type AccountApplicationStatus = 'pending' | 'approved' | 'rejected' | 'superseded'

export interface AccountApplication {
  id: string
  user_id: string
  status: AccountApplicationStatus
  requested_tier_code: AccountTierCode
  motivation: string
  experience: string
  sample_url: string | null
  metadata: Record<string, unknown>
  rejection_reason: string | null
  created_at: string
  reviewed_at: string | null
  reviewed_by: string | null
}

export interface AccountApplicationWithApplicant extends AccountApplication {
  applicant: {
    id: string
    name: string | null
    email: string
  } | null
}

export interface SubmitAccountApplicationInput {
  requested_tier_code: AccountTierCode
  motivation: string
  experience?: string
  sample_url?: string
  metadata?: Record<string, unknown>
}

export async function submitAccountApplication(
  client: SupabaseClient,
  input: SubmitAccountApplicationInput
): Promise<{ id: string | null; error: Error | null }> {
  const { data, error } = await client.rpc('submit_account_application', {
    payload: {
      requested_tier_code: input.requested_tier_code,
      motivation: input.motivation,
      experience: input.experience ?? '',
      sample_url: input.sample_url ?? '',
      metadata: input.metadata ?? {},
    },
  })
  return { id: (data as string) ?? null, error: error as Error | null }
}

export async function getMyLatestAccountApplication(
  client: SupabaseClient,
  userId: string
): Promise<{ application: AccountApplication | null; error: Error | null }> {
  const { data, error } = await client
    .from('account_applications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    application: (data as AccountApplication) ?? null,
    error: error as Error | null,
  }
}

export async function listAccountApplications(
  client: SupabaseClient,
  options: {
    status?: AccountApplicationStatus
    tier?: AccountTierCode
    limit?: number
  } = {}
): Promise<{ applications: AccountApplicationWithApplicant[]; error: Error | null }> {
  const { status, tier, limit = 50 } = options

  let query = client
    .from('account_applications')
    .select(
      'id, user_id, status, requested_tier_code, motivation, experience, sample_url, metadata, rejection_reason, created_at, reviewed_at, reviewed_by, applicant:users!account_applications_user_id_fkey(id, name, email)'
    )
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status) query = query.eq('status', status)
  if (tier) query = query.eq('requested_tier_code', tier)

  const { data, error } = await query
  return {
    applications: (data as unknown as AccountApplicationWithApplicant[]) ?? [],
    error: error as Error | null,
  }
}

export async function approveAccountApplication(
  client: SupabaseClient,
  applicationId: string
): Promise<{ application: AccountApplication | null; error: Error | null }> {
  const { data, error } = await client.rpc('approve_account_application', {
    app_id: applicationId,
  })
  return {
    application: (data as AccountApplication) ?? null,
    error: error as Error | null,
  }
}

export async function rejectAccountApplication(
  client: SupabaseClient,
  applicationId: string,
  reason: string
): Promise<{ application: AccountApplication | null; error: Error | null }> {
  const { data, error } = await client.rpc('reject_account_application', {
    app_id: applicationId,
    reason,
  })
  return {
    application: (data as AccountApplication) ?? null,
    error: error as Error | null,
  }
}
