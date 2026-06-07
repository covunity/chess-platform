import type { SupabaseClient } from '@supabase/supabase-js'

export interface WishlistItem {
  id: string
  user_id: string
  course_id: string
  added_at: string
}

export interface WishlistCourse {
  id: string
  title: string
  thumbnail_url: string | null
  price: number
  creator_name: string | null
  rating_avg: number
  rating_count: number
  added_at: string
}

// ── Add to wishlist ──────────────────────────────────────────────────────

export interface AddToWishlistResult {
  item: WishlistItem | null
  error: Error | null
}

export async function addToWishlist(
  client: SupabaseClient,
  userId: string,
  courseId: string
): Promise<AddToWishlistResult> {
  const { data, error } = await client
    .from('course_wishlists')
    .insert({
      user_id: userId,
      course_id: courseId,
    })
    .select()
    .single()

  if (error || !data) {
    return { item: null, error: new Error((error as { message?: string })?.message ?? 'Failed to add to wishlist') }
  }
  return { item: data as WishlistItem, error: null }
}

// ── Remove from wishlist ────────────────────────────────────────────────

export interface RemoveFromWishlistResult {
  error: Error | null
}

export async function removeFromWishlist(
  client: SupabaseClient,
  userId: string,
  courseId: string
): Promise<RemoveFromWishlistResult> {
  const { error } = await client
    .from('course_wishlists')
    .delete()
    .eq('user_id', userId)
    .eq('course_id', courseId)

  if (error) {
    return { error: new Error((error as { message?: string })?.message ?? 'Failed to remove from wishlist') }
  }
  return { error: null }
}

// ── Check if in wishlist ────────────────────────────────────────────────

export interface IsInWishlistResult {
  inWishlist: boolean
  error: Error | null
}

export async function isInWishlist(
  client: SupabaseClient,
  userId: string,
  courseId: string
): Promise<IsInWishlistResult> {
  const { data, error } = await client
    .from('course_wishlists')
    .select('id')
    .eq('user_id', userId)
    .eq('course_id', courseId)
    .maybeSingle()

  if (error) {
    return { inWishlist: false, error: new Error((error as { message?: string })?.message ?? 'Failed to check wishlist') }
  }
  return { inWishlist: !!data, error: null }
}

// ── Get wishlist courses ────────────────────────────────────────────────

export interface GetWishlistResult {
  courses: WishlistCourse[] | null
  error: Error | null
}

export async function getWishlistCourses(
  client: SupabaseClient,
  userId: string
): Promise<GetWishlistResult> {
  const { data, error } = await client
    .from('course_wishlists')
    .select(`
      added_at,
      courses:course_id (
        id,
        title,
        thumbnail_url,
        price,
        users:creator_id ( name ),
        reviews ( rating )
      )
    `)
    .eq('user_id', userId)
    .order('added_at', { ascending: false })

  if (error) {
    return { courses: null, error: new Error((error as { message?: string })?.message ?? 'Failed to fetch wishlist') }
  }

  const rows = (data ?? []) as unknown as Array<{
    added_at: string
    courses: {
      id: string
      title: string
      thumbnail_url: string | null
      price: number
      users: { name?: string } | null
      reviews: Array<{ rating: number }> | null
    } | null
  }>

  const courses: WishlistCourse[] = rows
    .filter(row => row.courses) // Ensure course still exists
    .map(row => {
      const course = row.courses!
      const reviews = Array.isArray(course.reviews) ? course.reviews : []
      const ratings = reviews.map(r => r.rating)
      const rating_avg = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0
      const creator = course.users as { name?: string } | null

      return {
        id: course.id,
        title: course.title,
        thumbnail_url: course.thumbnail_url,
        price: course.price,
        creator_name: creator?.name ?? null,
        rating_avg,
        rating_count: ratings.length,
        added_at: row.added_at,
      }
    })

  return { courses, error: null }
}
