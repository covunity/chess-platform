import { useState, useEffect } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type AccountTierCode = 'individual' | 'business' | 'athlete' | 'training_center'

export interface AccountTier {
  code: AccountTierCode
  name_vi: string
  platform_fee_pct: number
  max_chapters_per_course: number
  is_enterprise: boolean
  requires_approval: boolean
  display_order: number
}

// Session-level cache: fetch once, reuse for the lifetime of the page session.
let _tiersCache: AccountTier[] | null = null
let _tiersPromise: Promise<AccountTier[]> | null = null

export async function fetchAccountTiers(client: SupabaseClient): Promise<AccountTier[]> {
  if (_tiersCache) return _tiersCache

  if (!_tiersPromise) {
    _tiersPromise = Promise.resolve(
      client
        .from('account_tiers')
        .select('code, name_vi, platform_fee_pct, max_chapters_per_course, is_enterprise, requires_approval, display_order')
        .order('display_order', { ascending: true })
    ).then(({ data, error }) => {
      if (error) throw error
      _tiersCache = (data as AccountTier[]) ?? []
      return _tiersCache
    }).catch((err: unknown) => {
      _tiersPromise = null
      throw err
    })
  }

  return _tiersPromise as Promise<AccountTier[]>
}

export function clearAccountTiersCache() {
  _tiersCache = null
  _tiersPromise = null
}

export function useAccountTiers() {
  const [tiers, setTiers] = useState<AccountTier[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchAccountTiers(supabase)
      .then(data => { if (!cancelled) { setTiers(data); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  function getTier(code: AccountTierCode | string): AccountTier | undefined {
    return tiers.find(t => t.code === code)
  }

  return { tiers, loading, getTier }
}

export function computeFeeFloor(price: number, pct: number): number {
  return Math.floor((price * pct) / 100)
}
