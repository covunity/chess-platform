import type { SupabaseClient } from '@supabase/supabase-js'

export interface PayoutInfoInput {
  bank_code: string
  bank_name: string
  account_number: string
  account_holder: string
  bank_branch: string
}

export interface CreatorPayoutInfo extends PayoutInfoInput {
  user_id: string
  updated_at: string
}

export interface DuplicatePayoutOwner {
  user_id: string
  name: string | null
  email: string
}

export type PayoutValidationField =
  | 'bank_code'
  | 'bank_name'
  | 'account_number'
  | 'account_holder'
  | 'bank_branch'

const ACCOUNT_NUMBER_PATTERN = /^[0-9]{6,19}$/

export const EMPTY_PAYOUT_INPUT: PayoutInfoInput = {
  bank_code: '',
  bank_name: '',
  account_number: '',
  account_holder: '',
  bank_branch: '',
}

export function validatePayoutInput(input: PayoutInfoInput): PayoutValidationField | null {
  if (!input.bank_code.trim()) return 'bank_code'
  if (!input.bank_name.trim()) return 'bank_name'
  if (!ACCOUNT_NUMBER_PATTERN.test(input.account_number)) return 'account_number'
  if (!input.account_holder.trim()) return 'account_holder'
  if (!input.bank_branch.trim()) return 'bank_branch'
  return null
}

export async function getMyCreatorPayoutInfo(
  client: SupabaseClient,
  userId: string
): Promise<{ payout: CreatorPayoutInfo | null; error: Error | null }> {
  const { data, error } = await client
    .from('creator_payout_info')
    .select('user_id, bank_code, bank_name, account_number, account_holder, bank_branch, updated_at')
    .eq('user_id', userId)
    .maybeSingle()

  return {
    payout: (data as CreatorPayoutInfo) ?? null,
    error: error as Error | null,
  }
}

export async function updateCreatorPayoutInfo(
  client: SupabaseClient,
  input: PayoutInfoInput
): Promise<{ payout: CreatorPayoutInfo | null; error: Error | null }> {
  const { data, error } = await client.rpc('update_creator_payout_info', { payload: input })
  return {
    payout: (data as CreatorPayoutInfo) ?? null,
    error: error as Error | null,
  }
}

export async function findDuplicatePayoutOwners(
  client: SupabaseClient,
  args: { bank_code: string; account_number: string; exclude_user_id?: string }
): Promise<{ owners: DuplicatePayoutOwner[]; error: Error | null }> {
  const { data, error } = await client.rpc('find_duplicate_payout_owners', {
    p_bank_code: args.bank_code,
    p_account_number: args.account_number,
    p_exclude_user_id: args.exclude_user_id ?? null,
  })
  return {
    owners: (data as DuplicatePayoutOwner[]) ?? [],
    error: error as Error | null,
  }
}
