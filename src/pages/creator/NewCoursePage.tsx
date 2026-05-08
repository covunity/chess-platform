import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { createCourse } from '../../lib/creatorApi'
import type { CourseLevel } from '../../lib/creatorApi'
import { useAuth } from '../../context/AuthContext'
import { useAccountTiers, computeFeeFloor } from '../../lib/accountTiers'

const MAX_TITLE = 200
const MAX_TAGS = 10
const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024

export default function NewCoursePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { getTier } = useAccountTiers()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState(0)
  const [level, setLevel] = useState<CourseLevel>('beginner')
  const [language, setLanguage] = useState<'vi' | 'en'>('vi')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [thumbnail, setThumbnail] = useState<File | null>(null)
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null)
  const [titleError, setTitleError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function parseTags(raw: string): string[] {
    return raw
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)
      .slice(0, MAX_TAGS)
  }

  function commitTags() {
    if (!tagInput.trim()) return
    const incoming = parseTags(tagInput)
    setTags(prev => {
      const merged = [...prev, ...incoming.filter(t => !prev.includes(t))]
      return merged.slice(0, MAX_TAGS)
    })
    setTagInput('')
  }

  function removeTag(tag: string) {
    setTags(prev => prev.filter(t => t !== tag))
  }

  function handleThumbnailFile(file: File) {
    if (!file.type.startsWith('image/') || file.size > MAX_THUMBNAIL_BYTES) return
    setThumbnail(file)
    const url = URL.createObjectURL(file)
    setThumbnailPreview(url)
  }

  function validate(): boolean {
    if (!title.trim()) {
      setTitleError(t('creator.newCourse.validationTitle'))
      return false
    }
    if (title.length > MAX_TITLE) {
      setTitleError(t('creator.newCourse.validationTitleMax'))
      return false
    }
    setTitleError('')
    return true
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate() || !profile?.id) return
    setSubmitting(true)

    let thumbnail_url: string | undefined
    if (thumbnail) {
      const ext = thumbnail.name.split('.').pop()
      const path = `${profile.id}/${Date.now()}.${ext}`
      const { data } = await supabase.storage.from('thumbnails').upload(path, thumbnail)
      if (data) {
        const { data: urlData } = supabase.storage.from('thumbnails').getPublicUrl(path)
        thumbnail_url = urlData.publicUrl
      }
    }

    const { course, error } = await createCourse(supabase, profile.id, {
      title: title.trim(),
      description: description || undefined,
      thumbnail_url,
      price,
      level,
      language,
      tags,
    })

    setSubmitting(false)
    if (!error && course) {
      navigate(`/creator/courses/${course.id}/edit`)
    }
  }

  return (
    <div className="flex items-start justify-center px-6 py-10">
      <div className="card w-full" style={{ maxWidth: 720, padding: 32, borderRadius: 'var(--r-lg)' }}>
        <h1
          className="text-(--ink-1) mb-8"
          style={{ fontFamily: 'var(--font-serif)', fontSize: 28, lineHeight: 1.2 }}
        >
          {t('creator.newCourse.heading')}
        </h1>

        <form onSubmit={handleSubmit} noValidate>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Title */}
            <div>
              <label className="label" htmlFor="course-title">{t('creator.newCourse.labelTitle')}</label>
              <input
                id="course-title"
                data-testid="course-title-input"
                type="text"
                className="input"
                value={title}
                maxLength={MAX_TITLE + 1}
                onChange={e => { setTitle(e.target.value); setTitleError('') }}
              />
              {titleError && (
                <p data-testid="title-error" className="text-xs mt-1" style={{ color: 'var(--danger)' }}>
                  {titleError}
                </p>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="label" htmlFor="course-description">{t('creator.newCourse.labelDescription')}</label>
              <textarea
                id="course-description"
                data-testid="course-description-input"
                className="input"
                style={{ height: 120, resize: 'vertical', paddingTop: 10, paddingBottom: 10 }}
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
              <p className="text-xs mt-1 text-(--ink-3)">{t('creator.newCourse.descriptionHelper')}</p>
            </div>

            {/* Thumbnail */}
            <div>
              <label className="label">{t('creator.newCourse.labelThumbnail')}</label>
              <div
                data-testid="thumbnail-upload-zone"
                className="flex flex-col items-center justify-center cursor-pointer text-(--ink-4)"
                style={{ border: '2px dashed var(--border-strong)', borderRadius: 'var(--r-md)', width: 220, height: 140, fontSize: 13 }}
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault()
                  const file = e.dataTransfer.files[0]
                  if (file) handleThumbnailFile(file)
                }}
              >
                {thumbnailPreview ? (
                  <img src={thumbnailPreview} alt="thumbnail preview" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--r-md)' }} />
                ) : (
                  <span>{t('creator.newCourse.thumbnailHint')}</span>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png"
                style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleThumbnailFile(f) }}
              />
            </div>

            {/* Price */}
            <div>
              <label className="label" htmlFor="course-price">{t('creator.newCourse.labelPrice')}</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)', fontSize: 14 }}>₫</span>
                <input
                  id="course-price"
                  data-testid="course-price-input"
                  type="number"
                  className="input"
                  style={{ paddingLeft: 28 }}
                  value={price}
                  min={0}
                  step={1000}
                  onChange={e => setPrice(Math.max(0, parseInt(e.target.value) || 0))}
                />
              </div>
              <p className="text-xs mt-1 text-(--ink-3)">{t('creator.newCourse.priceHelper')}</p>
              {/* Real-time fee preview based on creator's current tier */}
              {profile?.account_tier_id && (() => {
                const tier = getTier(profile.account_tier_id)
                if (!tier) return null
                const feePct = tier.platform_fee_pct
                if (price === 0) {
                  return (
                    <p data-testid="fee-preview" className="text-xs mt-1" style={{ color: 'var(--success)' }}>
                      {t('creator.newCourse.feePreview.free')}
                    </p>
                  )
                }
                const feeAmount = computeFeeFloor(price, feePct)
                const payoutAmount = price - feeAmount
                return (
                  <p data-testid="fee-preview" className="text-xs mt-1 text-(--ink-2)">
                    {t('creator.newCourse.feePreview.label')}{' '}
                    <span className="font-medium">
                      {t('creator.newCourse.feePreview.pct', { pct: feePct })}{' '}
                      {t('creator.newCourse.feePreview.feeAmount', { amount: feeAmount.toLocaleString('vi-VN') })}
                    </span>
                    {' · '}
                    {t('creator.newCourse.feePreview.youReceive')}{' '}
                    <span className="font-semibold" style={{ color: 'var(--success)' }}>
                      {t('creator.newCourse.feePreview.payoutAmount', { amount: payoutAmount.toLocaleString('vi-VN') })}
                    </span>
                  </p>
                )
              })()}
            </div>

            {/* Level + Language row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="label" htmlFor="course-level">{t('creator.newCourse.labelLevel')}</label>
                <select
                  id="course-level"
                  data-testid="course-level-select"
                  className="input"
                  value={level}
                  onChange={e => setLevel(e.target.value as CourseLevel)}
                >
                  <option value="beginner">{t('creator.newCourse.levelBeginner')}</option>
                  <option value="intermediate">{t('creator.newCourse.levelIntermediate')}</option>
                  <option value="advanced">{t('creator.newCourse.levelAdvanced')}</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="course-language">{t('creator.newCourse.labelLanguage')}</label>
                <select
                  id="course-language"
                  data-testid="course-language-select"
                  className="input"
                  value={language}
                  onChange={e => setLanguage(e.target.value as 'vi' | 'en')}
                >
                  <option value="vi">{t('creator.newCourse.languageVi')}</option>
                  <option value="en">{t('creator.newCourse.languageEn')}</option>
                </select>
              </div>
            </div>

            {/* Tags */}
            <div>
              <label className="label" htmlFor="course-tags">{t('creator.newCourse.labelTags')}</label>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {tags.map(tag => (
                    <span key={tag} className="pill pill-accent" style={{ gap: 4 }}>
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        style={{ marginLeft: 4, fontWeight: 700, cursor: 'pointer', background: 'none', border: 'none', color: 'inherit', padding: 0 }}
                        aria-label={`remove ${tag}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <input
                id="course-tags"
                data-testid="course-tags-input"
                type="text"
                className="input"
                value={tagInput}
                placeholder={t('creator.newCourse.tagsHelper')}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault()
                    commitTags()
                  }
                }}
                onBlur={commitTags}
              />
              <p className="text-xs mt-1 text-(--ink-3)">{t('creator.newCourse.tagsHelper')}</p>
            </div>

          </div>

          {/* Footer buttons */}
          <div className="flex justify-between mt-8">
            <button
              type="button"
              data-testid="cancel-btn"
              className="btn btn-ghost"
              onClick={() => navigate(-1)}
            >
              {t('creator.newCourse.cancel')}
            </button>
            <button
              type="submit"
              data-testid="submit-course-btn"
              className="btn btn-primary"
              disabled={submitting}
            >
              {t('creator.newCourse.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
