import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getLearnerStats,
  getEnrolledCoursesProgress,
  getRecommendedCourses,
} from './dashboardApi'

// ── helpers ─────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString()
}

function daysAgo(n: number): Date {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - n)
  return d
}

// A chainable, thenable mock builder. Mirrors how Supabase QueryBuilder
// behaves: chained calls return `this`, and awaiting it resolves to the
// configured result via `then`.
function makeBuilder(result: { data: unknown; error: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {
    select: vi.fn(() => b),
    eq: vi.fn(() => b),
    in: vi.fn(() => b),
    contains: vi.fn(() => b),
    order: vi.fn(() => b),
    limit: vi.fn(() => b),
    single: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (v: typeof result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return b
}

// ── getLearnerStats ─────────────────────────────────────────────────────

describe('getLearnerStats', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-06T12:00:00Z')) // a Wednesday
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('counts a 3-day current streak when last 3 days each have a completion', async () => {
    const completions = [
      { completed_at: isoDate(daysAgo(0)), lessons: { duration_seconds: 60 } },
      { completed_at: isoDate(daysAgo(1)), lessons: { duration_seconds: 60 } },
      { completed_at: isoDate(daysAgo(2)), lessons: { duration_seconds: 60 } },
    ]
    const client = makeStatsClient({ completions, bookmarks: [], enrollments: [] })

    const { stats } = await getLearnerStats(client, 'u1')
    expect(stats?.currentStreak).toBe(3)
  })

  it('breaks streak when a day has no completion', async () => {
    const completions = [
      { completed_at: isoDate(daysAgo(0)), lessons: { duration_seconds: 60 } },
      { completed_at: isoDate(daysAgo(2)), lessons: { duration_seconds: 60 } },
      { completed_at: isoDate(daysAgo(3)), lessons: { duration_seconds: 60 } },
    ]
    const client = makeStatsClient({ completions, bookmarks: [], enrollments: [] })

    const { stats } = await getLearnerStats(client, 'u1')
    expect(stats?.currentStreak).toBe(1)
    expect(stats?.bestStreak).toBe(2)
  })

  it('counts lessons completed this week (Mon → now) and last week', async () => {
    // System time: Wed 2026-05-06 12:00 UTC. ISO Mon = 2026-05-04.
    const completions = [
      { completed_at: '2026-05-04T08:00:00Z', lessons: { duration_seconds: 600 } }, // Mon — this week
      { completed_at: '2026-05-05T09:00:00Z', lessons: { duration_seconds: 600 } }, // Tue — this week
      { completed_at: '2026-05-03T20:00:00Z', lessons: { duration_seconds: 600 } }, // Sun — last week
      { completed_at: '2026-04-28T20:00:00Z', lessons: { duration_seconds: 600 } }, // last week
    ]
    const client = makeStatsClient({ completions, bookmarks: [], enrollments: [] })

    const { stats } = await getLearnerStats(client, 'u1')
    expect(stats?.lessonsThisWeek).toBe(2)
    expect(stats?.lessonsLastWeek).toBe(2)
  })

  it('sums duration_seconds of completed lessons into hoursStudied', async () => {
    const completions = [
      { completed_at: isoDate(daysAgo(0)), lessons: { duration_seconds: 1800 } }, // 0.5h
      { completed_at: isoDate(daysAgo(1)), lessons: { duration_seconds: 5400 } }, // 1.5h
    ]
    const client = makeStatsClient({ completions, bookmarks: [], enrollments: [] })

    const { stats } = await getLearnerStats(client, 'u1')
    expect(stats?.hoursStudied).toBeCloseTo(2, 5)
  })

  it('counts bookmarks and enrollments', async () => {
    const client = makeStatsClient({
      completions: [],
      bookmarks: [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }],
      enrollments: [{ course_id: 'c1' }, { course_id: 'c2' }],
    })

    const { stats } = await getLearnerStats(client, 'u1')
    expect(stats?.bookmarksCount).toBe(3)
    expect(stats?.coursesCount).toBe(2)
  })

  it('returns zeros when user has no activity', async () => {
    const client = makeStatsClient({ completions: [], bookmarks: [], enrollments: [] })
    const { stats, error } = await getLearnerStats(client, 'u1')
    expect(error).toBeNull()
    expect(stats).toEqual({
      currentStreak: 0,
      bestStreak: 0,
      lessonsThisWeek: 0,
      lessonsLastWeek: 0,
      bookmarksCount: 0,
      hoursStudied: 0,
      coursesCount: 0,
    })
  })
})

// ── getEnrolledCoursesProgress ──────────────────────────────────────────

describe('getEnrolledCoursesProgress', () => {
  it('returns my courses with progress and the next incomplete lesson', async () => {
    const enrollmentsRows = [
      {
        course_id: 'c1',
        enrolled_at: '2026-05-01T00:00:00Z',
        courses: {
          id: 'c1',
          title: 'Italian Game',
          thumbnail_url: null,
          level: 'beginner',
          users: { name: 'GM Anh' },
          chapters: [
            {
              id: 'ch1',
              position: 1,
              lessons: [
                { id: 'l1', title: 'Intro', position: 1 },
                { id: 'l2', title: 'Main line', position: 2 },
                { id: 'l3', title: 'Sidelines', position: 3 },
              ],
            },
          ],
        },
      },
    ]
    const completedRows = [{ lesson_id: 'l1' }]

    const client = makeEnrollmentsClient({ enrollmentsRows, completedRows })
    const { courses } = await getEnrolledCoursesProgress(client, 'u1')

    expect(courses).toHaveLength(1)
    expect(courses![0]).toMatchObject({
      course_id: 'c1',
      title: 'Italian Game',
      lessonsCount: 3,
      completedCount: 1,
      isComplete: false,
    })
    expect(courses![0].nextLesson).toEqual({ id: 'l2', title: 'Main line' })
  })

  it('marks course as complete and clears nextLesson when all lessons done', async () => {
    const enrollmentsRows = [
      {
        course_id: 'c2',
        enrolled_at: '2026-05-01T00:00:00Z',
        courses: {
          id: 'c2',
          title: 'Endgame',
          thumbnail_url: null,
          level: 'intermediate',
          users: { name: 'GM B' },
          chapters: [
            {
              id: 'ch2',
              position: 1,
              lessons: [
                { id: 'l1', title: 'A', position: 1 },
                { id: 'l2', title: 'B', position: 2 },
              ],
            },
          ],
        },
      },
    ]
    const completedRows = [{ lesson_id: 'l1' }, { lesson_id: 'l2' }]

    const client = makeEnrollmentsClient({ enrollmentsRows, completedRows })
    const { courses } = await getEnrolledCoursesProgress(client, 'u1')
    expect(courses![0].isComplete).toBe(true)
    expect(courses![0].nextLesson).toBeNull()
  })

  it('orders chapters and lessons by position', async () => {
    const enrollmentsRows = [
      {
        course_id: 'c3',
        enrolled_at: '2026-05-01T00:00:00Z',
        courses: {
          id: 'c3',
          title: 'Mixed',
          thumbnail_url: null,
          level: 'beginner',
          users: { name: 'GM C' },
          chapters: [
            {
              id: 'ch2',
              position: 2,
              lessons: [{ id: 'l-ch2-1', title: 'Z', position: 1 }],
            },
            {
              id: 'ch1',
              position: 1,
              lessons: [
                { id: 'l-ch1-2', title: 'Y', position: 2 },
                { id: 'l-ch1-1', title: 'X', position: 1 },
              ],
            },
          ],
        },
      },
    ]
    const client = makeEnrollmentsClient({ enrollmentsRows, completedRows: [] })
    const { courses } = await getEnrolledCoursesProgress(client, 'u1')
    expect(courses![0].nextLesson).toEqual({ id: 'l-ch1-1', title: 'X' })
  })
})

// ── getRecommendedCourses ───────────────────────────────────────────────

describe('getRecommendedCourses', () => {
  it('returns published courses (including paid) the user is not enrolled in, ranked by rating × enrollment_count, capped at limit', async () => {
    const publishedRows = [
      {
        id: 'c1',
        title: 'Already enrolled',
        price: 0,
        thumbnail_url: null,
        creator_id: 'u-creator',
        users: { name: 'GM A' },
        reviews: [{ rating: 5 }, { rating: 5 }],
        enrollments: [{ id: 'e1' }, { id: 'e2' }],
      },
      {
        id: 'c2',
        title: 'High rating high pop',
        price: 0,
        thumbnail_url: null,
        creator_id: 'u-creator',
        users: { name: 'GM A' },
        reviews: [{ rating: 5 }, { rating: 5 }, { rating: 5 }],
        enrollments: [{ id: 'e3' }, { id: 'e4' }, { id: 'e5' }, { id: 'e6' }],
      },
      {
        id: 'c3',
        title: 'Low pop',
        price: 0,
        thumbnail_url: null,
        creator_id: 'u-creator',
        users: { name: 'GM A' },
        reviews: [{ rating: 4 }],
        enrollments: [{ id: 'e7' }],
      },
      {
        id: 'c4',
        title: 'Mid',
        price: 0,
        thumbnail_url: null,
        creator_id: 'u-creator',
        users: { name: 'GM A' },
        reviews: [{ rating: 4 }, { rating: 4 }],
        enrollments: [{ id: 'e8' }, { id: 'e9' }],
      },
      {
        id: 'c5',
        title: 'Paid course',
        price: 50000,
        thumbnail_url: null,
        creator_id: 'u-creator',
        users: { name: 'GM A' },
        reviews: [{ rating: 5 }, { rating: 5 }],
        enrollments: [{ id: 'e10' }, { id: 'e11' }],
      },
    ]
    const userEnrollments = [{ course_id: 'c1' }]

    const client = makeRecommendedClient({ publishedRows, userEnrollments })
    const { courses } = await getRecommendedCourses(client, 'u1', 3)

    // c1 excluded (enrolled); c2 (5×4=20) > c5 (5×2=10) > c4 (4×2=8); c3 drops off limit
    expect(courses?.map(c => c.id)).toEqual(['c2', 'c5', 'c4'])
    expect(courses).toHaveLength(3)
  })

  it('returns empty list when no recommendations available', async () => {
    const client = makeRecommendedClient({ publishedRows: [], userEnrollments: [] })
    const { courses, error } = await getRecommendedCourses(client, 'u1', 3)
    expect(error).toBeNull()
    expect(courses).toEqual([])
  })
})

// ── mock builders (per-table) ───────────────────────────────────────────

function makeStatsClient(args: {
  completions: Array<{ completed_at: string; lessons: { duration_seconds: number } }>
  bookmarks: Array<{ id: string }>
  enrollments: Array<{ course_id: string }>
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'lesson_progress') return makeBuilder({ data: args.completions, error: null })
      if (table === 'bookmarks') return makeBuilder({ data: args.bookmarks, error: null })
      if (table === 'enrollments') return makeBuilder({ data: args.enrollments, error: null })
      return makeBuilder({ data: [], error: null })
    }),
  } as never
}

function makeEnrollmentsClient(args: {
  enrollmentsRows: unknown[]
  completedRows: Array<{ lesson_id: string }>
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'enrollments') return makeBuilder({ data: args.enrollmentsRows, error: null })
      if (table === 'lesson_progress') return makeBuilder({ data: args.completedRows, error: null })
      return makeBuilder({ data: [], error: null })
    }),
  } as never
}

function makeRecommendedClient(args: {
  publishedRows: unknown[]
  userEnrollments: Array<{ course_id: string }>
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'courses') return makeBuilder({ data: args.publishedRows, error: null })
      if (table === 'enrollments') return makeBuilder({ data: args.userEnrollments, error: null })
      return makeBuilder({ data: [], error: null })
    }),
  } as never
}
