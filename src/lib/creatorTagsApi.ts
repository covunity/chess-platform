import type { SupabaseClient } from '@supabase/supabase-js'

export interface CreatorTag {
  id: string
  creator_id: string
  tag_name: string
  created_at: string
}

export const MAX_TAG_LENGTH = 300

export function normalizeTagName(raw: string): string {
  return raw.trim().slice(0, MAX_TAG_LENGTH)
}

export async function listCreatorTags(
  client: SupabaseClient,
  creatorId: string
): Promise<{ tags: CreatorTag[]; error: Error | null }> {
  const { data, error } = await client
    .from('creator_tags')
    .select('id, creator_id, tag_name, created_at')
    .eq('creator_id', creatorId)
    .order('tag_name', { ascending: true })
  return { tags: (data as CreatorTag[]) ?? [], error: error as Error | null }
}

export async function createCreatorTag(
  client: SupabaseClient,
  creatorId: string,
  tagName: string
): Promise<{ tag: CreatorTag | null; error: Error | null }> {
  const name = normalizeTagName(tagName)
  if (!name) {
    return { tag: null, error: new Error('tag_name_empty') }
  }
  const { data, error } = await client
    .from('creator_tags')
    .insert({ creator_id: creatorId, tag_name: name })
    .select('id, creator_id, tag_name, created_at')
    .single()
  return { tag: (data as CreatorTag) ?? null, error: error as Error | null }
}

export async function deleteCreatorTag(
  client: SupabaseClient,
  tagId: string
): Promise<{ error: Error | null }> {
  const { error } = await client.from('creator_tags').delete().eq('id', tagId)
  return { error: error as Error | null }
}
