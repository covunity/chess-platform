import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import {
  createCreatorTag,
  listCreatorTags,
  normalizeTagName,
} from '../lib/creatorTagsApi'
import type { CreatorTag } from '../lib/creatorTagsApi'
import { POPULAR_TAGS } from '../lib/popularTags'

const MAX_CUSTOM_TAG_LENGTH = 300

export interface TagOption {
  value: string
  label: string
  source: 'popular' | 'creator' | 'inline'
}

interface CourseTagsSelectProps {
  creatorId: string
  value: string[]
  onChange: (next: string[]) => void
  maxTags?: number
  disabled?: boolean
  testId?: string
}

export default function CourseTagsSelect({
  creatorId,
  value,
  onChange,
  maxTags = 10,
  disabled = false,
  testId = 'course-tags-select',
}: CourseTagsSelectProps) {
  const { t } = useTranslation()
  const [creatorTags, setCreatorTags] = useState<CreatorTag[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [customInput, setCustomInput] = useState('')

  useEffect(() => {
    let cancelled = false
    listCreatorTags(supabase, creatorId).then(({ tags }) => {
      if (!cancelled) {
        setCreatorTags(tags)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [creatorId])

  const popularOptions = useMemo(
    () =>
      POPULAR_TAGS.map(p => ({
        value: p.key,
        label: t(p.labelKey),
      })),
    [t],
  )

  const atLimit = value.length >= maxTags

  function getTagLabel(v: string): string {
    const popular = popularOptions.find(o => o.value === v)
    if (popular) return popular.label
    return v
  }

  function handleRemoveTag(tag: string) {
    onChange(value.filter(v => v !== tag))
  }

  function handlePopularSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const selected = e.target.value
    if (!selected || atLimit) return
    if (!value.includes(selected)) {
      onChange([...value, selected])
    }
    e.target.value = ''
  }

  async function handleAddCustomTag() {
    const name = normalizeTagName(customInput)
    if (!name || atLimit) return

    if (POPULAR_TAGS.some(p => p.key === name)) {
      if (!value.includes(name)) onChange([...value, name])
      setCustomInput('')
      return
    }

    if (value.includes(name)) {
      setCustomInput('')
      return
    }

    if (creatorTags.some(ct => ct.tag_name === name)) {
      onChange([...value, name])
      setCustomInput('')
      return
    }

    setCreating(true)
    const { tag, error } = await createCreatorTag(supabase, creatorId, name)
    setCreating(false)
    if (error || !tag) return
    setCreatorTags(prev =>
      [...prev, tag].sort((a, b) => a.tag_name.localeCompare(b.tag_name)),
    )
    onChange([...value, tag.tag_name])
    setCustomInput('')
  }

  function handleCustomKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddCustomTag()
    }
  }

  const availablePopular = popularOptions.filter(o => !value.includes(o.value))

  return (
    <div data-testid={testId}>
      {/* Selected tags */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2" data-testid="selected-tags">
          {value.map(tag => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs"
              style={{ background: 'var(--surface-2)', color: 'var(--ink-1)' }}
            >
              {getTagLabel(tag)}
              <button
                type="button"
                className="ml-0.5 hover:opacity-70 leading-none"
                style={{ color: 'var(--ink-3)' }}
                onClick={() => handleRemoveTag(tag)}
                disabled={disabled}
                aria-label={`Remove ${getTagLabel(tag)}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Popular tag dropdown — single select */}
      <div className="mb-2">
        <select
          className="input"
          onChange={handlePopularSelect}
          disabled={disabled || loading || atLimit}
          defaultValue=""
          data-testid="popular-tag-select"
        >
          <option value="" disabled>
            {t('creator.tagsSelect.popularPlaceholder')}
          </option>
          {availablePopular.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Custom tag input */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            className="input"
            style={{ paddingRight: 48 }}
            value={customInput}
            onChange={e => setCustomInput(e.target.value.slice(0, MAX_CUSTOM_TAG_LENGTH))}
            onKeyDown={handleCustomKeyDown}
            placeholder={t('creator.tagsSelect.customPlaceholder')}
            disabled={disabled || loading || atLimit || creating}
            maxLength={MAX_CUSTOM_TAG_LENGTH}
            data-testid="custom-tag-input"
          />
          <span
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] pointer-events-none"
            style={{ color: 'var(--ink-4)' }}
          >
            {customInput.length}/{MAX_CUSTOM_TAG_LENGTH}
          </span>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={handleAddCustomTag}
          disabled={
            disabled || creating || atLimit || !normalizeTagName(customInput)
          }
          data-testid="add-custom-tag-btn"
        >
          {creating ? '…' : t('creator.tagsSelect.addBtn')}
        </button>
      </div>

      <p className="text-xs mt-1" style={{ color: 'var(--ink-3)' }}>
        {t('creator.tagsSelect.helper', { max: maxTags })}
      </p>
    </div>
  )
}
