import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { fetchHeroConfig, updateHeroConfig } from '../../lib/heroConfigApi'
import type { HeroConfig } from '../../lib/heroConfigApi'

const EMPTY: HeroConfig = {
  eyebrow: '',
  headline1: '',
  headline2: '',
  subparagraph: '',
  cta1: '',
  trust: '',
  annotationAuthor: '',
  annotation: '',
  bookmark: '',
  imageUrl: '',
}

export default function AdminHeroConfigPage() {
  const { t } = useTranslation()
  const [inputs, setInputs] = useState<HeroConfig>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchHeroConfig(supabase)
      .then((cfg) => {
        if (cancelled) return
        setInputs(cfg)
        setLoadError(null)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setLoadError(t('admin.heroConfig.loadError'))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [t])

  function set(key: keyof HeroConfig, value: string) {
    setInputs((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setSaving(true)
    setSaveSuccess(false)
    setSaveError(null)
    const { error } = await updateHeroConfig(supabase, inputs)
    setSaving(false)
    if (error) {
      setSaveError(t('admin.heroConfig.errorMsg'))
      return
    }
    setSaveSuccess(true)
    if (successTimerRef.current) clearTimeout(successTimerRef.current)
    successTimerRef.current = setTimeout(() => setSaveSuccess(false), 4000)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 border-b border-(--border) bg-(--surface) shrink-0 gap-3"
        style={{ height: 60 }}
      >
        <h1 className="text-lg font-semibold text-(--ink-1)" style={{ letterSpacing: '-0.01em' }}>
          {t('admin.heroConfig.pageTitle')}
        </h1>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleSave}
          disabled={saving || loading}
          data-testid="hero-config-save-btn"
        >
          {saving ? t('admin.heroConfig.savingLabel') : t('admin.heroConfig.saveBtnLabel')}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <p className="text-sm text-(--ink-2) mb-6" style={{ lineHeight: 1.55 }}>
          {t('admin.heroConfig.intro')}
        </p>

        {loadError && (
          <div
            role="alert"
            style={{
              background: 'var(--danger-soft)',
              color: 'var(--danger)',
              borderRadius: 'var(--r-md)',
              padding: '10px 14px',
              fontSize: 13,
              marginBottom: 20,
            }}
          >
            {loadError}
          </div>
        )}

        {saveSuccess && (
          <div
            role="status"
            style={{
              background: 'var(--success-soft, #d1fae5)',
              color: 'var(--success, #065f46)',
              borderRadius: 'var(--r-md)',
              padding: '10px 14px',
              fontSize: 13,
              marginBottom: 20,
            }}
          >
            {t('admin.heroConfig.savedMsg')}
          </div>
        )}

        {saveError && (
          <div
            role="alert"
            style={{
              background: 'var(--danger-soft)',
              color: 'var(--danger)',
              borderRadius: 'var(--r-md)',
              padding: '10px 14px',
              fontSize: 13,
              marginBottom: 20,
            }}
          >
            {saveError}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {/* Text content section */}
          <div className="card" style={{ padding: 24 }}>
            <p className="font-semibold text-(--ink-1) mb-4" style={{ fontSize: 14 }}>
              {t('admin.heroConfig.sectionText')}
            </p>

            <Field
              id="hero-eyebrow"
              label={t('admin.heroConfig.eyebrowLabel')}
              value={inputs.eyebrow}
              onChange={(v) => set('eyebrow', v)}
              placeholder={t('home.eyebrow')}
              disabled={loading}
            />

            <Field
              id="hero-headline1"
              label={t('admin.heroConfig.headline1Label')}
              value={inputs.headline1}
              onChange={(v) => set('headline1', v)}
              placeholder={t('home.heroHeadline1')}
              disabled={loading}
            />

            <Field
              id="hero-headline2"
              label={t('admin.heroConfig.headline2Label')}
              hint={t('admin.heroConfig.headline2Hint')}
              value={inputs.headline2}
              onChange={(v) => set('headline2', v)}
              placeholder={t('home.heroHeadline2')}
              disabled={loading}
            />

            <Field
              id="hero-subparagraph"
              label={t('admin.heroConfig.subparagraphLabel')}
              value={inputs.subparagraph}
              onChange={(v) => set('subparagraph', v)}
              placeholder={t('home.heroSubparagraph')}
              disabled={loading}
              multiline
            />

            <Field
              id="hero-cta1"
              label={t('admin.heroConfig.cta1Label')}
              value={inputs.cta1}
              onChange={(v) => set('cta1', v)}
              placeholder={t('home.heroCta1')}
              disabled={loading}
            />

            <Field
              id="hero-trust"
              label={t('admin.heroConfig.trustLabel')}
              value={inputs.trust}
              onChange={(v) => set('trust', v)}
              placeholder={t('home.heroTrust')}
              disabled={loading}
              last
            />
          </div>

          {/* Floating cards section */}
          <div className="card" style={{ padding: 24 }}>
            <p className="font-semibold text-(--ink-1) mb-4" style={{ fontSize: 14 }}>
              {t('admin.heroConfig.sectionCards')}
            </p>
            <p className="text-xs text-(--ink-3) mb-4" style={{ lineHeight: 1.5 }}>
              {t('admin.heroConfig.cardsHint')}
            </p>

            <Field
              id="hero-annotation-author"
              label={t('admin.heroConfig.annotationAuthorLabel')}
              value={inputs.annotationAuthor}
              onChange={(v) => set('annotationAuthor', v)}
              placeholder={t('home.heroAnnotationAuthor')}
              disabled={loading}
            />

            <Field
              id="hero-annotation"
              label={t('admin.heroConfig.annotationLabel')}
              value={inputs.annotation}
              onChange={(v) => set('annotation', v)}
              placeholder={t('home.heroAnnotation')}
              disabled={loading}
              multiline
            />

            <Field
              id="hero-bookmark"
              label={t('admin.heroConfig.bookmarkLabel')}
              value={inputs.bookmark}
              onChange={(v) => set('bookmark', v)}
              placeholder={t('home.heroBookmark')}
              disabled={loading}
              last
            />
          </div>

          {/* Image section */}
          <div className="card" style={{ padding: 24 }}>
            <p className="font-semibold text-(--ink-1) mb-1" style={{ fontSize: 14 }}>
              {t('admin.heroConfig.sectionImage')}
            </p>
            <p className="text-xs text-(--ink-3) mb-4" style={{ lineHeight: 1.5 }}>
              {t('admin.heroConfig.imageHint')}
            </p>

            <Field
              id="hero-image-url"
              label={t('admin.heroConfig.imageUrlLabel')}
              value={inputs.imageUrl}
              onChange={(v) => set('imageUrl', v)}
              placeholder="https://..."
              disabled={loading}
              last
            />

            {inputs.imageUrl && (
              <div style={{ marginTop: 12 }}>
                <p className="text-xs text-(--ink-3) mb-2">{t('admin.heroConfig.imagePreview')}</p>
                <img
                  src={inputs.imageUrl}
                  alt="preview"
                  style={{
                    maxWidth: 280,
                    borderRadius: 'var(--r-md)',
                    border: '1px solid var(--border)',
                    display: 'block',
                    objectFit: 'cover',
                  }}
                  onError={(e) => {
                    ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

interface FieldProps {
  id: string
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  multiline?: boolean
  last?: boolean
}

function Field({ id, label, hint, value, onChange, placeholder, disabled, multiline, last }: FieldProps) {
  return (
    <div style={{ marginBottom: last ? 0 : 16 }}>
      <label
        htmlFor={id}
        className="block text-xs font-medium text-(--ink-2) mb-1"
      >
        {label}
      </label>
      {hint && (
        <p className="text-xs text-(--ink-3) mb-1" style={{ lineHeight: 1.4 }}>{hint}</p>
      )}
      {multiline ? (
        <textarea
          id={id}
          className="input w-full"
          style={{ resize: 'vertical', minHeight: 72, fontFamily: 'inherit', fontSize: 13 }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          rows={3}
        />
      ) : (
        <input
          id={id}
          className="input w-full"
          style={{ fontSize: 13 }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
        />
      )}
    </div>
  )
}
