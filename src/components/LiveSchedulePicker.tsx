import React, { useState, useEffect, useMemo } from 'react'
import { Calendar, Clock, Plus, Trash2, Sparkles, Type } from 'lucide-react'

export interface WeeklySlot {
  id: string
  day: number // 2: Thứ 2, 3: Thứ 3, ..., 7: Thứ 7, 8: Chủ nhật
  startTime: string // "HH:mm"
  endTime: string // "HH:mm"
}

export interface SpecificDateSlot {
  id: string
  date: string // "YYYY-MM-DD"
  startTime: string
  endTime: string
}

export const DAYS_OF_WEEK = [
  { value: 2, label: 'Thứ 2', short: 'T2' },
  { value: 3, label: 'Thứ 3', short: 'T3' },
  { value: 4, label: 'Thứ 4', short: 'T4' },
  { value: 5, label: 'Thứ 5', short: 'T5' },
  { value: 6, label: 'Thứ 6', short: 'T6' },
  { value: 7, label: 'Thứ 7', short: 'T7' },
  { value: 8, label: 'Chủ nhật', short: 'CN' },
]

export const SCHEDULE_PRESETS = [
  {
    name: 'Tối T3 & T5',
    slots: [
      { day: 3, startTime: '19:30', endTime: '21:00' },
      { day: 5, startTime: '19:30', endTime: '21:00' },
    ],
  },
  {
    name: 'Tối T2, T4, T6',
    slots: [
      { day: 2, startTime: '19:30', endTime: '21:00' },
      { day: 4, startTime: '19:30', endTime: '21:00' },
      { day: 6, startTime: '19:30', endTime: '21:00' },
    ],
  },
  {
    name: 'Sáng T7 & CN',
    slots: [
      { day: 7, startTime: '09:00', endTime: '10:30' },
      { day: 8, startTime: '09:00', endTime: '10:30' },
    ],
  },
  {
    name: 'Tối T7 & CN',
    slots: [
      { day: 7, startTime: '19:30', endTime: '21:00' },
      { day: 8, startTime: '19:30', endTime: '21:00' },
    ],
  },
]

export function formatWeeklySlots(slots: WeeklySlot[]): string {
  if (slots.length === 0) return ''

  // Group slots by time range to produce compact, natural phrasing
  const timeMap = new Map<string, number[]>()
  for (const s of slots) {
    const key = `${s.startTime} - ${s.endTime}`
    const days = timeMap.get(key) ?? []
    days.push(s.day)
    timeMap.set(key, days)
  }

  const parts: string[] = []
  for (const [timeRange, days] of timeMap.entries()) {
    const sortedDays = [...days].sort((a, b) => a - b)
    const dayNames = sortedDays.map(d => DAYS_OF_WEEK.find(x => x.value === d)?.label ?? `Thứ ${d}`)

    let daysText = ''
    if (dayNames.length === 1) {
      daysText = dayNames[0]
    } else if (dayNames.length === 2) {
      daysText = `${dayNames[0]} & ${dayNames[1]}`
    } else {
      daysText = `${dayNames.slice(0, -1).join(', ')} & ${dayNames[dayNames.length - 1]}`
    }

    parts.push(`${daysText} (${timeRange})`)
  }

  return parts.join(', ')
}

export function formatSpecificDateSlots(slots: SpecificDateSlot[]): string {
  if (slots.length === 0) return ''
  const sorted = [...slots].sort((a, b) => a.date.localeCompare(b.date))
  return sorted
    .map(s => {
      const [, m, d] = s.date.split('-')
      const formattedDate = d && m ? `${d}/${m}` : s.date
      return `${formattedDate} (${s.startTime} - ${s.endTime})`
    })
    .join(', ')
}

