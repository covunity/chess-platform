import type { SupabaseClient } from '@supabase/supabase-js'

export interface BankConfig {
  short_name: string | null
  bin: string | null
  account_number: string | null
  account_name: string | null
}

const BANK_KEYS = [
  'bank_short_name',
  'bank_bin',
  'bank_account_number',
  'bank_account_name',
] as const

export async function getBankConfig(
  client: SupabaseClient
): Promise<{ bank: BankConfig | null; error: Error | null }> {
  const { data, error } = await client
    .from('config')
    .select('key, value')
    .in('key', [...BANK_KEYS])

  if (error) {
    return { bank: null, error: error as unknown as Error }
  }

  const map = new Map((data ?? []).map(r => [r.key as string, r.value as string]))
  return {
    bank: {
      short_name:     map.get('bank_short_name')     ?? null,
      bin:            map.get('bank_bin')            ?? null,
      account_number: map.get('bank_account_number') ?? null,
      account_name:   map.get('bank_account_name')   ?? null,
    },
    error: null,
  }
}

export interface BankConfigInput {
  short_name: string
  bin: string
  account_number: string
  account_name: string
}

export async function updateBankConfig(
  client: SupabaseClient,
  input: BankConfigInput
): Promise<{ error: Error | null }> {
  const { error } = await client.rpc('update_bank_config', {
    p_short_name:     input.short_name,
    p_bin:            input.bin,
    p_account_number: input.account_number,
    p_account_name:   input.account_name,
  })
  return { error: error as Error | null }
}
