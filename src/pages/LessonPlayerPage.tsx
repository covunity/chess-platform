import { useEffect, useRef, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { getCourseDetail, checkUserEnrollment } from '../lib/coursesApi'
import { getFirstLesson, getLastViewedLesson } from '../lib/enrollmentApi'
import { getLessonForPlayer, getVideoPlaybackInfo, markLessonCompleted } from '../lib/lessonPlayerApi'
import type { PlayerLesson } from '../lib/lessonPlayerApi'
import { getPendingOrderForCourse } from '../lib/orderApi'
import { canAccessLesson } from '../lib/accessControl'
import VideoView from '../components/VideoView'
import type { CourseDetail, CourseDetailChapter } from '../lib/coursesApi'
import { addBookmark, deleteBookmark, getBookmarkForLesson, resolveBookmark } from '../lib/bookmarkApi'
import type { BookmarkRow } from '../lib/bookmarkApi'
import { parsePgn } from '../utils/parsePgn'
import GuidedChessPlayer from '../components/GuidedChessPlayer/GuidedChessPlayer'
import PaywallSheet from '../components/PaywallSheet'
import ThemeToggle from '../components/ThemeToggle'

type LoadState = 'loading' | 'redirect-course' | 'redirect-lesson' | 'ready'

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function ChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6l4 4 4-4" />
    </svg>
  )
}

function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4l4 4-4 4" />
    </svg>
  )
}


function BookmarkIcon({ filled = false }: { filled?: boolean }) {
  if (filled) {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" stroke="none">
        <path d="M4 2h8a1 1 0 0 1 1 1v11l-5-3-5 3V3a1 1 0 0 1 1-1z" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2h8a1 1 0 0 1 1 1v11l-5-3-5 3V3a1 1 0 0 1 1-1z" />
    </svg>
  )
}

function VideoIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5,3 14,8 5,13" />
    </svg>
  )
}

function ChessIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="8" height="12" rx="1" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function lessonTypeIcon(type: string) {
  if (type === 'video') return <VideoIcon />
  return <ChessIcon />
}

interface SidebarProps {
  course: CourseDetail
  currentLessonId: string
  expandedChapters: Set<string>
  onToggleChapter: (chapterId: string) => void
  onSelectLesson: (lessonId: string) => void
  isEnrolled: boolean
  isAdmin: boolean
  isCourseCreator: boolean
  onLockedLessonClick: () => void
}

