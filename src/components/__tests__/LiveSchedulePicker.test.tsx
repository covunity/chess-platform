import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import {
  LiveSchedulePicker,
  formatWeeklySlots,
  parseScheduleStringToSlots,
  type WeeklySlot,
} from '../LiveSchedulePicker'

describe('LiveSchedulePicker formatting and parsing', () => {
  it('formats slots with identical times into combined days string', () => {
    const slots: WeeklySlot[] = [
      { id: '1', day: 3, startTime: '19:30', endTime: '21:00' },
      { id: '2', day: 5, startTime: '19:30', endTime: '21:00' },
    ]
    expect(formatWeeklySlots(slots)).toBe('Thứ 3 & Thứ 5 (19:30 - 21:00)')
  })

  it('formats 3 slots with identical times', () => {
    const slots: WeeklySlot[] = [
      { id: '1', day: 2, startTime: '19:30', endTime: '21:00' },
      { id: '2', day: 4, startTime: '19:30', endTime: '21:00' },
      { id: '3', day: 6, startTime: '19:30', endTime: '21:00' },
    ]
    expect(formatWeeklySlots(slots)).toBe('Thứ 2, Thứ 4 & Thứ 6 (19:30 - 21:00)')
  })

  it('formats slots with different times separately', () => {
    const slots: WeeklySlot[] = [
      { id: '1', day: 3, startTime: '19:30', endTime: '21:00' },
      { id: '2', day: 8, startTime: '09:00', endTime: '10:30' },
    ]
    expect(formatWeeklySlots(slots)).toBe('Thứ 3 (19:30 - 21:00), Chủ nhật (09:00 - 10:30)')
  })

  it('parses standard schedule string into weekly slots', () => {
    const slots = parseScheduleStringToSlots('Thứ 3 & Thứ 5 hàng tuần (19:30 - 21:00)')
    expect(slots).toHaveLength(2)
    expect(slots[0].day).toBe(3)
    expect(slots[1].day).toBe(5)
    expect(slots[0].startTime).toBe('19:30')
    expect(slots[0].endTime).toBe('21:00')
  })
})

describe('LiveSchedulePicker UI interaction', () => {
  it('renders presets and adds slot when clicked', () => {
    const onChange = vi.fn()
    render(<LiveSchedulePicker value="Thứ 3 & Thứ 5 (19:30 - 21:00)" onChange={onChange} />)

    // Preset button
    const presetBtn = screen.getByText('Tối T2, T4, T6')
    fireEvent.click(presetBtn)

    expect(onChange).toHaveBeenCalledWith('Thứ 2, Thứ 4 & Thứ 6 (19:30 - 21:00)')
  })

  it('allows adding a new session slot', () => {
    const onChange = vi.fn()
    render(<LiveSchedulePicker value="Thứ 3 & Thứ 5 (19:30 - 21:00)" onChange={onChange} />)

    const addBtn = screen.getByText('Thêm buổi học trong tuần')
    fireEvent.click(addBtn)

    expect(onChange).toHaveBeenCalled()
    // Now there should be 3 slots
    expect(screen.getByText('Buổi 3:')).toBeInTheDocument()
  })

  it('allows typing directly in the primary input', () => {
    const onChange = vi.fn()
    render(<LiveSchedulePicker value="" onChange={onChange} />)

    const input = screen.getByTestId('live-schedule-input')
    fireEvent.change(input, { target: { value: 'T2 và T4 19h' } })

    expect(onChange).toHaveBeenCalledWith('T2 và T4 19h')
  })
})
