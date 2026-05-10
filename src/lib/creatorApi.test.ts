import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  listCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  createChapter,
  updateChapter,
  deleteChapter,
  reorderChapters,
  createLesson,
  updateLesson,
  deleteLesson,
  reorderLessons,
  countCourseChildren,
  canPublishCourse,
  publishCourse,
  unpublishCourse,
  fetchCreatorKpis,
  fetchCoursesWithStats,
  submitCourseForReview,
  duplicateCourse,
} from './creatorApi'
import type { CourseStatus, CreateCourseInput, CreateChapterInput, CreateLessonInput } from './creatorApi'

// ── Supabase client mock ──────────────────────────────────────────────────

function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'order', 'single', 'in', 'neq', 'returns', 'head']
  methods.forEach(m => { chain[m] = vi.fn(() => chain) })
  ;(chain as { then: (r: (v: unknown) => unknown) => Promise<unknown> }).then = (resolve) => Promise.resolve(resolve(result))
  return chain
}

function makeClient(result: unknown = { data: null, error: null, count: null }) {
  const chain = makeChain(result)
  return { from: vi.fn(() => chain), _chain: chain }
}

// ── listCourses ───────────────────────────────────────────────────────────

describe('listCourses', () => {
  it('returns courses and total on success', async () => {
    const mockCourses = [
      { id: 'c1', title: 'Chess Basics', status: 'draft' as CourseStatus, creator_id: 'u1', price: 0, level: 'beginner', language: 'vi', tags: [], created_at: '', updated_at: '' },
    ]
    const client = makeClient({ data: mockCourses, count: 1, error: null })
    const result = await listCourses(client as never, 'u1')
    expect(result.courses).toEqual(mockCourses)
    expect(result.total).toBe(1)
    expect(result.error).toBeNull()
  })

  it('returns error when query fails', async () => {
    const client = makeClient({ data: null, count: null, error: new Error('db error') })
    const result = await listCourses(client as never, 'u1')
    expect(result.courses).toEqual([])
    expect(result.error).toBeInstanceOf(Error)
  })

  it('filters by status when provided', async () => {
    const client = makeClient({ data: [], count: 0, error: null })
    await listCourses(client as never, 'u1', { status: 'published' })
    expect(client.from).toHaveBeenCalledWith('courses')
  })
})

// ── createCourse ──────────────────────────────────────────────────────────

describe('createCourse', () => {
  it('returns the new course on success', async () => {
    const newCourse = { id: 'c2', title: 'Advanced Tactics', status: 'draft' as CourseStatus, creator_id: 'u1', price: 100000, level: 'advanced', language: 'en', tags: ['tactics'], created_at: '', updated_at: '' }
    const client = makeClient({ data: newCourse, error: null })
    const input: CreateCourseInput = { title: 'Advanced Tactics', price: 100000, level: 'advanced', language: 'en', tags: ['tactics'] }
    const result = await createCourse(client as never, 'u1', input)
    expect(result.course).toEqual(newCourse)
    expect(result.error).toBeNull()
  })

  it('returns error when insert fails', async () => {
    const client = makeClient({ data: null, error: new Error('insert failed') })
    const input: CreateCourseInput = { title: 'Bad course', price: 0, level: 'beginner', language: 'vi', tags: [] }
    const result = await createCourse(client as never, 'u1', input)
    expect(result.course).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
  })
})

// ── updateCourse ──────────────────────────────────────────────────────────

describe('updateCourse', () => {
  it('returns updated course on success', async () => {
    const updated = { id: 'c1', title: 'Updated Title', status: 'draft' as CourseStatus, creator_id: 'u1', price: 0, level: 'beginner', language: 'vi', tags: [], created_at: '', updated_at: '' }
    const client = makeClient({ data: updated, error: null })
    const result = await updateCourse(client as never, 'c1', { title: 'Updated Title' })
    expect(result.course).toEqual(updated)
    expect(result.error).toBeNull()
  })

  it('returns error on failure', async () => {
    const client = makeClient({ data: null, error: new Error('update failed') })
    const result = await updateCourse(client as never, 'c1', { title: 'x' })
    expect(result.course).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
  })
})

// ── deleteCourse ──────────────────────────────────────────────────────────

