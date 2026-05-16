import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import UserNameCardTrigger from '../UserNameCard'

describe('UserNameCardTrigger', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function mountTrigger(user: Parameters<typeof UserNameCardTrigger>[0]['user']) {
    render(
      <UserNameCardTrigger user={user}>
        <span>Alice</span>
      </UserNameCardTrigger>
    )
    return screen.getByText('Alice').parentElement as HTMLElement
  }

  it('does not show the popup before hover', () => {
    mountTrigger({ name: 'Alice', avatar_url: null, bio: 'Plays the Najdorf.' })
    expect(screen.queryByTestId('user-name-card-popup')).not.toBeInTheDocument()
  })

  it('shows the popup after the hover delay with name + bio', () => {
    const trigger = mountTrigger({ name: 'Alice', avatar_url: null, bio: 'Plays the Najdorf.' })
    fireEvent.mouseEnter(trigger, { clientX: 100, clientY: 200 })
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.getByTestId('user-name-card-popup')).toBeInTheDocument()
    expect(screen.getByTestId('user-name-card-name')).toHaveTextContent('Alice')
    expect(screen.getByTestId('user-name-card-bio')).toHaveTextContent('Plays the Najdorf.')
  })

  it('omits the bio paragraph when bio is null', () => {
    const trigger = mountTrigger({ name: 'Bob', avatar_url: null, bio: null })
    fireEvent.mouseEnter(trigger, { clientX: 100, clientY: 200 })
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.getByTestId('user-name-card-name')).toHaveTextContent('Bob')
    expect(screen.queryByTestId('user-name-card-bio')).not.toBeInTheDocument()
  })

  it('cancels the show-timer if the cursor leaves before the delay elapses', () => {
    const trigger = mountTrigger({ name: 'Alice', avatar_url: null, bio: 'Hi.' })
    fireEvent.mouseEnter(trigger, { clientX: 100, clientY: 200 })
    fireEvent.mouseLeave(trigger)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.queryByTestId('user-name-card-popup')).not.toBeInTheDocument()
  })

  it('hides the popup after the cursor leaves', () => {
    const trigger = mountTrigger({ name: 'Alice', avatar_url: null, bio: 'Hi.' })
    fireEvent.mouseEnter(trigger, { clientX: 100, clientY: 200 })
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.getByTestId('user-name-card-popup')).toBeInTheDocument()
    fireEvent.mouseLeave(trigger)
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.queryByTestId('user-name-card-popup')).not.toBeInTheDocument()
  })
})
