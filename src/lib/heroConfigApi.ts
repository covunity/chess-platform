import type { SupabaseClient } from '@supabase/supabase-js'

export interface HeroConfig {
  eyebrow: string
  headline1: string
  headline2: string
  subparagraph: string
  cta1: string
  trust: string
  annotationAuthor: string
  annotation: string
  bookmark: string
  imageUrl: string
}

const HERO_KEYS = [
  'hero_eyebrow',
  'hero_headline1',
  'hero_headline2',
  'hero_subparagraph',
  'hero_cta1',
  'hero_trust',
  'hero_annotation_author',
  'hero_annotation',
  'hero_bookmark',
  'hero_image_url',
] as const

export async function fetchHeroConfig(supabase: SupabaseClient): Promise<HeroConfig> {
  const { data } = await supabase
    .from('config')
    .select('key, value')
    .in('key', [...HERO_KEYS])

  const map: Record<string, string> = {}
  for (const row of data ?? []) {
    map[row.key as string] = row.value as string
  }

  return {
    eyebrow: map['hero_eyebrow'] ?? '',
    headline1: map['hero_headline1'] ?? '',
    headline2: map['hero_headline2'] ?? '',
    subparagraph: map['hero_subparagraph'] ?? '',
    cta1: map['hero_cta1'] ?? '',
    trust: map['hero_trust'] ?? '',
    annotationAuthor: map['hero_annotation_author'] ?? '',
    annotation: map['hero_annotation'] ?? '',
    bookmark: map['hero_bookmark'] ?? '',
    imageUrl: map['hero_image_url'] ?? '',
  }
}

export async function updateHeroConfig(
  supabase: SupabaseClient,
  config: HeroConfig,
): Promise<{ error: Error | null }> {
  const { error } = await supabase.rpc('update_hero_config', {
    p_eyebrow: config.eyebrow,
    p_headline1: config.headline1,
    p_headline2: config.headline2,
    p_subparagraph: config.subparagraph,
    p_cta1: config.cta1,
    p_trust: config.trust,
    p_annotation_author: config.annotationAuthor,
    p_annotation: config.annotation,
    p_bookmark: config.bookmark,
    p_image_url: config.imageUrl,
  })
  return { error: error ? new Error(error.message) : null }
}
