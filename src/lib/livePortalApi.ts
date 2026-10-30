import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase as defaultClient } from './supabase'

export interface EnrolledLiveCourse {
  id: string
  title: string
  description: string | null
  thumbnail_url: string | null
  live_schedule: string | null
  live_status: 'scheduled' | 'live' | 'ended'
  live_room_id: string | null
  price: number
  creator_id: string
  creator_name: string | null
  creator_avatar_url: string | null
  creator_bio: string | null
}

export interface LiveUpcomingSession {
  id: string
  course_id: string
  title: string
  description: string | null
  scheduled_start_at: string
  scheduled_end_at: string | null
  status: 'DRAFT' | 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED'
  livekit_room_name: string
  teacher_name?: string | null
}

export interface AssignmentItem {
  id: string
  course_id: string
  title: string
  description: string | null
  due_date: string
  max_score: number
  created_at: string
  submission?: {
    id: string
    content: string
    submitted_at: string
    score: number | null
    teacher_feedback: string | null
    graded_at: string | null
    status: 'submitted' | 'graded' | 'returned'
  } | null
}

export interface LiveAnnouncementItem {
  id: string
  course_id: string
  title: string
  content: string
  is_pinned: boolean
  created_at: string
  author_name?: string | null
}

export interface LiveMaterialItem {
  id: string
  course_id: string
  title: string
  category: 'document' | 'pgn' | 'slide' | 'video'
  file_url: string | null
  file_size: string | null
  created_at: string
}

export interface LiveDiscussionReply {
  id: string
  discussion_id: string
  user_id: string
  user_name: string
  user_avatar_url: string | null
  content: string
  created_at: string
}

export interface LiveDiscussionItem {
  id: string
  course_id: string
  user_id: string
  user_name: string
  user_avatar_url: string | null
  title: string
  content: string
  created_at: string
  replies: LiveDiscussionReply[]
}

export interface LiveTuitionItem {
  id: string
  course_id: string
  amount: number
  due_date: string
  status: 'paid' | 'pending' | 'overdue'
  period: string
  paid_at: string | null
  note: string | null
}

export interface LivePortalChatMessage {
  id: string
  sender_id: string
  sender_name: string
  sender_role: 'teacher' | 'student'
  content: string
  created_at: string
}

export async function getEnrolledLiveCourses(
  client: SupabaseClient = defaultClient,
  userId: string
): Promise<{ courses: EnrolledLiveCourse[]; error: Error | null }> {
  try {
    const { data, error } = await client
      .from('enrollments')
      .select(`
        course_id,
        courses:course_id (
          id, title, description, thumbnail_url, live_schedule, live_status, live_room_id, price, creator_id, course_type,
          creator:creator_id ( name, avatar_url, bio )
        )
      `)
      .eq('user_id', userId)

    if (error) throw error

    const courses: EnrolledLiveCourse[] = (data || [])
      .map((row: any) => {
        const c = row.courses
        if (!c || c.course_type !== 'live') return null
        const cr = c.creator
        return {
          id: c.id,
          title: c.title,
          description: c.description,
          thumbnail_url: c.thumbnail_url,
          live_schedule: c.live_schedule,
          live_status: c.live_status || 'scheduled',
          live_room_id: c.live_room_id,
          price: c.price,
          creator_id: c.creator_id,
          creator_name: cr?.name ?? null,
          creator_avatar_url: cr?.avatar_url ?? null,
          creator_bio: cr?.bio ?? null,
        }
      })
      .filter(Boolean) as EnrolledLiveCourse[]

    return { courses, error: null }
  } catch (err: any) {
    return { courses: [], error: err }
  }
}

export async function getCourseLiveSessions(
  client: SupabaseClient = defaultClient,
  courseId: string
): Promise<{ sessions: LiveUpcomingSession[]; error: Error | null }> {
  try {
    const { data, error } = await client
      .from('live_sessions')
      .select('id, course_id, title, description, scheduled_start_at, scheduled_end_at, status, livekit_room_name')
      .eq('course_id', courseId)
      .neq('status', 'DRAFT')
      .order('scheduled_start_at', { ascending: true })

    if (error) throw error
    return { sessions: (data || []) as LiveUpcomingSession[], error: null }
  } catch (err: any) {
    return { sessions: [], error: err }
  }
}

