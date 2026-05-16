import type { SupabaseClient } from '@supabase/supabase-js'

export const MAX_BIO_LENGTH = 60

export async function updateProfileName(
  supabase: SupabaseClient,
  userId: string,
  name: string
): Promise<{ error: Error | null }> {
  const { error } = await supabase
    .from('users')
    .update({ name })
    .eq('id', userId)
  return { error }
}

export async function updateProfileBio(
  supabase: SupabaseClient,
  userId: string,
  bio: string | null
): Promise<{ error: Error | null }> {
  const trimmed = bio === null ? null : bio.slice(0, MAX_BIO_LENGTH)
  const { error } = await supabase
    .from('users')
    .update({ bio: trimmed && trimmed.trim().length > 0 ? trimmed : null })
    .eq('id', userId)
  return { error }
}

export async function uploadAvatar(
  supabase: SupabaseClient,
  userId: string,
  file: File
): Promise<{ url: string | null; error: Error | null }> {
  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `${userId}/avatar.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type })

  if (uploadError) return { url: null, error: uploadError }

  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  // Cache-bust so the browser fetches the new image immediately
  const url = `${data.publicUrl}?t=${Date.now()}`

  const { error: dbError } = await supabase
    .from('users')
    .update({ avatar_url: url })
    .eq('id', userId)

  if (dbError) return { url: null, error: dbError }

  return { url, error: null }
}

export async function removeAvatar(
  supabase: SupabaseClient,
  userId: string,
  currentAvatarUrl: string
): Promise<{ error: Error | null }> {
  // Strip cache-busting query params before extracting storage path
  const urlWithoutQuery = currentAvatarUrl.split('?')[0]
  const parts = urlWithoutQuery.split('/avatars/')
  if (parts.length < 2) return { error: new Error('Invalid avatar URL') }

  const storagePath = parts[1]

  const { error: deleteError } = await supabase.storage
    .from('avatars')
    .remove([storagePath])

  if (deleteError) return { error: deleteError }

  const { error: dbError } = await supabase
    .from('users')
    .update({ avatar_url: null })
    .eq('id', userId)

  return { error: dbError }
}

export async function updateEditorAdvanced(
  supabase: SupabaseClient,
  userId: string,
  editorAdvanced: boolean
): Promise<{ error: Error | null }> {
  const { error } = await supabase
    .from('users')
    .update({ editor_advanced: editorAdvanced })
    .eq('id', userId)
  return { error }
}
