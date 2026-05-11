import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import CreatableSelect from 'react-select/creatable'
import type { GroupBase, MultiValue, StylesConfig } from 'react-select'
import { supabase } from '../lib/supabase'
import {
  createCreatorTag,
  listCreatorTags,
  normalizeTagName,
  MAX_TAG_LENGTH,
} from '../lib/creatorTagsApi'
import type { CreatorTag } from '../lib/creatorTagsApi'
import { POPULAR_TAGS } from '../lib/popularTags'

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

const styles: StylesConfig<TagOption, true, GroupBase<TagOption>> = {
  control: (base, state) => ({
    ...base,
    minHeight: 38,
    background: 'var(--bg)',
    borderColor: state.isFocused ? 'var(--ink-1)' : 'var(--border)',
    boxShadow: 'none',
    ':hover': { borderColor: 'var(--ink-2)' },
    borderRadius: 'var(--r-md)',
  }),
  multiValue: (base) => ({
    ...base,
    background: 'var(--surface-2)',
    borderRadius: 999,
    padding: '0 4px',
  }),
  multiValueLabel: (base) => ({
    ...base,
    color: 'var(--ink-1)',
    fontSize: 12,
  }),
  multiValueRemove: (base) => ({
    ...base,
    color: 'var(--ink-3)',
    ':hover': { background: 'var(--surface-3, #e5e5e5)', color: 'var(--ink-1)' },
    borderRadius: 999,
  }),
  groupHeading: (base) => ({
    ...base,
    fontSize: 11,
    color: 'var(--ink-3)',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  }),
  menu: (base) => ({
    ...base,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-md)',
    overflow: 'hidden',
    zIndex: 30,
  }),
  option: (base, state) => ({
    ...base,
    background: state.isFocused ? 'var(--surface-2)' : 'transparent',
    color: 'var(--ink-1)',
    fontSize: 13,
    cursor: 'pointer',
  }),
  placeholder: (base) => ({ ...base, color: 'var(--ink-4)', fontSize: 13 }),
  input: (base) => ({ ...base, color: 'var(--ink-1)', fontSize: 13 }),
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

  const popularOptions: TagOption[] = useMemo(
    () =>
      POPULAR_TAGS.map(p => ({
        value: p.key,
        label: t(p.labelKey),
        source: 'popular' as const,
      })),
    [t]
  )

  const creatorOptions: TagOption[] = useMemo(
    () =>
      creatorTags
        .filter(ct => !POPULAR_TAGS.some(p => p.key === ct.tag_name))
        .map(ct => ({
          value: ct.tag_name,
          label: ct.tag_name,
          source: 'creator' as const,
        })),
    [creatorTags]
  )

  const groupedOptions: GroupBase<TagOption>[] = useMemo(
    () => [
      { label: t('creator.tagsSelect.groupPopular'), options: popularOptions },
      { label: t('creator.tagsSelect.groupYours'), options: creatorOptions },
    ],
    [popularOptions, creatorOptions, t]
  )

  const selectedOptions: TagOption[] = useMemo(
    () =>
      value.map(v => {
        const popular = popularOptions.find(o => o.value === v)
        if (popular) return popular
        const creator = creatorOptions.find(o => o.value === v)
        if (creator) return creator
        return { value: v, label: v, source: 'inline' as const }
      }),
    [value, popularOptions, creatorOptions]
  )

  function handleChange(next: MultiValue<TagOption>) {
    onChange(next.slice(0, maxTags).map(o => o.value))
  }

  async function handleCreate(raw: string) {
    const name = normalizeTagName(raw)
    if (!name) return
    if (value.length >= maxTags) return
    if (POPULAR_TAGS.some(p => p.key === name)) {
      // Already a popular tag — just select it.
      onChange([...value, name])
      return
    }
    if (creatorTags.some(ct => ct.tag_name === name)) {
      onChange([...value, name])
      return
    }
    setCreating(true)
    const { tag, error } = await createCreatorTag(supabase, creatorId, name)
    setCreating(false)
    if (error || !tag) return
    setCreatorTags(prev => [...prev, tag].sort((a, b) => a.tag_name.localeCompare(b.tag_name)))
    onChange([...value, tag.tag_name])
  }

  const atLimit = value.length >= maxTags

  return (
    <div data-testid={testId}>
      <CreatableSelect<TagOption, true, GroupBase<TagOption>>
        isMulti
        isDisabled={disabled || loading}
        isLoading={loading || creating}
        value={selectedOptions}
        options={groupedOptions}
        onChange={handleChange}
        onCreateOption={handleCreate}
        placeholder={t('creator.tagsSelect.placeholder')}
        noOptionsMessage={() => t('creator.tagsSelect.noOptions')}
        formatCreateLabel={(input) =>
          t('creator.tagsSelect.createLabel', { name: normalizeTagName(input) })
        }
        isValidNewOption={(input) => {
          const name = normalizeTagName(input)
          return Boolean(name) && name.length <= MAX_TAG_LENGTH && !atLimit
        }}
        styles={styles}
        classNamePrefix="course-tags-select"
      />
      <p className="text-xs mt-1 text-(--ink-3)">
        {t('creator.tagsSelect.helper', { max: maxTags })}
      </p>
    </div>
  )
}