describe('deleteCourse', () => {
  it('returns null error on success', async () => {
    const client = makeClient({ error: null })
    const result = await deleteCourse(client as never, 'c1')
    expect(result.error).toBeNull()
  })

  it('returns error on failure', async () => {
    const client = makeClient({ error: new Error('delete failed') })
    const result = await deleteCourse(client as never, 'c1')
    expect(result.error).toBeInstanceOf(Error)
  })
})

// ── createChapter ─────────────────────────────────────────────────────────

describe('createChapter', () => {
  it('returns new chapter on success', async () => {
    const chapter = { id: 'ch1', course_id: 'c1', title: 'Chapter 1', position: 0, created_at: '' }
    const client = makeClient({ data: chapter, error: null })
    const input: CreateChapterInput = { title: 'Chapter 1', position: 0 }
    const result = await createChapter(client as never, 'c1', input)
    expect(result.chapter).toEqual(chapter)
    expect(result.error).toBeNull()
  })

  it('returns error when insert fails', async () => {
    const client = makeClient({ data: null, error: new Error('insert failed') })
    const result = await createChapter(client as never, 'c1', { title: 'Ch', position: 0 })
    expect(result.chapter).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
  })
})

// ── updateChapter ─────────────────────────────────────────────────────────

describe('updateChapter', () => {
  it('returns updated chapter on success', async () => {
    const updated = { id: 'ch1', course_id: 'c1', title: 'Renamed', position: 0, created_at: '' }
    const client = makeClient({ data: updated, error: null })
    const result = await updateChapter(client as never, 'ch1', { title: 'Renamed' })
    expect(result.chapter).toEqual(updated)
  })
})

// ── deleteChapter ─────────────────────────────────────────────────────────

describe('deleteChapter', () => {
  it('returns null error on success', async () => {
    const client = makeClient({ error: null })
    const result = await deleteChapter(client as never, 'ch1')
    expect(result.error).toBeNull()
  })
})

// ── reorderChapters ───────────────────────────────────────────────────────

describe('reorderChapters', () => {
  it('calls upsert and returns no error on success', async () => {
    const chain = makeChain({ error: null })
    const client = { from: vi.fn(() => chain) }
    const result = await reorderChapters(client as never, [{ id: 'ch1', position: 0 }, { id: 'ch2', position: 1 }])
    expect(result.error).toBeNull()
  })
})

// ── createLesson ──────────────────────────────────────────────────────────

describe('createLesson', () => {
  it('returns new lesson on success', async () => {
    const lesson = { id: 'l1', chapter_id: 'ch1', title: 'Lesson 1', type: 'video', position: 0, free_preview: false, created_at: '' }
    const client = makeClient({ data: lesson, error: null })
    const input: CreateLessonInput = { title: 'Lesson 1', type: 'video', position: 0, free_preview: false }
    const result = await createLesson(client as never, 'ch1', input)
    expect(result.lesson).toEqual(lesson)
    expect(result.error).toBeNull()
  })

  it('returns error on failure', async () => {
    const client = makeClient({ data: null, error: new Error('insert failed') })
    const result = await createLesson(client as never, 'ch1', { title: 'L', type: 'video', position: 0, free_preview: false })
    expect(result.lesson).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
  })
})

// ── updateLesson ──────────────────────────────────────────────────────────

describe('updateLesson', () => {
  it('returns updated lesson on success', async () => {
    const updated = { id: 'l1', chapter_id: 'ch1', title: 'Updated', type: 'video', position: 0, free_preview: true, created_at: '' }
    const client = makeClient({ data: updated, error: null })
    const result = await updateLesson(client as never, 'l1', { title: 'Updated', free_preview: true })
    expect(result.lesson).toEqual(updated)
  })
})

// ── deleteLesson ──────────────────────────────────────────────────────────

describe('deleteLesson', () => {
  it('returns null error on success', async () => {
    const client = makeClient({ error: null })
    const result = await deleteLesson(client as never, 'l1')
    expect(result.error).toBeNull()
  })
})

// ── reorderLessons ────────────────────────────────────────────────────────

describe('reorderLessons', () => {
  it('returns null error on success', async () => {
    const chain = makeChain({ error: null })
    const client = { from: vi.fn(() => chain) }
    const result = await reorderLessons(client as never, [{ id: 'l1', position: 0 }, { id: 'l2', position: 1 }])
    expect(result.error).toBeNull()
  })
})

