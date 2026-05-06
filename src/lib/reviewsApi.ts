import type { SupabaseClient } from '@supabase/supabase-js'

export interface Review {
  id: string
  course_id: string
  reviewer_id: string
  rating: number
  title: string | null
  body: string | null
  created_at: string
  updated_at: string
}

export interface SubmitReviewInput {
  courseId: string
  reviewerId: string
  rating: number
  title: string | null
  body: string | null
}

export async function submitReview(
  client: SupabaseClient,
  input: SubmitReviewInput
): Promise<{ review: Review | null; error: Error | null }> {
  const { data, error } = await client
    .from('reviews')
    .upsert(
      {
        course_id: input.courseId,
        reviewer_id: input.reviewerId,
        rating: input.rating,
        title: input.title,
        body: input.body,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'course_id,reviewer_id' }
    )
    .select()
    .single()

  if (error) return { review: null, error: error as unknown as Error }
  return { review: data as Review, error: null }
}

export async function getUserReview(
  client: SupabaseClient,
  courseId: string,
  reviewerId: string
): Promise<{ review: Review | null; error: Error | null }> {
  const { data, error } = await client
    .from('reviews')
    .select('id, course_id, reviewer_id, rating, title, body, created_at, updated_at')
    .eq('course_id', courseId)
    .eq('reviewer_id', reviewerId)
    .single()

  if (error) {
    // PGRST116 = no row found — not an error for our purposes
    if ((error as unknown as { code?: string }).code === 'PGRST116') {
      return { review: null, error: null }
    }
    return { review: null, error: error as unknown as Error }
  }
  return { review: data as Review, error: null }
}

export async function deleteReview(
  client: SupabaseClient,
  courseId: string,
  reviewerId: string
): Promise<{ error: Error | null }> {
  const { error } = await client
    .from('reviews')
    .delete()
    .eq('course_id', courseId)
    .eq('reviewer_id', reviewerId)

  return { error: error as unknown as Error | null }
}
