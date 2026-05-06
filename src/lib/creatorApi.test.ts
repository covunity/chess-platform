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
} from './creatorApi'
import type { CourseStatus, CreateCourseInput, CreateChapterInput, CreateLessonInput } from './creatorApi'

// ── Supabase client mock ──────────────────────────────────────────────────

function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'order', 'single', 'in', 'neq', 'returns']
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