function PlayerSidebar({ course, currentLessonId, expandedChapters, onToggleChapter, onSelectLesson, isEnrolled, isAdmin, isCourseCreator, onLockedLessonClick }: SidebarProps) {
  const { t } = useTranslation()
  const totalLessons = course.chapters.reduce((sum, ch) => sum + ch.lessons.length, 0)

  const completedLessons = 0

  return (
    <aside
      data-testid="player-sidebar"
      style={{
        width: 320,
        flexShrink: 0,
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
          <Link
            to={`/courses/${course.id}`}
            data-testid="sidebar-back-btn"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 16,
              height: 16,
              borderRadius: 'var(--r-sm)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--ink-3)',
              flexShrink: 0,
            }}
          >
            <ChevronLeft size={14} />
          </Link>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {t('player.courseLabel', 'KHÓA HỌC')}
          </div>
        </div>
        <div
          data-testid="sidebar-course-title"
          style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {course.title}
        </div>
      </div>

      {/* Progress */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{t('player.courseProgress', 'Tiến độ khóa học')}</span>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-1)' }}>{completedLessons} / {totalLessons}</span>
        </div>
        <div
          data-testid="progress-bar"
          style={{ height: 4, background: 'var(--surface-3)', borderRadius: 999, overflow: 'hidden' }}
        >
          <div style={{ height: '100%', width: `${totalLessons > 0 ? (completedLessons / totalLessons) * 100 : 0}%`, background: 'var(--accent)', borderRadius: 999 }} />
        </div>
      </div>

      {/* Chapter list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {course.chapters.map((chapter: CourseDetailChapter) => {
          const isExpanded = expandedChapters.has(chapter.id)
          const completedInChapter = 0
          return (
            <div key={chapter.id}>
              <button
                data-testid={`chapter-item-${chapter.id}`}
                onClick={() => onToggleChapter(chapter.id)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '12px 20px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ color: 'var(--ink-3)', flexShrink: 0 }}>
                  {isExpanded ? <ChevronDown /> : <ChevronRight />}
                </span>
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)', minWidth: 0 }}>
                  {t('player.chapterLabel', 'Chương {{n}} · {{title}}', { n: chapter.position + 1, title: chapter.title })}
                </span>
                <span style={{ fontSize: 11, color: 'var(--ink-3)', flexShrink: 0 }}>
                  {completedInChapter}/{chapter.lessons.length}
                </span>
              </button>

              {isExpanded && chapter.lessons.map(lesson => {
                const isCurrent = lesson.id === currentLessonId
                const isLocked = !lesson.free_preview && !isEnrolled && !isAdmin && !isCourseCreator
                return (
                  <button
                    key={lesson.id}
                    data-testid={`lesson-item-${lesson.id}`}
                    data-current={isCurrent ? 'true' : 'false'}
                    data-locked={isLocked ? 'true' : 'false'}
                    onClick={() => isLocked ? onLockedLessonClick() : onSelectLesson(lesson.id)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 20px 8px 62px',
                      background: isCurrent ? 'var(--accent-soft)' : 'transparent',
                      border: 'none',
                      borderLeft: isCurrent ? '2px solid var(--accent)' : '2px solid transparent',
                      cursor: isLocked ? 'not-allowed' : 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      background: isCurrent ? 'transparent' : 'var(--surface-2)',
                      border: isCurrent ? '2px solid var(--accent)' : 'none',
                      color: 'var(--ink-4)',
                    }}>
                      {isLocked ? <LockIcon /> : lessonTypeIcon(lesson.type)}
                    </span>
                    <span style={{
                      flex: 1,
                      fontSize: 12.5,
                      color: isLocked ? 'var(--ink-3)' : isCurrent ? 'var(--accent-ink)' : 'var(--ink-1)',
                      fontWeight: isCurrent ? 600 : 400,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {lesson.title}
                    </span>
                    <span style={{ fontSize: 10.5, color: 'var(--ink-4)', flexShrink: 0 }}>
                      {formatDuration(lesson.duration_seconds)}
                    </span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </aside>
  )
}

export default function LessonPlayerPage() {
  const { courseId, lessonId } = useParams<{ courseId: string; lessonId?: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { user, loading: authLoading, profile } = useAuth()

  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [course, setCourse] = useState<CourseDetail | null>(null)
  const [currentLessonId, setCurrentLessonId] = useState<string>('')
  const [adminWatermark, setAdminWatermark] = useState(false)
  const [isEnrolled, setIsEnrolled] = useState(false)
  const [isCourseCreator, setIsCourseCreator] = useState(false)
  const [showSidebarPaywall, setShowSidebarPaywall] = useState(false)
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set())
  const initializedCourseRef = useRef<string | null>(null)
  const [showToast, setShowToast] = useState(false)
  const [playerState, setPlayerState] = useState<{ lessonId: string; lesson: PlayerLesson; videoUrl: string | null; videoFormat: 'mp4' | 'hls'; videoError: string | null; videoCompleted: boolean } | null>(null)
  const playerLesson = playerState?.lessonId === currentLessonId ? playerState.lesson : null
  const videoUrl = playerState?.lessonId === currentLessonId ? playerState.videoUrl : null
  const videoFormat = playerState?.lessonId === currentLessonId ? playerState.videoFormat : 'mp4'
  const videoError = playerState?.lessonId === currentLessonId ? playerState.videoError : null
  const videoCompleted = playerState?.lessonId === currentLessonId ? playerState.videoCompleted : false
  const [fetchedBookmark, setFetchedBookmark] = useState<{ lessonId: string; bookmark: BookmarkRow | null } | null>(null)
  const currentBookmark = fetchedBookmark?.lessonId === currentLessonId ? fetchedBookmark.bookmark : null
  const [bookmarkToast, setBookmarkToast] = useState<{ moveLabel: string } | null>(null)
  const bookmarkToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Derive initialNodeId from bookmark when both lesson PGN and bookmark are loaded
  const initialNodeId = (() => {
    if (!currentBookmark || !playerLesson?.pgn_data) return undefined
    const parsed = parsePgn(playerLesson.pgn_data)
    return resolveBookmark(parsed, currentBookmark)?.nodeId
  })()

  const enrolled = searchParams.get('enrolled') === 'true'

  useEffect(() => {
    if (authLoading) return
    if (!courseId) {
      navigate('/courses', { replace: true })
      return
    }

    let cancelled = false

    async function init() {
      const courseResult = await getCourseDetail(supabase, courseId!)
      if (cancelled) return

      if (!courseResult.course) {
        setLoadState('redirect-course')
        return
      }

      const courseData = courseResult.course
      setCourse(courseData)

      if (initializedCourseRef.current !== courseId) {
        setExpandedChapters(new Set(courseData.chapters.map((ch: { id: string }) => ch.id)))
        initializedCourseRef.current = courseId!
      }

      const allLessonsFlat = courseData.chapters.flatMap(ch => ch.lessons)

      // Resolve target lesson ID (handles resume routing when no lessonId in URL)
      let targetLessonId = lessonId
      if (!targetLessonId) {
        if (user) {
          const lastViewed = await getLastViewedLesson(supabase, courseId!, user.id)
          if (cancelled) return
          targetLessonId = lastViewed.lessonId ?? undefined
        }
        if (!targetLessonId) {
          const first = await getFirstLesson(supabase, courseId!)
          if (cancelled) return
          targetLessonId = first.lessonId ?? undefined
        }
        if (!targetLessonId) {
          setLoadState('redirect-course')
          return
        }
      }

      const lessonMeta = allLessonsFlat.find(l => l.id === targetLessonId)

      // Check enrollment and pending order only when a user is logged in
      let isEnrolled = false
      let hasPendingOrder = false
      if (user) {
        const [enrolledResult, pendingOrderResult] = await Promise.all([
          checkUserEnrollment(supabase, courseId!, user.id),
          getPendingOrderForCourse(supabase, courseId!, user.id),
        ])
        if (cancelled) return
        isEnrolled = enrolledResult
        hasPendingOrder = !!pendingOrderResult.order
        setIsEnrolled(enrolledResult)
      }

      const isCourseCreator = !!user && courseData.creator_id === user.id
      setIsCourseCreator(isCourseCreator)

      const accessDecision = canAccessLesson(
        profile?.role,
        isEnrolled,
        { free_preview: lessonMeta?.free_preview ?? false },
        hasPendingOrder,
        isCourseCreator
      )

      if (accessDecision === 'paywall') {
        navigate(`/courses/${courseId}?paywall=true`, { replace: true })
        return
      }

      if (accessDecision === 'pending-paywall') {
        navigate(`/courses/${courseId}?pendingOrder=true`, { replace: true })
        return
      }

      if (accessDecision === 'allow-admin') {
        setAdminWatermark(true)
      }

      setCurrentLessonId(targetLessonId)
      setLoadState('ready')

      if (enrolled) {
        setShowToast(true)
        setTimeout(() => setShowToast(false), 4000)
      }
    }

    init()
    return () => { cancelled = true }
  }, [authLoading, user, courseId, lessonId, enrolled, profile, navigate])

  // Redirect to course detail if not authorized
  useEffect(() => {
    if (loadState === 'redirect-course' && courseId) {
      navigate(`/courses/${courseId}`, { replace: true })
    }
  }, [loadState, courseId, navigate])

  function toggleChapter(chapterId: string) {
    setExpandedChapters(prev => {
      const next = new Set(prev)
      if (next.has(chapterId)) {
        next.delete(chapterId)
      } else {
        next.add(chapterId)
      }
      return next
    })
  }

  function selectLesson(newLessonId: string) {
    setCurrentLessonId(newLessonId)
    navigate(`/learn/${courseId}/${newLessonId}`, { replace: true })
  }

  // Load bookmark state when lesson changes
  useEffect(() => {
    if (loadState !== 'ready' || !user || !currentLessonId) return
    getBookmarkForLesson(supabase, { userId: user.id, lessonId: currentLessonId }).then(({ bookmark }) => {
      setFetchedBookmark({ lessonId: currentLessonId, bookmark })
    })
  }, [loadState, user, currentLessonId])

  // Load the current lesson's player data when it changes
  useEffect(() => {
    if (loadState !== 'ready' || !course || !currentLessonId) return

    const lesson = course.chapters
      .flatMap(ch => ch.lessons)
      .find(l => l.id === currentLessonId)

    if (!lesson) return

    let cancelled = false
    getLessonForPlayer(supabase, currentLessonId).then(({ lesson: pl }) => {
      if (cancelled || !pl) return
      if (pl.type === 'video') {
        getVideoPlaybackInfo(supabase, pl.id).then(({ url, format, error }) => {
          if (cancelled) return
          setPlayerState({ lessonId: currentLessonId, lesson: pl, videoUrl: error ? null : url, videoFormat: format ?? 'mp4', videoError: error ? error.message : null, videoCompleted: false })
        })
      } else {
        setPlayerState({ lessonId: currentLessonId, lesson: pl, videoUrl: null, videoFormat: 'mp4', videoError: null, videoCompleted: false })
      }
    })
    return () => { cancelled = true }
  }, [loadState, course, currentLessonId])

  async function handleBookmark(_nodeId: string, currentFen: string, depth: number, totalDepth: number) {
    if (!user || !currentLessonId || adminWatermark) return

    if (currentBookmark) {
      // Toggle off — remove existing bookmark
      await deleteBookmark(supabase, currentBookmark.id)
      setFetchedBookmark({ lessonId: currentLessonId, bookmark: null })
      return
    }

    const moveLabel = t('player.bookmarkMoveLabel', 'Move {{played}} of {{total}}', { played: depth, total: totalDepth })
    const { bookmark } = await addBookmark(supabase, {
      userId: user.id,
      lessonId: currentLessonId,
      pgnSnapshot: currentFen,
      nodeId: _nodeId !== 'root' ? _nodeId : undefined,
      playedPlies: depth,
    })
    if (bookmark) {
      setFetchedBookmark({ lessonId: currentLessonId, bookmark })
      if (bookmarkToastTimer.current) clearTimeout(bookmarkToastTimer.current)
      setBookmarkToast({ moveLabel })
      bookmarkToastTimer.current = setTimeout(() => {
        setBookmarkToast(null)
        bookmarkToastTimer.current = null
      }, 2000)
    }
  }

  async function handleLessonComplete() {
    if (!user || !courseId || !currentLessonId || adminWatermark) return
    await markLessonCompleted(supabase, {
      courseId,
      lessonId: currentLessonId,
      userId: user.id,
    })
  }

  function handleVideoTimeUpdate(currentTime: number, duration: number) {
    if (videoCompleted) return
    if (duration > 0 && currentTime / duration >= 0.8) {
      setPlayerState(prev => prev ? { ...prev, videoCompleted: true } : prev)
      handleLessonComplete()
    }
  }

  if (loadState === 'loading') {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'var(--ink-3)' }}>{t('player.loading', 'Đang tải...')}</span>
      </div>
    )
  }

  if (!course || loadState === 'redirect-course') {
    return null
  }

  const currentChapter = course.chapters.find(ch => ch.lessons.some(l => l.id === currentLessonId))
  const currentLesson = currentChapter?.lessons.find(l => l.id === currentLessonId)
  const allLessons = course.chapters.flatMap(ch => ch.lessons)
  const lessonIndex = allLessons.findIndex(l => l.id === currentLessonId)

  return (
    <div
      data-testid="lesson-player-layout"
      style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)', position: 'relative' }}
    >
      {/* Sidebar */}
      <PlayerSidebar
        course={course}
        currentLessonId={currentLessonId}
        expandedChapters={expandedChapters}
        onToggleChapter={toggleChapter}
        onSelectLesson={selectLesson}
        isEnrolled={isEnrolled}
        isAdmin={adminWatermark}
        isCourseCreator={isCourseCreator}
        onLockedLessonClick={() => setShowSidebarPaywall(true)}
      />

      {/* Right side */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {adminWatermark && (
          <div
            data-testid="admin-watermark"
            style={{
              position: 'absolute',
              top: 12,
              right: 16,
              zIndex: 500,
              background: 'var(--warning-soft)',
              color: 'var(--warning)',
              fontSize: 12,
              fontWeight: 500,
              padding: '4px 10px',
              borderRadius: 'var(--r-sm)',
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx={12} cy={12} r={3} />
            </svg>
            {t('player.adminWatermark')}
          </div>
        )}
        {/* Header bar */}
        <header
          data-testid="player-header"
          style={{
            height: 56,
            padding: '0 28px',
            background: 'var(--surface)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <nav data-testid="breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-3)', overflow: 'hidden' }}>
            <Link to={`/courses/${course.id}`} style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>
              {course.title}
            </Link>
            {currentChapter && (
              <>
                <span style={{ color: 'var(--ink-4)' }}>›</span>
                <span style={{ color: 'var(--ink-3)' }}>{currentChapter.title}</span>
              </>
            )}
            {currentLesson && (
              <>
                <span style={{ color: 'var(--ink-4)' }}>›</span>
                <span style={{ color: 'var(--ink-1)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {currentLesson.title}
                </span>
              </>
            )}
          </nav>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <ThemeToggle />
            <button
              data-testid="header-bookmark-btn"
              data-bookmarked={currentBookmark ? 'true' : 'false'}
              onClick={() => handleBookmark('root', playerLesson?.pgn_data ?? '', 0, 0)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                height: 32,
                padding: '0 12px',
                background: currentBookmark ? 'var(--accent-soft)' : 'var(--surface)',
                border: currentBookmark ? '1px solid var(--accent-border)' : '1px solid var(--border-strong)',
                borderRadius: 'var(--r-md)',
                cursor: 'pointer',
                fontSize: 13,
                color: currentBookmark ? 'var(--accent-ink)' : 'var(--ink-2)',
              }}
            >
              <BookmarkIcon filled={!!currentBookmark} />
              {t('player.bookmark', 'Bookmark')}
            </button>
          </div>
        </header>

        {/* Bookmark toast */}
        {bookmarkToast && (
          <div
            data-testid="bookmark-toast"
            style={{
              position: 'fixed',
              bottom: 28,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'var(--ink-1)',
              color: 'var(--ink-on-accent)',
              borderRadius: 'var(--r-md)',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: 'var(--sh-2)',
              zIndex: 300,
              fontSize: 14,
              animation: 'fadeInOut 2s ease forwards',
            }}
          >
            <BookmarkIcon filled />
            {t('player.bookmarkedToast', 'Đã bookmark · {{moveLabel}}', { moveLabel: bookmarkToast.moveLabel })}
            <button
              type="button"
              onClick={async () => {
                if (currentBookmark) {
                  await deleteBookmark(supabase, currentBookmark.id)
                  setFetchedBookmark({ lessonId: currentLessonId, bookmark: null })
                }
                setBookmarkToast(null)
              }}
              style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: 13, marginLeft: 4 }}
            >
              {t('player.bookmarkUndo', 'Hoàn tác')}
            </button>
          </div>
        )}

        {/* Enrollment toast */}
        {showToast && (
          <div
            data-testid="enrollment-toast"
            style={{
              position: 'absolute',
              top: 64,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)',
              padding: '10px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: 'var(--sh-2)',
              zIndex: 100,
              fontSize: 13.5,
              color: 'var(--ink-1)',
            }}
          >
            <span style={{ color: 'var(--success)', fontWeight: 600 }}>✓</span>
            {t('player.enrolledToast', 'Đã đăng ký · {{count}} bài học đã mở khóa', { count: course.lessons_count })}
          </div>
        )}

        {/* Content slot */}
        <div
          data-testid="lesson-content-slot"
          style={{ flex: 1, overflow: currentLesson?.type === 'chess' ? 'hidden' : 'auto', display: 'flex', alignItems: 'stretch', justifyContent: 'center' }}
        >
          {(currentLesson?.type === 'chess' || currentLesson?.type === 'puzzle') && playerLesson && playerLesson.id === currentLessonId ? (() => {
            const isPuzzle = currentLesson.type === 'puzzle'
            const isRewindLesson = !isPuzzle && !!playerLesson.rewind_source_id
            // Rewind sibling lessons live as their own row (#244): they always
            // open in interactive 'lesson' mode. Normal chess lessons stay in
            // Study (viewer) — read-only walkthrough. Puzzles keep their own
            // dedicated mode.
            const mode: 'lesson' | 'puzzle' | 'viewer' = isPuzzle
              ? 'puzzle'
              : isRewindLesson
                ? 'lesson'
                : 'viewer'
            return (
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <GuidedChessPlayer
                  key={currentLessonId}
                  lesson={playerLesson}
                  lessonNumber={lessonIndex + 1}
                  totalLessons={allLessons.length}
                  initialNodeId={initialNodeId}
                  mode={mode}
                  isRewindLesson={isRewindLesson}
                  supabaseClient={isPuzzle ? supabase : undefined}
                  onComplete={handleLessonComplete}
                  onBookmark={handleBookmark}
                />
              </div>
            )
          })() : currentLesson?.type === 'video' ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '28px 32px', gap: 16, overflowY: 'auto' }}>
              {videoError ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
                    <div style={{ fontSize: 14, color: 'var(--danger)' }}>{videoError}</div>
                  </div>
                </div>
              ) : videoUrl ? (
                <>
                  <div style={{ position: 'relative', borderRadius: 'var(--r-lg)', overflow: 'hidden', background: '#0F1114', aspectRatio: '16/9', boxShadow: 'var(--sh-2)' }}>
                    <VideoView
                      url={videoUrl}
                      format={videoFormat}
                      controls
                      style={{ width: '100%', height: '100%', display: 'block' }}
                      onTimeUpdate={handleVideoTimeUpdate}
                    />
                    {videoCompleted && (
                      <div style={{ position: 'absolute', top: 12, right: 12, background: 'var(--success)', color: 'var(--ink-on-accent)', fontSize: 11.5, fontWeight: 500, padding: '4px 10px', borderRadius: 99, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span>✓</span> {t('player.markedComplete', 'Đã hoàn thành')}
                      </div>
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                      {t('player.lessonCounter', 'BÀI {{n}} / {{total}}', { n: lessonIndex + 1, total: allLessons.length })}
                    </div>
                    <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.015em' }}>
                      {currentLesson.title}
                    </h2>
                    {playerLesson?.description && (
                      <p style={{ marginTop: 12, fontSize: 14, lineHeight: 1.65, color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>
                        {playerLesson.description}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>{t('player.loading', 'Đang tải...')}</span>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🎯</div>
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>
                  {currentLesson?.title}
                </div>
                <div style={{ fontSize: 13 }}>{t('player.contentPlaceholder', 'Nội dung bài học sẽ hiển thị ở đây')}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showSidebarPaywall && course && (
        <PaywallSheet
          onClose={() => setShowSidebarPaywall(false)}
          course={course}
          isLoggedIn={!!user}
          onPurchase={() => {
            setShowSidebarPaywall(false)
            navigate(`/courses/${courseId}#buy-card`)
          }}
        />
      )}
    </div>
  )
}