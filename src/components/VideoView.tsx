import { useEffect, useRef } from 'react'
import type { VideoFormat } from '../lib/video/types'

// Minimal type for the lazy-loaded hls.js module.
interface HlsInstance {
  loadSource(url: string): void
  attachMedia(video: HTMLMediaElement): void
  destroy(): void
}
interface HlsCtor {
  new (): HlsInstance
  isSupported(): boolean
}

export interface VideoViewProps {
  url: string
  format: VideoFormat
  poster?: string
  controls?: boolean
  className?: string
  style?: React.CSSProperties
  onDurationLoaded?: (seconds: number) => void
  onTimeUpdate?: (currentTime: number, duration: number) => void
}

export default function VideoView({
  url,
  format,
  poster,
  controls = true,
  className,
  style,
  onDurationLoaded,
  onTimeUpdate,
}: VideoViewProps) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = ref.current
    if (!video) return
    let cancelled = false
    let hlsInstance: { destroy: () => void } | null = null

    if (format === 'mp4') {
      video.src = url
    } else if (format === 'hls') {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url
      } else {
        // Lazy-load hls.js only when the browser actually needs it
        // (i.e. when the browser does not natively support HLS — Safari does).
        import('hls.js')
          .then((mod: { default: HlsCtor }) => {
            if (cancelled) return
            const Hls = mod.default
            if (!Hls.isSupported()) {
              video.src = url
              return
            }
            const hls = new Hls()
            hls.loadSource(url)
            hls.attachMedia(video)
            hlsInstance = hls
          })
          .catch((err: unknown) => {
            console.error('Không tải được hls.js:', err)
          })
      }
    }

    return () => {
      cancelled = true
      if (hlsInstance) {
        try { hlsInstance.destroy() } catch { /* noop */ }
      }
    }
  }, [url, format])

  return (
    <video
      ref={ref}
      controls={controls}
      poster={poster}
      className={className}
      style={style}
      preload="metadata"
      onLoadedMetadata={(e) => {
        if (onDurationLoaded) {
          const d = (e.currentTarget as HTMLVideoElement).duration
          if (Number.isFinite(d) && d > 0) onDurationLoaded(d)
        }
      }}
      onTimeUpdate={(e) => {
        if (onTimeUpdate) {
          const v = e.currentTarget as HTMLVideoElement
          if (v.duration > 0) onTimeUpdate(v.currentTime, v.duration)
        }
      }}
    />
  )
}
