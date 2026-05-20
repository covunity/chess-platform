import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface CourseOption {
  id: string
  title: string
}

interface Props {
  courses: CourseOption[]
  selected: string[]
  onChange: (selected: string[]) => void
}

// Window cap — keeps the DOM bounded when the admin has thousands of courses.
// Search narrows the visible window deterministically; full traversal happens
// in JS via the filter callback so titles beyond the cap remain findable.
const VISIBLE_LIMIT = 100

export default function CourseMultiSelect({ courses, selected, onChange }: Props) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')

  const selectedSet = useMemo(() => new Set(selected), [selected])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return courses
    return courses.filter(c => c.title.toLowerCase().includes(q))
  }, [courses, query])

  const visible = filtered.slice(0, VISIBLE_LIMIT)
  const truncated = filtered.length - visible.length

  function toggle(id: string) {
    if (selectedSet.has(id)) {
      onChange(selected.filter(x => x !== id))
    } else {
      onChange([...selected, id])
    }
  }

  return (
    <div
      className="rounded-(--r-md) border border-(--border)"
      style={{ background: 'var(--surface)' }}
    >
      <div className="border-b border-(--border) p-2 flex items-center gap-2">
        <input
          type="search"
          data-testid="course-multi-select-search"
          className="input flex-1"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('admin.campaigns.courseMultiSelect.searchPlaceholder')}
          aria-label={t('admin.campaigns.courseMultiSelect.searchPlaceholder')}
        />
        <span
          data-testid="course-multi-select-summary"
          className="text-(--ink-3)"
          style={{ fontSize: 12 }}
        >
          {t('admin.campaigns.courseMultiSelect.selectedCount', { count: selected.length })}
        </span>
      </div>

      <ul
        role="listbox"
        aria-multiselectable="true"
        style={{ maxHeight: 280, overflowY: 'auto', padding: 4, margin: 0, listStyle: 'none' }}
      >
        {visible.length === 0 ? (
          <li
            data-testid="course-multi-select-empty"
            className="text-(--ink-3) text-center py-6"
            style={{ fontSize: 13 }}
          >
            {t('admin.campaigns.courseMultiSelect.empty')}
          </li>
        ) : (
          visible.map(course => {
            const isSelected = selectedSet.has(course.id)
            return (
              <li
                key={course.id}
                role="option"
                aria-selected={isSelected}
                data-testid={`course-multi-select-option-${course.id}`}
                onClick={() => toggle(course.id)}
                className="flex items-center gap-2 px-3 py-2 cursor-pointer rounded-(--r-sm) hover:bg-(--surface-2)"
                style={{ fontSize: 13 }}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  readOnly
                  tabIndex={-1}
                  aria-hidden="true"
                />
                <span className="flex-1 text-(--ink-1) truncate">{course.title}</span>
              </li>
            )
          })
        )}
        {truncated > 0 && (
          <li
            data-testid="course-multi-select-truncated"
            className="text-(--ink-3) text-center py-2"
            style={{ fontSize: 11.5 }}
          >
            {t('admin.campaigns.courseMultiSelect.truncated', { count: truncated })}
          </li>
        )}
      </ul>
    </div>
  )
}