export function parseScheduleStringToSlots(str: string): {
  mode: 'weekly' | 'custom'
  weeklySlots: WeeklySlot[]
} {
  const trimmed = str.trim()
  if (!trimmed) {
    return {
      mode: 'weekly',
      weeklySlots: [
        { id: '1', day: 3, startTime: '19:30', endTime: '21:00' },
        { id: '2', day: 5, startTime: '19:30', endTime: '21:00' },
      ],
    }
  }

  // Attempt to parse e.g. "Thứ 3 & Thứ 5 (19:30 - 21:00)" or "Thứ 2, Thứ 4 (20:00 - 21:30)"
  const timeMatch = trimmed.match(/(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/)
  if (timeMatch) {
    const startTime = timeMatch[1].padStart(5, '0')
    const endTime = timeMatch[2].padStart(5, '0')
    const foundDays: number[] = []

    DAYS_OF_WEEK.forEach(d => {
      const regex = new RegExp(`(${d.label}|${d.short})`, 'i')
      if (regex.test(trimmed)) {
        foundDays.push(d.value)
      }
    })

    if (foundDays.length > 0) {
      return {
        mode: 'weekly',
        weeklySlots: foundDays.map((day, idx) => ({
          id: String(idx + 1),
          day,
          startTime,
          endTime,
        })),
      }
    }
  }

  // Fallback to custom mode if it's freeform text
  return {
    mode: 'custom',
    weeklySlots: [
      { id: '1', day: 3, startTime: '19:30', endTime: '21:00' },
      { id: '2', day: 5, startTime: '19:30', endTime: '21:00' },
    ],
  }
}

interface LiveSchedulePickerProps {
  value: string
  onChange: (val: string) => void
}

export function LiveSchedulePicker({ value, onChange }: LiveSchedulePickerProps) {
  const parsed = useMemo(() => parseScheduleStringToSlots(value), [])
  const [mode, setMode] = useState<'weekly' | 'custom'>(parsed.mode)
  const [weeklySlots, setWeeklySlots] = useState<WeeklySlot[]>(parsed.weeklySlots)
  const [customText, setCustomText] = useState(value)

  // Synchronize internal slots to parent onChange
  const handleWeeklyChange = (updated: WeeklySlot[]) => {
    setWeeklySlots(updated)
    const formatted = formatWeeklySlots(updated)
    onChange(formatted)
  }

  const handleAddSlot = () => {
    // Pick the next logical day
    const usedDays = new Set(weeklySlots.map(s => s.day))
    const nextDay = DAYS_OF_WEEK.find(d => !usedDays.has(d.value))?.value ?? 3
    const lastSlot = weeklySlots[weeklySlots.length - 1]
    const newSlot: WeeklySlot = {
      id: Math.random().toString(36).slice(2, 9),
      day: nextDay,
      startTime: lastSlot?.startTime ?? '19:30',
      endTime: lastSlot?.endTime ?? '21:00',
    }
    handleWeeklyChange([...weeklySlots, newSlot])
  }

  const handleRemoveSlot = (id: string) => {
    const updated = weeklySlots.filter(s => s.id !== id)
    handleWeeklyChange(updated)
  }

  const handleUpdateSlot = (id: string, patch: Partial<WeeklySlot>) => {
    const updated = weeklySlots.map(s => (s.id === id ? { ...s, ...patch } : s))
    handleWeeklyChange(updated)
  }

  const handleApplyPreset = (preset: (typeof SCHEDULE_PRESETS)[0]) => {
    const updated: WeeklySlot[] = preset.slots.map((s, idx) => ({
      id: String(idx + 1),
      day: s.day,
      startTime: s.startTime,
      endTime: s.endTime,
    }))
    setMode('weekly')
    handleWeeklyChange(updated)
  }

  const handleCustomTextChange = (text: string) => {
    setCustomText(text)
    onChange(text)
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Mode selection tabs */}
      <div className="flex items-center justify-between border-b border-(--border) pb-2">
        <div className="flex items-center gap-1.5 bg-(--surface) p-1 rounded-(--r-sm) border border-(--border)">
          <button
            type="button"
            className={`btn btn-sm text-xs flex items-center gap-1.5 transition-all ${
              mode === 'weekly'
                ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/50 font-semibold shadow-xs'
                : 'text-(--ink-3) hover:text-(--ink-1) border-transparent font-medium'
            }`}
            onClick={() => {
              setMode('weekly')
              if (weeklySlots.length > 0) {
                onChange(formatWeeklySlots(weeklySlots))
              }
            }}
          >
            <Calendar size={13} />
            <span>Lịch định kỳ hàng tuần</span>
          </button>
          <button
            type="button"
            className={`btn btn-sm text-xs flex items-center gap-1.5 transition-all ${
              mode === 'custom'
                ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/50 font-semibold shadow-xs'
                : 'text-(--ink-3) hover:text-(--ink-1) border-transparent font-medium'
            }`}
            onClick={() => {
              setMode('custom')
              onChange(customText)
            }}
          >
            <Type size={13} />
            <span>Nhập tự do</span>
          </button>
        </div>

        {/* Quick presets (only shown in weekly mode) */}
        {mode === 'weekly' && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-(--ink-4) flex items-center gap-1 hidden sm:inline-flex">
              <Sparkles size={11} /> Mẫu nhanh:
            </span>
            {SCHEDULE_PRESETS.map(p => (
              <button
                key={p.name}
                type="button"
                className="btn btn-sm text-[11px] py-0 px-2 h-6 font-medium bg-(--surface) hover:bg-(--surface-3) text-(--ink-2) border border-(--border)"
                onClick={() => handleApplyPreset(p)}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {mode === 'weekly' ? (
        <div className="flex flex-col gap-2.5">
          {/* List of slots */}
          {weeklySlots.map((slot, index) => (
            <div
              key={slot.id}
              className="flex items-center gap-2.5 p-2.5 rounded-(--r-sm) bg-(--surface) border border-(--border) hover:border-(--border-strong) transition-colors flex-wrap sm:flex-nowrap"
            >
              <span className="text-xs font-semibold text-(--ink-3) w-14 shrink-0">
                Buổi {index + 1}:
              </span>

              {/* Day selector */}
              <select
                className="input text-xs py-1 px-2.5 h-8 shrink-0 min-w-[110px]"
                value={slot.day}
                onChange={e => handleUpdateSlot(slot.id, { day: Number(e.target.value) })}
              >
                {DAYS_OF_WEEK.map(d => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>

              {/* Time Range */}
              <div className="flex items-center gap-1.5 text-xs text-(--ink-2) shrink-0">
                <Clock size={13} className="text-(--ink-3)" />
                <span>Từ</span>
                <input
                  type="time"
                  className="input text-xs py-1 px-2 h-8 w-[95px] font-mono"
                  value={slot.startTime}
                  onChange={e => handleUpdateSlot(slot.id, { startTime: e.target.value })}
                />
                <span>đến</span>
                <input
                  type="time"
                  className="input text-xs py-1 px-2 h-8 w-[95px] font-mono"
                  value={slot.endTime}
                  onChange={e => handleUpdateSlot(slot.id, { endTime: e.target.value })}
                />
              </div>

              {/* Remove button */}
              {weeklySlots.length > 1 && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost p-1 text-(--ink-4) hover:text-red-500 ml-auto"
                  title="Xóa buổi này"
                  onClick={() => handleRemoveSlot(slot.id)}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}

          {/* Add slot button */}
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              className="btn btn-sm text-xs flex items-center gap-1.5 bg-(--surface-3) hover:bg-(--surface-2) text-(--ink-1) border border-(--border-strong) font-medium"
              onClick={handleAddSlot}
            >
              <Plus size={13} />
              <span>Thêm buổi học trong tuần</span>
            </button>

            {weeklySlots.length > 0 && (
              <span className="text-[11px] text-(--ink-3)">
                Tổng cộng: <strong className="text-(--ink-1)">{weeklySlots.length} buổi / tuần</strong>
              </span>
            )}
          </div>
        </div>
      ) : (
        /* Custom text input */
        <div>
          <textarea
            className="input text-xs py-2 px-3 w-full"
            style={{ height: 68, resize: 'vertical' }}
            placeholder="Ví dụ: Thứ 3 & Thứ 5 hàng tuần (19:30 - 21:00)"
            value={customText}
            onChange={e => handleCustomTextChange(e.target.value)}
          />
          <p className="text-[11px] text-(--ink-3) mt-1">
            Gợi ý: Nhập lịch học tự do nếu khóa học của bạn có lịch trình đặc biệt hoặc dạy theo thỏa thuận.
          </p>
        </div>
      )}

      {/* Live Preview Bar */}
      {value.trim() && (
        <div className="p-2.5 rounded-(--r-sm) bg-sky-500/10 border border-sky-500/30 flex items-center gap-2">
          <Calendar size={14} className="text-sky-600 dark:text-sky-400 shrink-0" />
          <span className="text-xs text-(--ink-2) leading-tight">
            Hiển thị cho học viên:{' '}
            <strong className="text-sky-700 dark:text-sky-300 font-semibold">{value}</strong>
          </span>
        </div>
      )}
    </div>
  )
}