export async function getCourseAssignments(
  client: SupabaseClient = defaultClient,
  courseId: string,
  userId: string
): Promise<{ assignments: AssignmentItem[]; error: Error | null }> {
  try {
    const [assignmentsRes, submissionsRes] = await Promise.all([
      client
        .from('live_assignments')
        .select('*')
        .eq('course_id', courseId)
        .order('due_date', { ascending: true }),
      client
        .from('live_assignment_submissions')
        .select('*')
        .eq('user_id', userId),
    ])

    if (assignmentsRes.error) throw assignmentsRes.error

    const subMap = new Map<string, any>()
    for (const s of submissionsRes.data || []) {
      subMap.set(s.assignment_id, s)
    }

    const assignments: AssignmentItem[] = (assignmentsRes.data || []).map((a: any) => ({
      ...a,
      submission: subMap.get(a.id) ?? null,
    }))

    return { assignments, error: null }
  } catch (err: any) {
    return { assignments: [], error: err }
  }
}

export async function submitAssignment(
  client: SupabaseClient = defaultClient,
  assignmentId: string,
  userId: string,
  content: string
): Promise<{ success: boolean; error: Error | null }> {
  try {
    const { error } = await client
      .from('live_assignment_submissions')
      .upsert(
        {
          assignment_id: assignmentId,
          user_id: userId,
          content,
          submitted_at: new Date().toISOString(),
          status: 'submitted',
        },
        { onConflict: 'assignment_id,user_id' }
      )

    if (error) throw error
    return { success: true, error: null }
  } catch (err: any) {
    return { success: false, error: err }
  }
}

export async function getCourseAnnouncements(
  client: SupabaseClient = defaultClient,
  courseId: string
): Promise<{ announcements: LiveAnnouncementItem[]; error: Error | null }> {
  try {
    const { data, error } = await client
      .from('live_announcements')
      .select('id, course_id, title, content, is_pinned, created_at, users:author_id(name)')
      .eq('course_id', courseId)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) throw error

    const announcements = (data || []).map((a: any) => ({
      id: a.id,
      course_id: a.course_id,
      title: a.title,
      content: a.content,
      is_pinned: a.is_pinned,
      created_at: a.created_at,
      author_name: a.users?.name ?? null,
    }))

    return { announcements, error: null }
  } catch (err: any) {
    return { announcements: [], error: err }
  }
}