// ── countCourseChildren ───────────────────────────────────────────────────

describe('countCourseChildren', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns chapter and lesson counts', async () => {
    const mockChapterIds = [{ id: 'ch1' }, { id: 'ch2' }, { id: 'ch3' }]
    const chapterChain = makeChain({ data: mockChapterIds, count: 3, error: null })
    const lessonChain = makeChain({ count: 14, error: null })
    let callCount = 0
    const client = {
      from: vi.fn(() => {
        callCount++
        return callCount === 1 ? chapterChain : lessonChain
      }),
    }
    const result = await countCourseChildren(client as never, 'c1')
    expect(result.chapters).toBe(3)
    expect(result.lessons).toBe(14)
  })
})

// ── canPublishCourse ──────────────────────────────────────────────────────

describe('canPublishCourse', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns ready=true when course has all fields and ≥1 chapter with ≥1 lesson', async () => {
    const courseChain = makeChain({ data: { title: 'My Course', description: 'Great course', thumbnail_url: 'http://img.jpg', price: 100000, status: 'draft' }, error: null })
    const chapterChain = makeChain({ data: [{ id: 'ch1' }], error: null })
    const lessonChain = makeChain({ count: 3, error: null })
    let callCount = 0
    const client = {
      from: vi.fn(() => {
        callCount++
        if (callCount === 1) return courseChain
        if (callCount === 2) return chapterChain
        return lessonChain
      }),
    }
    const result = await canPublishCourse(client as never, 'c1')
    expect(result.ready).toBe(true)
    expect(result.reasons).toHaveLength(0)
  })

  it('returns ready=false with missing_title when title is empty', async () => {
    const courseChain = makeChain({ data: { title: '', description: 'Desc', thumbnail_url: 'http://img.jpg', price: 0, status: 'draft' }, error: null })
    const chapterChain = makeChain({ data: [{ id: 'ch1' }], error: null })
    const lessonChain = makeChain({ count: 1, error: null })
    let callCount = 0
    const client = {
      from: vi.fn(() => {
        callCount++
        if (callCount === 1) return courseChain
        if (callCount === 2) return chapterChain
        return lessonChain
      }),
    }
    const result = await canPublishCourse(client as never, 'c1')
    expect(result.ready).toBe(false)
    expect(result.reasons).toContain('missing_title')
  })

  it('returns ready=false with missing_description when description is null', async () => {
    const courseChain = makeChain({ data: { title: 'Title', description: null, thumbnail_url: 'http://img.jpg', price: 0, status: 'draft' }, error: null })
    const chapterChain = makeChain({ data: [{ id: 'ch1' }], error: null })
    const lessonChain = makeChain({ count: 1, error: null })
    let callCount = 0
    const client = {
      from: vi.fn(() => {
        callCount++
        if (callCount === 1) return courseChain
        if (callCount === 2) return chapterChain
        return lessonChain
      }),
    }
    const result = await canPublishCourse(client as never, 'c1')
    expect(result.ready).toBe(false)
    expect(result.reasons).toContain('missing_description')
  })

  it('returns ready=false with missing_thumbnail when thumbnail_url is empty', async () => {
    const courseChain = makeChain({ data: { title: 'Title', description: 'Desc', thumbnail_url: '', price: 0, status: 'draft' }, error: null })
    const chapterChain = makeChain({ data: [{ id: 'ch1' }], error: null })
    const lessonChain = makeChain({ count: 1, error: null })
    let callCount = 0
    const client = {
      from: vi.fn(() => {
        callCount++
        if (callCount === 1) return courseChain
        if (callCount === 2) return chapterChain
        return lessonChain
      }),
    }
    const result = await canPublishCourse(client as never, 'c1')
    expect(result.ready).toBe(false)
    expect(result.reasons).toContain('missing_thumbnail')
  })

  it('returns ready=false with no_chapters when course has no chapters', async () => {
    const courseChain = makeChain({ data: { title: 'Title', description: 'Desc', thumbnail_url: 'http://img.jpg', price: 0, status: 'draft' }, error: null })
    const chapterChain = makeChain({ data: [], error: null })
    let callCount = 0
    const client = {
      from: vi.fn(() => {
        callCount++
        if (callCount === 1) return courseChain
        return chapterChain
      }),
    }
    const result = await canPublishCourse(client as never, 'c1')
    expect(result.ready).toBe(false)
    expect(result.reasons).toContain('no_chapters')
  })

  it('returns ready=false with no_lessons when chapters exist but no lessons', async () => {
    const courseChain = makeChain({ data: { title: 'Title', description: 'Desc', thumbnail_url: 'http://img.jpg', price: 0, status: 'draft' }, error: null })
    const chapterChain = makeChain({ data: [{ id: 'ch1' }], error: null })
    const lessonChain = makeChain({ count: 0, error: null })
    let callCount = 0
    const client = {
      from: vi.fn(() => {
        callCount++
        if (callCount === 1) return courseChain
        if (callCount === 2) return chapterChain
        return lessonChain
      }),
    }
    const result = await canPublishCourse(client as never, 'c1')
    expect(result.ready).toBe(false)
    expect(result.reasons).toContain('no_lessons')
  })

  it('returns course_not_found when course does not exist', async () => {
    const courseChain = makeChain({ data: null, error: new Error('not found') })
    const client = { from: vi.fn(() => courseChain) }
    const result = await canPublishCourse(client as never, 'nonexistent')
    expect(result.ready).toBe(false)
    expect(result.reasons).toContain('course_not_found')
  })

  it('returns status_not_draft when course is already published', async () => {
    const courseChain = makeChain({ data: { title: 'Title', description: 'Desc', thumbnail_url: 'http://img.jpg', price: 0, status: 'published' }, error: null })
    const chapterChain = makeChain({ data: [{ id: 'ch1' }], error: null })
    const lessonChain = makeChain({ count: 1, error: null })
    let callCount = 0
    const client = {
      from: vi.fn(() => {
        callCount++
        if (callCount === 1) return courseChain
        if (callCount === 2) return chapterChain
        return lessonChain
      }),
    }
    const result = await canPublishCourse(client as never, 'c1')
    expect(result.ready).toBe(false)
    expect(result.reasons).toContain('status_not_draft')
  })

  it('accumulates multiple missing-field reasons', async () => {
    const courseChain = makeChain({ data: { title: '', description: null, thumbnail_url: null, price: 0, status: 'draft' }, error: null })
    const chapterChain = makeChain({ data: [], error: null })
    let callCount = 0
    const client = {
      from: vi.fn(() => {
        callCount++
        if (callCount === 1) return courseChain
        return chapterChain
      }),
    }
    const result = await canPublishCourse(client as never, 'c1')
    expect(result.ready).toBe(false)
    expect(result.reasons).toContain('missing_title')
    expect(result.reasons).toContain('missing_description')
    expect(result.reasons).toContain('missing_thumbnail')
    expect(result.reasons).toContain('no_chapters')
  })
})

