import type { SupabaseClient } from '@supabase/supabase-js'

export interface EnrollForFreeResult {
  enrollmentId: string | null
  orderId: string | null
  error: Error | null
}

export interface GetLessonResult {
  lessonId: string | null
  error: Error | null
}

function generateOrderCode(): string {
  const year = new Date().getFullYear()
  const rand = Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0')
  return `ORD-${year}-${rand}`
}

export async function enrollForFree(
  client: SupabaseClient,
  courseId: string,
  userId: string
): Promise<EnrollForFreeResult> {
  const { data: course, error: courseError } = await client
    .from('courses')
    .select('id, price, status')
    .eq('id', courseId)
    .single()

  if (courseError || !course) {
    return { enrollmentId: null, orderId: null, error: new Error(courseError?.message ?? 'Không tìm thấy khóa học') }
  }

  if ((course as { price: number }).price !== 0) {
    return { enrollmentId: null, orderId: null, error: new Error('Khóa học không miễn phí') }
  }

  const { data: order, error: orderError } = await client
    .from('orders')
    .insert({
      course_id: courseId,
      user_id: userId,
      status: 'active',
      amount: 0,
      code: generateOrderCode(),
    })
    .select('id, status, amount')
    .single()

  if (orderError || !order) {
    return { enrollmentId: null, orderId: null, error: new Error(orderError?.message ?? 'Không thể tạo đơn hàng') }
  }

  const orderId = (order as { id: string }).id

  const { data: enrollment, error: enrollError } = await client
    .from('enrollments')
    .insert({
      course_id: courseId,
      user_id: userId,
      order_id: orderId,
    })
    .select('id')
    .single()

  if (enrollError || !enrollment) {
    const isDuplicate = enrollError?.code === '23505'
    return {
      enrollmentId: null,
      orderId: null,
      error: new Error(isDuplicate ? 'Bạn đã đăng ký khóa học này rồi' : (enrollError?.message ?? 'Không thể đăng ký')),
    }
  }

  return {
    enrollmentId: (enrollment as { id: string }).id,
    orderId,
    error: null,
  }
}

export async function getFirstLesson(
  client: SupabaseClient,
  courseId: string
): Promise<GetLessonResult> {
  const { data, error } = await client
    .from('lessons')
    .select('id, position, chapters!inner(course_id, position)')
    .eq('chapters.course_id', courseId)
    .order('chapters.position', { ascending: true })
    .order('position', { ascending: true })
    .limit(1)

  if (error) {
    return { lessonId: null, error: new Error(error.message) }
  }

  const lessons = data as Array<{ id: string }> | null
  if (!lessons || lessons.length === 0) {
    return { lessonId: null, error: new Error('Khóa học chưa có bài học') }
  }

  return { lessonId: lessons[0].id, error: null }
}

export async function getLastViewedLesson(
  client: SupabaseClient,
  courseId: string,
  userId: string
): Promise<GetLessonResult> {
  const { data, error } = await client
    .from('lesson_progress')
    .select('lesson_id, viewed_at')
    .eq('course_id', courseId)
    .eq('user_id', userId)
    .order('viewed_at', { ascending: false })
    .limit(1)

  if (error) {
    return { lessonId: null, error: new Error(error.message) }
  }

  const rows = data as Array<{ lesson_id: string }> | null
  if (!rows || rows.length === 0) {
    return { lessonId: null, error: null }
  }

  return { lessonId: rows[0].lesson_id, error: null }
}
