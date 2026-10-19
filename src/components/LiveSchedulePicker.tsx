import React, { useState, useMemo, useEffect } from 'react'
import { Clock, Plus, Trash2, Sparkles } from 'lucide-react'

export interface WeeklySlot {
  id: string
  day: number // 2: Thứ 2, 3: Thứ 3, ..., 7: Thứ 7, 8: Chủ nhật
  startTime: string // "HH:mm"
  endTime: string // "HH:mm"
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

export function parseScheduleStringToSlots(str: string): WeeklySlot[] {
  const trimmed = str.trim()
  if (!trimmed) {
    return [
      { id: '1', day: 3, startTime: '19:30', endTime: '21:00' },
      { id: '2', day: 5, startTime: '19:30', endTime: '21:00' },
    ]
  }

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
      return foundDays.map((day, idx) => ({
        id: String(idx + 1),
        day,
        startTime,
        endTime,
      }))
    }
  }

  return [
    { id: '1', day: 3, startTime: '19:30', endTime: '21:00' },
    { id: '2', day: 5, startTime: '19:30', endTime: '21:00' },
  ]
}

interface LiveSchedulePickerProps {
  value: string
  onChange: (val: string) => void
  inputId?: string
  testId?: string
  placeholder?: string
}

export function LiveSchedulePicker({
  value,
  onChange,
  inputId = 'live-schedule',
  testId = 'live-schedule-input',
  placeholder = 'Ví dụ: Thứ 3 & Thứ 5 hàng tuần (19:30 - 21:00)',
}: LiveSchedulePickerProps) {
  const initialSlots = useMemo(() => parseScheduleStringToSlots(value), [])
  const [weeklySlots, setWeeklySlots] = useState<WeeklySlot[]>(initialSlots)

  // Keep slots in sync if value is changed externally to a structured schedule
  useEffect(() => {
    if (value && value.trim()) {
      const parsed = parseScheduleStringToSlots(value)
      if (parsed.length > 0) {
        setWeeklySlots(parsed)
      }
    }
  }, [value])

  const handleWeeklyChange = (updated: WeeklySlot[]) => {
    setWeeklySlots(updated)
    const formatted = formatWeeklySlots(updated)
    onChange(formatted)
  }

  const handleAddSlot = () => {
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
    handleWeeklyChange(updated)
  }

  return (
    <div className="flex flex-col gap-3 w-full max-w-full overflow-hidden">
      {/* Quick Presets Bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-xs font-semibold text-(--ink-2) flex items-center gap-1.5">
          <Sparkles size={13} className="text-amber-500 shrink-0" />
          <span>Mẫu lịch nhanh:</span>
        </span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {SCHEDULE_PRESETS.map(p => (
            <button
              key={p.name}
              type="button"
              className="btn btn-sm text-[11px] py-0 px-2 h-6.5 font-medium bg-(--surface) hover:bg-(--surface-3) text-(--ink-1) border border-(--border) hover:border-(--border-strong) transition-all"
              onClick={() => handleApplyPreset(p)}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* List of slots - each row is neatly sized and will NOT overflow */}
      <div className="flex flex-col gap-2">
        {weeklySlots.map((slot, index) => (
          <div
            key={slot.id}
            className="flex items-center gap-2 p-2 rounded-(--r-sm) bg-(--surface) border border-(--border) hover:border-(--border-strong) transition-colors flex-wrap sm:flex-nowrap"
          >
            <span className="text-xs font-semibold text-(--ink-2) shrink-0" style={{ width: '52px' }}>
              Buổi {index + 1}:
            </span>

            {/* Day selector - explicitly sized so it never pushes other elements out */}
            <select
              style={{ width: '115px', minWidth: '115px', maxWidth: '115px', height: '34px' }}
              className="input text-xs py-1 px-2 shrink-0 cursor-pointer"
              value={slot.day}
              onChange={e => handleUpdateSlot(slot.id, { day: Number(e.target.value) })}
            >
              {DAYS_OF_WEEK.map(d => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>

            {/* Time Range - explicitly constrained */}
            <div className="flex items-center gap-1 text-xs text-(--ink-2) shrink-0">
              <Clock size={13} className="text-(--ink-3) shrink-0 mr-0.5" />
              <span className="text-(--ink-3)">Từ</span>
              <input
                type="time"
                style={{ width: '100px', minWidth: '100px', maxWidth: '100px', height: '34px' }}
                className="input text-xs py-1 px-1.5 font-mono"
                value={slot.startTime}
                onChange={e => handleUpdateSlot(slot.id, { startTime: e.target.value })}
              />
              <span className="text-(--ink-3)">đến</span>
              <input
                type="time"
                style={{ width: '100px', minWidth: '100px', maxWidth: '100px', height: '34px' }}
                className="input text-xs py-1 px-1.5 font-mono"
                value={slot.endTime}
                onChange={e => handleUpdateSlot(slot.id, { endTime: e.target.value })}
              />
            </div>

            {/* Remove button */}
            {weeklySlots.length > 1 && (
              <button
                type="button"
                className="btn btn-sm btn-ghost p-1 text-(--ink-4) hover:text-red-500 hover:bg-red-500/10 rounded ml-auto shrink-0"
                title="Xóa buổi này"
                onClick={() => handleRemoveSlot(slot.id)}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}

        {/* Add slot button & session counter */}
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            className="btn btn-sm text-xs flex items-center gap-1.5 bg-(--surface) hover:bg-(--surface-3) text-(--ink-1) border border-(--border-strong) font-medium"
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

      {/* Resulting Schedule text input */}
      <div className="pt-1">
        <label htmlFor={inputId} className="block text-[11px] font-medium text-(--ink-3) mb-1">
          Lịch học hiển thị cho học viên (tự động cập nhật theo các buổi trên, hoặc bạn có thể chỉnh sửa trực tiếp):
        </label>
        <input
          id={inputId}
          data-testid={testId}
          type="text"
          className="input text-xs w-full font-medium"
          style={{ height: '36px', fontSize: '13px' }}
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      </div>
    </div>
  )
}
