import type { SupabaseClient } from '@supabase/supabase-js'

export interface CoursePriceLimit {
  level: string
  min_price: number
  max_price: number
}

let _cache: CoursePriceLimit[] | null = null

export async function fetchCoursePriceLimits(
  supabase: SupabaseClient
): Promise<CoursePriceLimit[]> {
  if (_cache) return _cache
  const { data, error } = await supabase.rpc('get_course_price_limits')
  if (error || !data) return []
  _cache = data as CoursePriceLimit[]
  return _cache
}

export function clearCoursePriceLimitsCache() {
  _cache = null
}

export function getLimitForLevel(
  limits: CoursePriceLimit[],
  level: string
): CoursePriceLimit | undefined {
  return limits.find((l) => l.level === level)
}

export async function updateCoursePriceLimit(
  supabase: SupabaseClient,
  level: string,
  min_price: number,
  max_price: number
): Promise<{ error: Error | null }> {
  const { error } = await supabase.rpc('admin_update_course_price_limit', {
    p_level: level,
    p_min_price: min_price,
    p_max_price: max_price,
  })
  if (!error) clearCoursePriceLimitsCache()
  return { error: error ? new Error(error.message) : null }
}