// ── publishCourse ─────────────────────────────────────────────────────────

describe('publishCourse', () => {
  it('returns updated course with published status on success', async () => {
    const updated = { id: 'c1', title: 'My Course', status: 'published' as CourseStatus, creator_id: 'u1', price: 100000, level: 'beginner', language: 'vi', tags: [], description: 'Desc', thumbnail_url: 'http://img.jpg', created_at: '', updated_at: '' }
    const client = makeClient({ data: updated, error: null })
    const result = await publishCourse(client as never, 'c1')
    expect(result.course).toEqual(updated)
    expect(result.course?.status).toBe('published')
    expect(result.error).toBeNull()
  })

  it('returns error when course is not in draft status', async () => {
    const client = makeClient({ data: null, error: new Error('no rows updated') })
    const result = await publishCourse(client as never, 'c1')
    expect(result.course).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
  })

  it('calls update with correct status and eq filters', async () => {
    const chain = makeChain({ data: { id: 'c1', status: 'published' }, error: null })
    const client = { from: vi.fn(() => chain) }
    await publishCourse(client as never, 'c1')
    expect(client.from).toHaveBeenCalledWith('courses')
    expect(chain.update).toHaveBeenCalledWith({ status: 'published' })
  })
})

// ── unpublishCourse ───────────────────────────────────────────────────────

