import { useEffect, useRef } from 'react'

export interface BunnyVideoPlayerProps {
  embedUrl: string
  onComplete?: () => void
  className?: string
  style?: React.CSSProperties
}

export default function BunnyVideoPlayer({ embedUrl, onComplete, className, style }: BunnyVideoPlayerProps) {
  const completedRef = useRef(false)
  const durationRef = useRef(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    completedRef.current = false
    durationRef.current = 0
  }, [embedUrl])

  useEffect(() => {
    if (!onComplete) return

    function sendToPlayer(method: string) {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ context: 'player.js', method }),
        '*'
      )
    }

    function fire() {
      if (completedRef.current) return
      completedRef.current = true
      onComplete!()
    }

    function handleMessage(e: MessageEvent) {
      if (completedRef.current) return

      // Bunny player.js sends data as a JSON string, not an object
      let raw: Record<string, unknown> | null = null
      if (typeof e.data === 'string') {
        try { raw = JSON.parse(e.data) } catch { return }
      } else if (e.data && typeof e.data === 'object') {
        raw = e.data as Record<string, unknown>
      }

      if (!raw || typeof raw.event !== 'string') return

      const event = raw.event
      // player.js format: payload is in raw.value, not raw.currentTime/raw.duration
      const value = raw.value

      // Player ready — subscribe to events + request duration via player.js API
      if (event === 'ready') {
        sendToPlayer('getDuration')
        // Bunny player.js requires explicit subscription to receive push events
        for (const ev of ['timeupdate', 'ended', 'pause']) {
          iframeRef.current?.contentWindow?.postMessage(
            JSON.stringify({ context: 'player.js', method: 'addEventListener', value: ev }),
            '*'
          )
        }
        return
      }

      // getDuration response — value is the duration in seconds
      if (event === 'getDuration' && typeof value === 'number' && value > 0) {
        durationRef.current = value
        return
      }

      // Video ended → definitely ≥ 80%
      if (event === 'ended' || event === 'oncomplete') {
        fire()
        return
      }

      // timeupdate — value is { seconds, duration }
      if (event === 'timeupdate' && value && typeof value === 'object') {
        const { seconds, duration } = value as { seconds: number; duration: number }
        if (duration > 0) durationRef.current = duration
        const d = durationRef.current
        if (d > 0 && seconds / d >= 0.8) fire()
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [onComplete])

  return (
    <iframe
      ref={iframeRef}
      src={embedUrl}
      className={className}
      style={{ border: 'none', ...style }}
      allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
      allowFullScreen
      title="Bunny video player"
    />
  )
}
