// TDD: BunnyVideoPlayer component (issue #261)
// Behaviors tested:
//   1. Renders an iframe with the provided embedUrl
//   2. Does NOT call onComplete before 80% is reached
//   3. Calls onComplete when timeupdate value.seconds/value.duration >= 0.8
//   4. Does NOT call onComplete twice (completedRef prevents double-fire)
//   5. Resets completion state when embedUrl changes
//   6. getDuration response stores duration; next timeupdate fires onComplete
//   7. Fires on ended / oncomplete events regardless of position

import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import BunnyVideoPlayer from './BunnyVideoPlayer'

const EMBED_URL = 'https://iframe.mediadelivery.net/embed/667376/video-guid-abc?token=tok&expires=9999'
const EMBED_URL_2 = 'https://iframe.mediadelivery.net/embed/667376/video-guid-xyz?token=tok2&expires=9998'

// Bunny player.js sends data as a JSON string with value: { seconds, duration }
function dispatchTimeUpdate(seconds: number, duration: number) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ event: 'timeupdate', value: { seconds, duration } }),
      })
    )
  })
}

describe('BunnyVideoPlayer', () => {
  it('renders an iframe with the provided embedUrl', () => {
    render(<BunnyVideoPlayer embedUrl={EMBED_URL} />)
    const iframe = screen.getByTitle('Bunny video player')
    expect(iframe).toBeTruthy()
    expect(iframe.getAttribute('src')).toBe(EMBED_URL)
  })

  it('does NOT call onComplete before 80% is reached', () => {
    const onComplete = vi.fn()
    render(<BunnyVideoPlayer embedUrl={EMBED_URL} onComplete={onComplete} />)

    // 79% — should NOT fire
    dispatchTimeUpdate(79, 100)
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('calls onComplete when timeupdate seconds/duration >= 0.8', () => {
    const onComplete = vi.fn()
    render(<BunnyVideoPlayer embedUrl={EMBED_URL} onComplete={onComplete} />)

    dispatchTimeUpdate(80, 100)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('calls onComplete at exactly 80%', () => {
    const onComplete = vi.fn()
    render(<BunnyVideoPlayer embedUrl={EMBED_URL} onComplete={onComplete} />)

    dispatchTimeUpdate(80, 100)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('does NOT call onComplete twice (completedRef prevents double-fire)', () => {
    const onComplete = vi.fn()
    render(<BunnyVideoPlayer embedUrl={EMBED_URL} onComplete={onComplete} />)

    dispatchTimeUpdate(80, 100)
    dispatchTimeUpdate(90, 100)
    dispatchTimeUpdate(100, 100)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('ignores messages with duration = 0 to avoid division by zero', () => {
    const onComplete = vi.fn()
    render(<BunnyVideoPlayer embedUrl={EMBED_URL} onComplete={onComplete} />)

    dispatchTimeUpdate(0, 0)
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('ignores non-timeupdate events', () => {
    const onComplete = vi.fn()
    render(<BunnyVideoPlayer embedUrl={EMBED_URL} onComplete={onComplete} />)

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ event: 'play', value: { seconds: 100, duration: 100 } }),
        })
      )
    })
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('resets completion state when embedUrl changes', () => {
    const onComplete = vi.fn()
    const { rerender } = render(<BunnyVideoPlayer embedUrl={EMBED_URL} onComplete={onComplete} />)

    // Reach 80% on first video
    dispatchTimeUpdate(80, 100)
    expect(onComplete).toHaveBeenCalledTimes(1)

    // Change embedUrl (new video)
    rerender(<BunnyVideoPlayer embedUrl={EMBED_URL_2} onComplete={onComplete} />)

    // Reach 80% again on second video — should fire again
    dispatchTimeUpdate(80, 100)
    expect(onComplete).toHaveBeenCalledTimes(2)
  })

  it('does not call onComplete when onComplete is not provided', () => {
    // Should not throw
    render(<BunnyVideoPlayer embedUrl={EMBED_URL} />)
    expect(() => dispatchTimeUpdate(80, 100)).not.toThrow()
  })

  it('getDuration response stores duration; timeupdate fires onComplete', () => {
    const onComplete = vi.fn()
    render(<BunnyVideoPlayer embedUrl={EMBED_URL} onComplete={onComplete} />)

    // Player responds to getDuration with the video duration
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ event: 'getDuration', value: 10 }),
        })
      )
    })
    // Then timeupdate fires with seconds at 80%
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ event: 'timeupdate', value: { seconds: 8, duration: 10 } }),
        })
      )
    })
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('calls onComplete on "ended" event (100% = definitely >= 80%)', () => {
    const onComplete = vi.fn()
    render(<BunnyVideoPlayer embedUrl={EMBED_URL} onComplete={onComplete} />)

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ event: 'ended' }),
        })
      )
    })
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('calls onComplete on "oncomplete" event', () => {
    const onComplete = vi.fn()
    render(<BunnyVideoPlayer embedUrl={EMBED_URL} onComplete={onComplete} />)

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ event: 'oncomplete' }),
        })
      )
    })
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})