describe('unpublishCourse', () => {
  it('returns updated course with draft status on success', async () => {
    const updated = { id: 'c1', title: 'My Course', status: 'draft' as CourseStatus, creator_id: 'u1', price: 100000, level: 'beginner', language: 'vi', tags: [], description: 'Desc', thumbnail_url: 'http://img.jpg', created_at: '', updated_at: '' }
    const client = makeClient({ data: updated, error: null })
    const result = await unpublishCourse(client as never, 'c1')
    expect(result.course).toEqual(updated)
    expect(result.course?.status).toBe('draft')
    expect(result.error).toBeNull()
  })

  it('returns error when course is not in published status', async () => {
    const client = makeClient({ data: null, error: new Error('no rows updated') })
    const result = await unpublishCourse(client as never, 'c1')
    expect(result.course).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
  })

  it('calls update with draft status and published eq filter', async () => {
    const chain = makeChain({ data: { id: 'c1', status: 'draft' }, error: null })
    const client = { from: vi.fn(() => chain) }
    await unpublishCourse(client as never, 'c1')
    expect(client.from).toHaveBeenCalledWith('courses')
    expect(chain.update).toHaveBeenCalledWith({ status: 'draft' })
  })
})

// ── fetchCreatorKpis ──────────────────────────────────────────────────────

describe('fetchCreatorKpis', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns zeros when creator has no courses', async () => {
    const client = makeClient({ data: [], error: null })
    const result = await fetchCreatorKpis(client as never, 'u1')
    expect(result.totalStudents).toBe(0)
    expect(result.grossRevenue).toBe(0)
    expect(result.totalPayout).toBe(0)
    expect(result.avgRating).toBe(0)
    expect(result.courseCount).toBe(0)
  })

  it('returns correct distinct student count from enrollments', async () => {
    const chains = [
      makeChain({ data: [{ id: 'c1' }, { id: 'c2' }], error: null }),
      makeChain({ data: [{ user_id: 'u1' }, { user_id: 'u2' }, { user_id: 'u1' }], error: null }),
      makeChain({ data: [], error: null }),
      makeChain({ data: [], error: null }),
    ]
    let call = 0
    const client = { from: vi.fn(() => chains[call++]) }
    const result = await fetchCreatorKpis(client as never, 'u1')
    expect(result.totalStudents).toBe(2)
    expect(result.courseCount).toBe(2)
  })

  it('returns correct gross revenue and payout from active orders', async () => {
    const chains = [
      makeChain({ data: [{ id: 'c1' }], error: null }),
      makeChain({ data: [], error: null }),
      makeChain({ data: [{ amount: 100000, creator_payout: 80000 }, { amount: 200000, creator_payout: 160000 }], error: null }),
      makeChain({ data: [], error: null }),
    ]
    let call = 0
    const client = { from: vi.fn(() => chains[call++]) }
    const result = await fetchCreatorKpis(client as never, 'u1')
    expect(result.grossRevenue).toBe(300000)
    expect(result.totalPayout).toBe(240000)
  })

  it('returns correct average rating from published course reviews', async () => {
    const chains = [
      makeChain({ data: [{ id: 'c1' }], error: null }),
      makeChain({ data: [], error: null }),
      makeChain({ data: [], error: null }),
      makeChain({ data: [{ id: 'c1' }], error: null }),
      makeChain({ data: [{ rating: 4 }, { rating: 5 }, { rating: 3 }], error: null }),
    ]
    let call = 0
    const client = { from: vi.fn(() => chains[call++]) }
    const result = await fetchCreatorKpis(client as never, 'u1')
    expect(result.avgRating).toBeCloseTo(4.0)
  })

  it('returns avgRating 0 when no published courses', async () => {
    const chains = [
      makeChain({ data: [{ id: 'c1' }], error: null }),
      makeChain({ data: [], error: null }),
      makeChain({ data: [], error: null }),
      makeChain({ data: [], error: null }),
    ]
    let call = 0
    const client = { from: vi.fn(() => chains[call++]) }
    const result = await fetchCreatorKpis(client as never, 'u1')
    expect(result.avgRating).toBe(0)
  })
})

// ── fetchCoursesWithStats ─────────────────────────────────────────────────

