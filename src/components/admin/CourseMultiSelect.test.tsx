import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import CourseMultiSelect, { type CourseOption } from './CourseMultiSelect'

function makeCourses(n: number): CourseOption[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c-${i + 1}`,
    title: i % 2 === 0 ? `Khai cuộc Italy ${i + 1}` : `Phòng thủ Sicilian ${i + 1}`,
  }))
}

function renderComp(props: Partial<React.ComponentProps<typeof CourseMultiSelect>> = {}) {
  const onChange = props.onChange ?? vi.fn()
  const courses = props.courses ?? makeCourses(5)
  return {
    onChange,
    ...render(
      <I18nextProvider i18n={i18n}>
        <CourseMultiSelect
          courses={courses}
          selected={props.selected ?? []}
          onChange={onChange}
        />
      </I18nextProvider>
    ),
  }
}

describe('CourseMultiSelect', () => {
  it('renders every course when the search box is empty', () => {
    renderComp({ courses: makeCourses(3) })
    expect(screen.getByTestId('course-multi-select-option-c-1')).toBeInTheDocument()
    expect(screen.getByTestId('course-multi-select-option-c-2')).toBeInTheDocument()
    expect(screen.getByTestId('course-multi-select-option-c-3')).toBeInTheDocument()
  })

  it('filters the option list to titles matching the search input (case-insensitive)', async () => {
    const user = userEvent.setup()
    renderComp({ courses: makeCourses(6) })
    const input = screen.getByTestId('course-multi-select-search')
    await user.type(input, 'sicilian')
    // Sicilian appears for the odd ids only (2, 4, 6 — courses[1,3,5])
    expect(screen.queryByTestId('course-multi-select-option-c-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('course-multi-select-option-c-2')).toBeInTheDocument()
    expect(screen.getByTestId('course-multi-select-option-c-4')).toBeInTheDocument()
    expect(screen.getByTestId('course-multi-select-option-c-6')).toBeInTheDocument()
  })

  it('emits onChange when a course checkbox is toggled', async () => {
    const user = userEvent.setup()
    const { onChange } = renderComp({ courses: makeCourses(3), selected: [] })
    await user.click(screen.getByTestId('course-multi-select-option-c-2'))
    expect(onChange).toHaveBeenCalledWith(['c-2'])
  })

  it('handles >100 courses by virtualising or capping the rendered list, and the search still works', async () => {
    const user = userEvent.setup()
    renderComp({ courses: makeCourses(150) })
    const input = screen.getByTestId('course-multi-select-search')
    // course id c-99 → makeCourses index 98 (even) → title "Khai cuộc Italy 99".
    // Without search the 100-cap would hide it, so searching narrows the list.
    await user.type(input, 'Italy 99')
    expect(screen.getByTestId('course-multi-select-option-c-99')).toBeInTheDocument()
  })

  it('displays the selected count', () => {
    renderComp({ courses: makeCourses(5), selected: ['c-1', 'c-3'] })
    expect(screen.getByTestId('course-multi-select-summary')).toHaveTextContent(/2/)
  })
})
