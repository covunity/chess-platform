import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { listPublishedCourses } from '../lib/coursesApi'
import type { PublicCourse, SortOption } from '../lib/coursesApi'
import type { CourseLevel } from '../lib/creatorApi'
import CourseCard from '../components/CourseCard'
import ChessBoard from '../components/ChessBoard/ChessBoard'

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

const LEVELS: Array<{ key: CourseLevel | 'all'; labelKey: string }> = [
  { key: 'all', labelKey: 'home.levelAll' },
  { key: 'beginner', labelKey: 'home.levelBeginner' },
  { key: 'intermediate', labelKey: 'home.levelIntermediate' },
  { key: 'advanced', labelKey: 'home.levelAdvanced' },
]

import { POPULAR_TAGS as TAGS } from '../lib/popularTags'

function CourseSkeleton() {
  return (
    <div
      data-testid="course-skeleton"
      className="card"
      style={{ padding: 0, overflow: 'hidden' }}
    >
      <div style={{ aspectRatio: '16/10', background: 'var(--surface-2)' }} />
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ height: 18, background: 'var(--surface-2)', borderRadius: 4, width: '80%' }} />
        <div style={{ height: 14, background: 'var(--surface-2)', borderRadius: 4, width: '50%' }} />
        <div style={{ height: 12, background: 'var(--surface-2)', borderRadius: 4, width: '60%' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
          <div style={{ height: 22, width: 60, background: 'var(--surface-2)', borderRadius: 999 }} />
          <div style={{ height: 18, width: 70, background: 'var(--surface-2)', borderRadius: 4 }} />
        </div>
      </div>
    </div>
  )
}