describe('fetchCoursesWithStats', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns empty array when courseIds is empty', async () => {
    const client = makeClient({ data: [], error: null })
    const result = await fetchCoursesWithStats(client as never, [])
    expect(result).toEqual([])
    expect(client.from).not.toHaveBeenCalled()
  })

  it('returns per-course stats with distinct student count, revenue, rating', async () => {
    const chains = [
      makeChain({ data: [
        { course_id: 'c1', user_id: 'u1' },
        { course_id: 'c1', user_id: 'u2' },
        { course_id: 'c2', user_id: 'u1' },
      ], error: null }),
      makeChain({ data: [
        { course_id: 'c1', amount: 100000 },
        { course_id: 'c1', amount: 50000 },
      ], error: null }),
      makeChain({ data: [
        { course_id: 'c1', rating: 4 },
        { course_id: 'c1', rating: 5 },
      ], error: null }),
    ]
    let call = 0
    const client = { from: vi.fn(() => chains[call++]) }
    const result = await fetchCoursesWithStats(client as never, ['c1', 'c2'])
    const c1 = result.find(r => r.courseId === 'c1')
    const c2 = result.find(r => r.courseId === 'c2')
    expect(c1?.students).toBe(2)
    expect(c1?.revenue).toBe(150000)
    expect(c1?.rating).toBeCloseTo(4.5)
    expect(c2?.students).toBe(1)
    expect(c2?.revenue).toBe(0)
    expect(c2?.rating).toBeNull()
  })

  it('returns null rating when no reviews exist for a course', async () => {
    const chains = [
      makeChain({ data: [], error: null }),
      makeChain({ data: [], error: null }),
      makeChain({ data: [], error: null }),
    ]
    let call = 0
    const client = { from: vi.fn(() => chains[call++]) }
    const result = await fetchCoursesWithStats(client as never, ['c1'])
    expect(result[0].rating).toBeNull()
  })
})

// ── duplicateCourse ───────────────────────────────────────────────────────