export async function getCourseMaterials(
  client: SupabaseClient = defaultClient,
  courseId: string
): Promise<{ materials: LiveMaterialItem[]; error: Error | null }> {
  try {
    const { data, error } = await client
      .from('live_materials')
      .select('*')
      .eq('course_id', courseId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return { materials: (data || []) as LiveMaterialItem[], error: null }
  } catch (err: any) {
    return { materials: [], error: err }
  }
}

export async function getCourseDiscussions(
  client: SupabaseClient = defaultClient,
  courseId: string
): Promise<{ discussions: LiveDiscussionItem[]; error: Error | null }> {
  try {
    const { data, error } = await client
      .from('live_discussions')
      .select(`
        id, course_id, user_id, title, content, created_at,
        users:user_id ( name, avatar_url ),
        replies:live_discussion_replies (
          id, discussion_id, user_id, content, created_at,
          reply_users:user_id ( name, avatar_url )
        )
      `)
      .eq('course_id', courseId)
      .order('created_at', { ascending: false })

    if (error) throw error

    const discussions = (data || []).map((d: any) => ({
      id: d.id,
      course_id: d.course_id,
      user_id: d.user_id,
      user_name: d.users?.name ?? 'Ẩn danh',
      user_avatar_url: d.users?.avatar_url ?? null,
      title: d.title,
      content: d.content,
      created_at: d.created_at,
      replies: ((d.replies || []) as any[])
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map((r: any) => ({
          id: r.id,
          discussion_id: r.discussion_id,
          user_id: r.user_id,
          user_name: r.reply_users?.name ?? 'Ẩn danh',
          user_avatar_url: r.reply_users?.avatar_url ?? null,
          content: r.content,
          created_at: r.created_at,
        })),
    }))

    return { discussions, error: null }
  } catch (err: any) {
    return { discussions: [], error: err }
  }
}

export async function createDiscussion(
  client: SupabaseClient = defaultClient,
  courseId: string,
  userId: string,
  title: string,
  content: string
): Promise<{ discussion: LiveDiscussionItem | null; error: Error | null }> {
  try {
    const { data, error } = await client
      .from('live_discussions')
      .insert({ course_id: courseId, user_id: userId, title, content })
      .select('id, course_id, user_id, title, content, created_at, users:user_id(name, avatar_url)')
      .single()

    if (error) throw error

    return {
      discussion: {
        id: data.id,
        course_id: data.course_id,
        user_id: data.user_id,
        user_name: (data as any).users?.name ?? 'Tôi',
        user_avatar_url: (data as any).users?.avatar_url ?? null,
        title: data.title,
        content: data.content,
        created_at: data.created_at,
        replies: [],
      },
      error: null,
    }
  } catch (err: any) {
    return { discussion: null, error: err }
  }
}

export async function createDiscussionReply(
  client: SupabaseClient = defaultClient,
  discussionId: string,
  userId: string,
  content: string
): Promise<{ reply: LiveDiscussionReply | null; error: Error | null }> {
  try {
    const { data, error } = await client
      .from('live_discussion_replies')
      .insert({ discussion_id: discussionId, user_id: userId, content })
      .select('id, discussion_id, user_id, content, created_at, reply_users:user_id(name, avatar_url)')
      .single()

    if (error) throw error

    return {
      reply: {
        id: data.id,
        discussion_id: data.discussion_id,
        user_id: data.user_id,
        user_name: (data as any).reply_users?.name ?? 'Tôi',
        user_avatar_url: (data as any).reply_users?.avatar_url ?? null,
        content: data.content,
        created_at: data.created_at,
      },
      error: null,
    }
  } catch (err: any) {
    return { reply: null, error: err }
  }
}

export async function getCourseTuition(
  client: SupabaseClient = defaultClient,
  courseId: string,
  userId: string
): Promise<{ tuition: LiveTuitionItem | null; error: Error | null }> {
  try {
    const { data, error } = await client
      .from('live_tuition_records')
      .select('*')
      .eq('course_id', courseId)
      .eq('user_id', userId)
      .order('due_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error
    return { tuition: data as LiveTuitionItem | null, error: null }
  } catch (err: any) {
    return { tuition: null, error: err }
  }
}

export async function getCourseChatMessages(
  client: SupabaseClient = defaultClient,
  courseId: string,
  limit = 100
): Promise<{ messages: LivePortalChatMessage[]; error: Error | null }> {
  try {
    const { data, error } = await client
      .from('course_portal_chats')
      .select(`
        id,
        sender_id,
        content,
        created_at,
        sender:sender_id ( name, role, avatar_url )
      `)
      .eq('course_id', courseId)
      .order('created_at', { ascending: true })
      .limit(limit)

    if (error) throw error

    const messages: LivePortalChatMessage[] = (data || []).map((row: any) => {
      const sender = row.sender || {}
      return {
        id: row.id,
        sender_id: row.sender_id,
        sender_name: sender.name || 'Thành viên lớp',
        sender_role: sender.role === 'creator' || sender.role === 'teacher' ? 'teacher' : 'student',
        content: row.content,
        created_at: row.created_at,
      }
    })

    return { messages, error: null }
  } catch (err: unknown) {
    return { messages: [], error: err instanceof Error ? err : new Error(String(err)) }
  }
}

export async function sendCourseChatMessage(
  client: SupabaseClient = defaultClient,
  courseId: string,
  senderId: string,
  content: string
): Promise<{ message: LivePortalChatMessage | null; error: Error | null }> {
  try {
    const { data, error } = await client
      .from('course_portal_chats')
      .insert({
        course_id: courseId,
        sender_id: senderId,
        content: content.trim(),
      })
      .select(`
        id,
        sender_id,
        content,
        created_at,
        sender:sender_id ( name, role, avatar_url )
      `)
      .single()

    if (error) throw error
    if (!data) throw new Error('No data returned from chat insert')

    const sender = (data as any).sender || {}
    const message: LivePortalChatMessage = {
      id: data.id,
      sender_id: data.sender_id,
      sender_name: sender.name || 'Học viên',
      sender_role: sender.role === 'creator' || sender.role === 'teacher' ? 'teacher' : 'student',
      content: data.content,
      created_at: data.created_at,
    }

    return { message, error: null }
  } catch (err: unknown) {
    return { message: null, error: err instanceof Error ? err : new Error(String(err)) }
  }
}

export function subscribeToCourseChat(
  client: SupabaseClient = defaultClient,
  courseId: string,
  onNewMessage: (msg: LivePortalChatMessage) => void
) {
  const channel = client
    .channel(`course_portal_chat_${courseId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'course_portal_chats',
        filter: `course_id=eq.${courseId}`,
      },
      async (payload) => {
        const newRow = payload.new as { id: string; sender_id: string; content: string; created_at: string }
        if (!newRow) return

        const { data: sender } = await client
          .from('users')
          .select('name, role')
          .eq('id', newRow.sender_id)
          .maybeSingle()

        const chatMsg: LivePortalChatMessage = {
          id: newRow.id,
          sender_id: newRow.sender_id,
          sender_name: sender?.name || 'Thành viên lớp',
          sender_role: sender?.role === 'creator' || sender?.role === 'teacher' ? 'teacher' : 'student',
          content: newRow.content,
          created_at: newRow.created_at,
        }

        onNewMessage(chatMsg)
      }
    )
    .subscribe()

  return () => {
    client.removeChannel(channel)
  }
}
