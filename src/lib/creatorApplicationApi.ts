import type { SupabaseClient } from '@supabase/supabase-js'

export type CreatorApplicationStatus = 'pending' | 'approved' | 'rejected'

export interface CreatorApplication {
  id: string
  user_id: string
  status: CreatorApplicationStatus
  motivation: string
  experience: string
  sample_url: string | null
  rejection_reason: string | null
  created_at: string
  reviewed_at: string | null
  reviewed_by: string | null
}

export interface CreatorApplicationWithApplicant extends CreatorApplication {
  applicant: {
    id: string
    name: string | null
    email: string
  } | null
}

export interface SubmitInput {
  motivation: string
  experience: string
  sample_url?: string
}

export async function submitCreatorApplication(
  client: SupabaseClient,
  userId: string,
  input: SubmitInput
): Promise<{ application: CreatorApplication | null; error: Error | null }> {
  const { data, error } = await client
    .from('account_applications')
    .insert({
      user_id: userId,
      motivation: input.motivation.trim(),
      experience: input.experience.trim(),
      sample_url: input.sample_url?.trim() || null,
    })
    .select('*')
    .single()

  return {
    application: (data as CreatorApplication) ?? null,
    error: error as Error | null,
  }
}

export async function getMyLatestApplication(
  client: SupabaseClient,
  userId: string
): Promise<{ application: CreatorApplication | null; error: Error | null }> {
  const { data, error } = await client
    .from('account_applications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    application: (data as CreatorApplication) ?? null,
    error: error as Error | null,
  }
}

export async function listCreatorApplications(
  client: SupabaseClient,
  options: { status?: CreatorApplicationStatus; limit?: number } = {}
): Promise<{ applications: CreatorApplicationWithApplicant[]; error: Error | null }> {
  const { status, limit = 50 } = options

  let query = client
    .from('account_applications')
    .select(
      'id, user_id, status, motivation, experience, sample_url, rejection_reason, created_at, reviewed_at, reviewed_by, applicant:users!account_applications_user_id_fkey(id, name, email)'
    )
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  return {
    applications: (data as unknown as CreatorApplicationWithApplicant[]) ?? [],
    error: error as Error | null,
  }
}

export async function approveCreatorApplication(
  client: SupabaseClient,
  applicationId: string
): Promise<{ application: CreatorApplication | null; error: Error | null }> {
  const { data, error } = await client.rpc('approve_account_application', {
    app_id: applicationId,
  })

  return {
    application: (data as CreatorApplication) ?? null,
    error: error as Error | null,
  }
}

export async function rejectCreatorApplication(
  client: SupabaseClient,
  applicationId: string,
  reason: string
): Promise<{ application: CreatorApplication | null; error: Error | null }> {
  const { data, error } = await client.rpc('reject_account_application', {
    app_id: applicationId,
    reason,
  })

  return {
    application: (data as CreatorApplication) ?? null,
    error: error as Error | null,
  }
}