describe('duplicateCourse', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns new course with "Copy of " title prefix and draft status on success', async () => {
    const original = {
      id: 'c1', creator_id: 'u1', title: 'Original', description: 'd', thumbnail_url: 't',
      price: 100, level: 'beginner', language: 'vi', tags: ['a'], status: 'published',
      created_at: '2026-01-01', updated_at: '2026-01-02',
    }
    const newCourse = {
      ...original, id: 'c1-copy', title: 'Copy of Original', status: 'draft' as CourseStatus,
      created_at: '2026-02-01', updated_at: '2026-02-01',
    }
    const chains = [
      makeChain({ data: original, error: null }),
      makeChain({ data: newCourse, error: null }),
      makeChain({ data: [], error: null }),
    ]
    let call = 0
    const client = { from: vi.fn(() => chains[call++]) }
    const result = await duplicateCourse(client as never, 'c1')
    expect(result.course?.title).toBe('Copy of Original')
    expect(result.course?.status).toBe('draft')
    expect(result.error).toBeNull()
  })

  it('inserts the new course with status=draft and Copy-of title', async () => {
    const original = {
      id: 'c1', creator_id: 'u1', title: 'Mỏ chiến thuật', description: 'd', thumbnail_url: 't',
      price: 0, level: 'beginner', language: 'vi', tags: [], status: 'draft',
      created_at: '', updated_at: '',
    }
    const newCourse = { ...original, id: 'c1-copy', title: 'Copy of Mỏ chiến thuật', status: 'draft' as CourseStatus }
    const insertChain = makeChain({ data: newCourse, error: null })
    const chains = [
      makeChain({ data: original, error: null }),
      insertChain,
      makeChain({ data: [], error: null }),
    ]
    let call = 0
    const client = { from: vi.fn(() => chains[call++]) }
    await duplicateCourse(client as never, 'c1')
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Copy of Mỏ chiến thuật', status: 'draft', creator_id: 'u1' })
    )
  })

  it('returns error when original course not found', async () => {
    const client = makeClient({ data: null, error: new Error('not found') })
    const result = await duplicateCourse(client as never, 'nonexistent')
    expect(result.course).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
  })

  it('returns error when insert of new course fails', async () => {
    const original = {
      id: 'c1', creator_id: 'u1', title: 'X', description: null, thumbnail_url: null,
      price: 0, level: 'beginner', language: 'vi', tags: [], status: 'draft',
      created_at: '', updated_at: '',
    }
    const chains = [
      makeChain({ data: original, error: null }),
      makeChain({ data: null, error: new Error('insert failed') }),
    ]
    let call = 0
    const client = { from: vi.fn(() => chains[call++]) }
    const result = await duplicateCourse(client as never, 'c1')
    expect(result.course).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
  })

  it('copies chapters and lessons under the new course', async () => {
    const original = {
      id: 'c1', creator_id: 'u1', title: 'Original', description: null, thumbnail_url: null,
      price: 0, level: 'beginner', language: 'vi', tags: [], status: 'draft',
      created_at: '', updated_at: '',
    }
    const newCourse = { ...original, id: 'c1-copy', title: 'Copy of Original', status: 'draft' as CourseStatus }
    const chapter1 = {
      id: 'ch1', course_id: 'c1', title: 'Ch1', position: 0, created_at: '',
      lessons: [
        { id: 'l1', chapter_id: 'ch1', title: 'L1', type: 'video', position: 0, free_preview: false, pgn_data: '', board_perspective: 'white', created_at: '' },
        { id: 'l2', chapter_id: 'ch1', title: 'L2', type: 'chess', position: 1, free_preview: true, pgn_data: '1. e4 e5', board_perspective: 'white', created_at: '' },
      ],
    }
    const newCh1 = { id: 'ch1-copy', course_id: 'c1-copy', title: 'Ch1', position: 0, created_at: '' }
    const lessonsInsertChain = makeChain({ data: null, error: null })
    const chains = [
      makeChain({ data: original, error: null }),
      makeChain({ data: newCourse, error: null }),
      makeChain({ data: [chapter1], error: null }),
      makeChain({ data: newCh1, error: null }),
      lessonsInsertChain,
    ]
    let call = 0
    const fromSpy = vi.fn(() => chains[call++])
    const client = { from: fromSpy }
    const result = await duplicateCourse(client as never, 'c1')
    expect(result.course?.id).toBe('c1-copy')
    expect(fromSpy).toHaveBeenCalledWith('chapters')
    expect(fromSpy).toHaveBeenCalledWith('lessons')
    // Lessons inserted in batch with new chapter_id
    const lessonsInsertCall = lessonsInsertChain.insert as unknown as { mock: { calls: unknown[][] } }
    expect(lessonsInsertCall.mock.calls.length).toBe(1)
    const inserted = lessonsInsertCall.mock.calls[0][0] as { chapter_id: string; title: string }[]
    expect(inserted).toHaveLength(2)
    expect(inserted.every(l => l.chapter_id === 'ch1-copy')).toBe(true)
    expect(inserted.every(l => !('id' in l))).toBe(true)
  })

  it('preserves video fields for video lessons when duplicating', async () => {
    const original = {
      id: 'c1', creator_id: 'u1', title: 'VidCourse', description: null, thumbnail_url: null,
      price: 0, level: 'beginner', language: 'vi', tags: [], status: 'draft',
      created_at: '', updated_at: '',
    }
    const newCourse = { ...original, id: 'c1-copy', title: 'Copy of VidCourse', status: 'draft' as CourseStatus }
    const videoLesson = {
      id: 'l1', chapter_id: 'ch1', title: 'Intro video', type: 'video', position: 0,
      free_preview: false, pgn_data: '', board_perspective: 'white', created_at: '',
      video_provider: 'supabase', video_provider_id: 'uid/l1/intro.mp4',
      video_status: 'ready', video_filename: 'intro.mp4',
      video_size_bytes: 8000000, video_mime: 'video/mp4', video_error: null,
      duration_seconds: 120,
    }
    const chapter1 = { id: 'ch1', course_id: 'c1', title: 'Ch1', position: 0, created_at: '', lessons: [videoLesson] }
    const newCh1 = { id: 'ch1-copy', course_id: 'c1-copy', title: 'Ch1', position: 0, created_at: '' }
    const lessonsInsertChain = makeChain({ data: null, error: null })
    const chains = [
      makeChain({ data: original, error: null }),
      makeChain({ data: newCourse, error: null }),
      makeChain({ data: [chapter1], error: null }),
      makeChain({ data: newCh1, error: null }),
      lessonsInsertChain,
    ]
    let call = 0
    const client = { from: vi.fn(() => chains[call++]) }
    await duplicateCourse(client as never, 'c1')
    const inserted = (lessonsInsertChain.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>[]
    expect(inserted[0].video_provider).toBe('supabase')
    expect(inserted[0].video_provider_id).toBe('uid/l1/intro.mp4')
    expect(inserted[0].video_status).toBe('ready')
    expect(inserted[0].video_filename).toBe('intro.mp4')
    expect(inserted[0].video_size_bytes).toBe(8000000)
    expect(inserted[0].video_mime).toBe('video/mp4')
    expect(inserted[0].duration_seconds).toBe(120)
  })

  it('duplicates mix of video + chess + puzzle lessons preserving type-specific fields', async () => {
    const original = {
      id: 'c1', creator_id: 'u1', title: 'Mix', description: null, thumbnail_url: null,
      price: 0, level: 'beginner', language: 'vi', tags: [], status: 'draft',
      created_at: '', updated_at: '',
    }
    const newCourse = { ...original, id: 'c1-copy', title: 'Copy of Mix', status: 'draft' as CourseStatus }
    const lessons = [
      {
        id: 'l1', chapter_id: 'ch1', title: 'Vid', type: 'video', position: 0,
        free_preview: false, pgn_data: '', board_perspective: 'white', created_at: '',
        video_provider: 'supabase', video_provider_id: 'uid/l1/vid.mp4',
        video_status: 'ready', video_filename: 'vid.mp4', video_size_bytes: 1000,
        video_mime: 'video/mp4', duration_seconds: 60,
      },
      {
        id: 'l2', chapter_id: 'ch1', title: 'Chess', type: 'chess', position: 1,
        free_preview: true, pgn_data: '1. e4 e5', board_perspective: 'black' as const, created_at: '',
        video_provider: null, video_provider_id: null, video_status: undefined,
      },
    ]
    const chapter1 = { id: 'ch1', course_id: 'c1', title: 'Ch1', position: 0, created_at: '', lessons }
    const newCh1 = { id: 'ch1-copy', course_id: 'c1-copy', title: 'Ch1', position: 0, created_at: '' }
    const lessonsInsertChain = makeChain({ data: null, error: null })
    const chains = [
      makeChain({ data: original, error: null }),
      makeChain({ data: newCourse, error: null }),
      makeChain({ data: [chapter1], error: null }),
      makeChain({ data: newCh1, error: null }),
      lessonsInsertChain,
    ]
    let call = 0
    const client = { from: vi.fn(() => chains[call++]) }
    await duplicateCourse(client as never, 'c1')
    const inserted = (lessonsInsertChain.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>[]
    expect(inserted).toHaveLength(2)
    // Video lesson retains video reference
    expect(inserted[0].video_provider_id).toBe('uid/l1/vid.mp4')
    expect(inserted[0].duration_seconds).toBe(60)
    // Chess lesson retains pgn_data and board_perspective
    expect(inserted[1].pgn_data).toBe('1. e4 e5')
    expect(inserted[1].board_perspective).toBe('black')
  })
})

// ── submitCourseForReview ─────────────────────────────────────────────────

describe('submitCourseForReview', () => {
  it('returns updated course with pending_review status on success', async () => {
    const updated = { id: 'c1', status: 'pending_review' as CourseStatus }
    const client = makeClient({ data: updated, error: null })
    const result = await submitCourseForReview(client as never, 'c1')
    expect(result.course?.status).toBe('pending_review')
    expect(result.error).toBeNull()
  })

  it('returns error when course is not in draft status', async () => {
    const client = makeClient({ data: null, error: new Error('no rows updated') })
    const result = await submitCourseForReview(client as never, 'c1')
    expect(result.course).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
  })

  it('calls update with pending_review status and draft eq filter', async () => {
    const chain = makeChain({ data: { id: 'c1', status: 'pending_review' }, error: null })
    const client = { from: vi.fn(() => chain) }
    await submitCourseForReview(client as never, 'c1')
    expect(client.from).toHaveBeenCalledWith('courses')
    expect(chain.update).toHaveBeenCalledWith({ status: 'pending_review' })
  })
})