export default function HomePage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [courses, setCourses] = useState<PublicCourse[]>([])
  const [loading, setLoading] = useState(true)

  const level = (searchParams.get('level') ?? 'all') as CourseLevel | 'all'
  const tag = searchParams.get('tag') ?? ''
  const sort = (searchParams.get('sort') ?? 'newest') as SortOption
  const q = searchParams.get('q') ?? ''

  useEffect(() => {
    listPublishedCourses(supabase, {
      q: q || undefined,
      level: level !== 'all' ? level : undefined,
      tag: tag || undefined,
      sort,
    }).then(({ courses: data }) => {
      setCourses(data)
      setLoading(false)
    })
  }, [q, level, tag, sort])

  function setLevel(val: CourseLevel | 'all') {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (val === 'all') next.delete('level')
      else next.set('level', val)
      return next
    })
  }

  function setTag(val: string) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (next.get('tag') === val) next.delete('tag')
      else next.set('tag', val)
      return next
    })
  }

  function clearFilters() {
    setSearchParams({})
  }

  return (
    <main>
      {/* Hero */}
      <section
        style={{
          padding: '60px 56px 36px',
          background: 'linear-gradient(180deg, var(--bg) 0%, var(--surface-2) 100%)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            maxWidth: 1280,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: '1.1fr 1fr',
            gap: 60,
            alignItems: 'center',
          }}
        >
          {/* Left */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--accent-ink)',
              }}
            >
              {t('home.eyebrow')}
            </span>

            <h1
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 64,
                lineHeight: 1.05,
                letterSpacing: '-0.025em',
                color: 'var(--ink-1)',
                margin: 0,
              }}
            >
              {t('home.heroHeadline1')}
              <br />
              <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>
                {t('home.heroHeadline2')}
              </em>
            </h1>

            <p
              style={{
                fontSize: 17,
                color: 'var(--ink-2)',
                maxWidth: 520,
                lineHeight: 1.55,
                margin: 0,
              }}
            >
              {t('home.heroSubparagraph')}
            </p>

            <div style={{ display: 'flex', gap: 12 }}>
              <button
                type="button"
                className="btn btn-accent btn-lg"
                onClick={() => (() => { const el = document.getElementById('course-section'); const navHeight = (document.querySelector('header[role="banner"]') as HTMLElement)?.offsetHeight ?? 0; if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - navHeight, behavior: 'smooth' }) })()}
              >
                {t('home.heroCta1')} →
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-lg"
                onClick={() => (() => { const el = document.getElementById('course-section'); const navHeight = (document.querySelector('header[role="banner"]') as HTMLElement)?.offsetHeight ?? 0; if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - navHeight, behavior: 'smooth' }) })()}
              >
                {t('home.heroCta2')}
              </button>
            </div>

            <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>
              {t('home.heroTrust')}
            </p>
          </div>

          {/* Right — decorative board */}
          <div
            style={{
              position: 'relative',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                background: 'radial-gradient(circle at center, oklch(0.85 0.07 200 / 0.4), transparent 60%)',
                borderRadius: '50%',
                width: 460,
                height: 460,
                position: 'absolute',
              }}
            />
            <div style={{ transform: 'rotate(-3deg)', boxShadow: '0 30px 80px rgba(20,22,26,0.18)', zIndex: 1 }}>
              <ChessBoard fen={INITIAL_FEN} size={400} showCoords={false} />
            </div>

            {/* Floating annotation card */}
            <div
              className="card"
              style={{
                position: 'absolute',
                top: 20,
                right: -20,
                width: 240,
                padding: 14,
                transform: 'rotate(4deg)',
                boxShadow: 'var(--sh-3)',
                zIndex: 2,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div
                  className="avatar"
                  style={{ background: 'oklch(0.85 0.07 200)', color: 'var(--ink-1)', fontSize: 12, fontWeight: 600, flexShrink: 0 }}
                >
                  A
                </div>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)' }}>
                  {t('home.heroAnnotationAuthor')}
                </span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-2)', fontStyle: 'italic', margin: 0, lineHeight: 1.5 }}>
                {t('home.heroAnnotation')}
              </p>
            </div>

            {/* Floating bookmark card */}
            <div
              className="card"
              style={{
                position: 'absolute',
                bottom: 20,
                left: -20,
                width: 200,
                padding: 12,
                transform: 'rotate(-2deg)',
                boxShadow: 'var(--sh-3)',
                zIndex: 2,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  background: 'var(--accent-soft)',
                  borderRadius: 'var(--r-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                🔖
              </div>
              <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                {t('home.heroBookmark')}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Filter section */}
      <section id="course-section"  style={{ padding: '32px 56px 0' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          {/* Title row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h2
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: 32,
                  lineHeight: 1.1,
                  color: 'var(--ink-1)',
                  margin: 0,
                }}
              >
                {t('home.browseAll')}
              </h2>
              <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '4px 0 0' }}>
                {t('home.coursesCount', { count: courses.length })}
              </p>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="button" className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="4" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="11" y1="18" x2="13" y2="18" />
                </svg>
                {t('home.filtersBtn')}
              </button>
              <select
                value={sort}
                onChange={e => {
                  setSearchParams(prev => {
                    const next = new URLSearchParams(prev)
                    next.set('sort', e.target.value)
                    return next
                  })
                }}
                style={{
                  width: 180,
                  height: 36,
                  padding: '0 10px',
                  borderRadius: 'var(--r-md)',
                  border: '1px solid var(--border-strong)',
                  fontSize: 13,
                  color: 'var(--ink-3)',
                  background: 'var(--surface)',
                }}
              >
                <option value="newest">{t('home.sortNewest')}</option>
                <option value="popular">{t('home.sortPopular')}</option>
                <option value="rating">{t('home.sortRating')}</option>
              </select>
            </div>
          </div>

          {/* Pills row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {LEVELS.map(lvl => (
              <button
                key={lvl.key}
                type="button"
                onClick={() => setLevel(lvl.key as CourseLevel | 'all')}
                style={{
                  height: 32,
                  padding: '0 14px',
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  border: 'none',
                  background: level === lvl.key ? 'var(--ink-1)' : 'var(--surface-2)',
                  color: level === lvl.key ? '#fff' : 'var(--ink-2)',
                  transition: 'background 0.15s',
                }}
              >
                {t(lvl.labelKey)}
              </button>
            ))}

            <div style={{ width: 1, height: 20, background: 'var(--border-strong)', margin: '0 4px' }} />

            {TAGS.map(tg => (
              <button
                key={tg.key}
                type="button"
                onClick={() => setTag(tg.key)}
                style={{
                  height: 32,
                  padding: '0 14px',
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  border: 'none',
                  background: tag === tg.key ? 'var(--accent)' : 'var(--surface-2)',
                  color: tag === tg.key ? '#fff' : 'var(--ink-2)',
                  transition: 'background 0.15s',
                }}
              >
                {t(tg.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Course grid */}
      <section style={{ padding: '32px 56px 64px' }}>
        <div
          data-testid="course-grid"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
          style={{ maxWidth: 1280, margin: '0 auto' }}
        >
          {loading ? (
            Array.from({ length: 9 }).map((_, i) => <CourseSkeleton key={i} />)
          ) : courses.length === 0 ? (
            <div
              style={{
                gridColumn: '1 / -1',
                textAlign: 'center',
                padding: '80px 0',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <h3
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: 28,
                  color: 'var(--ink-1)',
                  margin: 0,
                }}
              >
                {t('home.emptyHeading')}
              </h3>
              <p style={{ fontSize: 14, color: 'var(--ink-3)', margin: 0 }}>
                {t('home.emptySubtext')}
              </p>
              <button
                type="button"
                onClick={clearFilters}
                className="btn btn-secondary"
                style={{ marginTop: 8 }}
              >
                {t('home.emptyCtaClear')}
              </button>
            </div>
          ) : (
            courses.map(course => <CourseCard key={course.id} course={course} />)
          )}
        </div>
      </section>

      {/* Creator CTA */}
      <section
        data-testid="home-creator-cta"
        style={{
          padding: '64px 56px',
          background: 'var(--surface-2)',
          borderTop: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            maxWidth: 1280,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 24,
            alignItems: 'stretch',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--accent-ink)',
              }}
            >
              {t('home.creatorCta.eyebrow')}
            </span>
            <h2
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 36,
                lineHeight: 1.1,
                color: 'var(--ink-1)',
                margin: '12px 0 0',
              }}
            >
              {t('home.creatorCta.heading')}
            </h2>
            <p
              style={{
                fontSize: 15,
                color: 'var(--ink-2)',
                lineHeight: 1.55,
                marginTop: 16,
                maxWidth: 520,
              }}
            >
              {t('home.creatorCta.body')}
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center' }}>
            <Link
              to="/become-creator"
              data-testid="home-cta-become-creator"
              className="card"
              style={{
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                textDecoration: 'none',
                border: '1px solid var(--border-strong)',
                background: 'var(--surface)',
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)' }}>
                {t('home.creatorCta.individualCta')} →
              </span>
              <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                {t('home.creatorCta.individualHint')}
              </span>
            </Link>

            <Link
              to="/register-business?tier=business"
              data-testid="home-cta-register-business"
              className="card"
              style={{
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                textDecoration: 'none',
                border: '1px solid var(--accent-border)',
                background: 'var(--accent-soft)',
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--accent-ink)' }}>
                {t('home.creatorCta.businessCta')} →
              </span>
              <span style={{ fontSize: 13, color: 'var(--accent-ink)', opacity: 0.8 }}>
                {t('home.creatorCta.businessHint')}
              </span>
            </Link>
          </div>
        </div>
      </section>
    </main>
  )
}
