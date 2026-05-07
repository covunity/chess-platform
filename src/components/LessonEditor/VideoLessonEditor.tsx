import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { clearLessonVideo, setLessonVideo, setLessonVideoStatus } from '../../lib/creatorApi'
import type { VideoStatus } from '../../lib/creatorApi'
import { getDefaultProvider, getProvider, VIDEO_LIMITS, validateVideoFile } from '../../lib/video'
import type { UploadHandle, VideoProviderName } from '../../lib/video/types'

export interface VideoLessonEditorLesson {
  id: string
  is_free_preview: boolean
  duration_seconds?: number
  video_provider?: VideoProviderName | null
  video_provider_id?: string | null
  video_status?: VideoStatus
  video_filename?: string | null
  video_size_bytes?: number | null
}

export interface VideoLessonEditorProps {
  lesson: VideoLessonEditorLesson
  isFreePreview: boolean
  onFreePreviewChange: (next: boolean) => void
  onLessonChange: (next: Partial<VideoLessonEditorLesson>) => void
}

type LocalState =
  | { kind: 'idle' }
  | { kind: 'uploading'; filename: string; size: number; pct: number; speed: number; handle: UploadHandle | null }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }

function bytesToHuman(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function speedToHuman(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '—'
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`
  return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`
}

function durationToHuman(seconds: number | undefined | null): string {
  if (!seconds || !Number.isFinite(seconds)) return ''
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

async function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    let done = false
    const finish = (val: number | null) => {
      if (done) return
      done = true
      URL.revokeObjectURL(url)
      resolve(val)
    }
    video.onloadedmetadata = () => {
      const d = video.duration
      finish(Number.isFinite(d) && d > 0 ? Math.round(d) : null)
    }
    video.onerror = () => finish(null)
    video.src = url
    setTimeout(() => finish(null), 8000)
  })
}

export default function VideoLessonEditor({
  lesson,
  isFreePreview,
  onFreePreviewChange,
  onLessonChange,
}: VideoLessonEditorProps) {
  const [state, setState] = useState<LocalState>(() =>
    lesson.video_status === 'ready' ? { kind: 'ready' } : { kind: 'idle' }
  )
  const inputRef = useRef<HTMLInputElement>(null)

  const startUpload = async (file: File) => {
    const v = validateVideoFile(file)
    if (!v.ok) {
      setState({ kind: 'error', message: v.reason })
      return
    }

    const provider = getDefaultProvider()

    // Mark uploading in DB so resume from another tab shows the right state.
    await setLessonVideoStatus(supabase, lesson.id, 'uploading')
    onLessonChange({ video_status: 'uploading', video_filename: file.name, video_size_bytes: file.size })

    setState({ kind: 'uploading', filename: file.name, size: file.size, pct: 0, speed: 0, handle: null })

    const duration = await readVideoDuration(file)

    const handle = await provider.upload(file, lesson.id, {
      onProgress: ({ pct, bytesPerSec }) => {
        setState((s) => (s.kind === 'uploading'
          ? { ...s, pct, speed: bytesPerSec }
          : s))
      },
      onSuccess: async ({ providerId }) => {
        const { error } = await setLessonVideo(supabase, lesson.id, {
          video_provider: provider.name,
          video_provider_id: providerId,
          video_status: 'ready',
          video_filename: file.name,
          video_size_bytes: file.size,
          video_mime: file.type,
          duration_seconds: duration ?? 0,
        })
        if (error) {
          setState({ kind: 'error', message: 'Upload xong nhưng không lưu được vào database.' })
          return
        }
        onLessonChange({
          video_provider: provider.name,
          video_provider_id: providerId,
          video_status: 'ready',
          video_filename: file.name,
          video_size_bytes: file.size,
          duration_seconds: duration ?? 0,
        })
        setState({ kind: 'ready' })
      },
      onError: async (err) => {
        await setLessonVideoStatus(supabase, lesson.id, 'error', err.message)
        onLessonChange({ video_status: 'error' })
        setState({ kind: 'error', message: err.message || 'Upload thất bại.' })
      },
    })

    setState((s) => (s.kind === 'uploading' ? { ...s, handle } : s))
  }

  const handleCancel = async () => {
    if (state.kind !== 'uploading') return
    state.handle?.abort()
    await setLessonVideoStatus(supabase, lesson.id, 'idle')
    onLessonChange({ video_status: 'idle' })
    setState({ kind: 'idle' })
  }

  const handleDelete = async () => {
    if (lesson.video_provider && lesson.video_provider_id) {
      try {
        await getProvider(lesson.video_provider).delete(lesson.video_provider_id)
      } catch (err) {
        console.warn('Xóa file storage thất bại, vẫn xóa record:', err)
      }
    }
    await clearLessonVideo(supabase, lesson.id)
    onLessonChange({
      video_provider: null,
      video_provider_id: null,
      video_status: 'idle',
      video_filename: null,
      video_size_bytes: null,
      duration_seconds: 0,
    })
    setState({ kind: 'idle' })
  }

  const handleReplace = async () => {
    await handleDelete()
    inputRef.current?.click()
  }

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void startUpload(file)
  }

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) void startUpload(file)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4"
        data-testid="video-file-input"
        onChange={onPickFile}
        style={{ display: 'none' }}
      />

      {/* Free preview toggle */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
        <div style={{ width: 180 }}>
          <span className="label">Free preview</span>
          <button
            type="button"
            role="button"
            aria-label="Free preview"
            aria-pressed={isFreePreview}
            onClick={() => onFreePreviewChange(!isFreePreview)}
            style={{
              width: '100%',
              height: 36,
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-sm)',
              background: isFreePreview ? 'var(--accent)' : 'var(--surface)',
              color: isFreePreview ? 'var(--ink-on-accent)' : 'var(--ink-1)',
              fontWeight: 500,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {isFreePreview ? 'On' : 'Off'}
          </button>
        </div>
        {isFreePreview && (
          <span style={{ fontSize: 12, color: 'var(--ink-3)', paddingBottom: 8 }}>
            Hiển thị cho mọi người, kể cả chưa mua khóa học.
          </span>
        )}
      </div>

      {/* Main video editor area */}
      {state.kind === 'idle' && (
        <div
          data-testid="video-drop-zone"
          onClick={() => inputRef.current?.click()}
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          style={{
            border: '1px dashed var(--border-strong)',
            borderRadius: 'var(--r-md)',
            padding: '40px 24px',
            textAlign: 'center',
            cursor: 'pointer',
            background: 'var(--surface)',
            color: 'var(--ink-2)',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--accent-soft)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--surface)' }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>↑</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-1)' }}>
            Kéo thả video MP4 vào đây
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 4 }}>
            hoặc nhấn để chọn · {VIDEO_LIMITS.allowedExtensionsLabel} · tối đa {VIDEO_LIMITS.maxBytesLabel}
          </div>
        </div>
      )}

      {state.kind === 'uploading' && (
        <div
          data-testid="video-uploading"
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            padding: 16,
            background: 'var(--surface)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>
              {state.filename}
            </span>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{bytesToHuman(state.size)}</span>
          </div>
          <div
            style={{
              width: '100%',
              height: 8,
              background: 'var(--surface-3)',
              borderRadius: 999,
              overflow: 'hidden',
            }}
          >
            <div
              data-testid="video-progress-fill"
              style={{
                width: `${state.pct}%`,
                height: '100%',
                background: 'var(--accent)',
                transition: 'width 0.2s linear',
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12, color: 'var(--ink-2)' }}>
            <span>{Math.round(state.pct)}% · {speedToHuman(state.speed)}</span>
            <button
              type="button"
              onClick={handleCancel}
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--danger)', height: 28, padding: '0 12px' }}
            >
              Hủy
            </button>
          </div>
        </div>
      )}

      {state.kind === 'ready' && (
        <div
          data-testid="video-ready"
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            padding: 16,
            background: 'var(--surface)',
            display: 'flex',
            gap: 16,
            alignItems: 'center',
          }}
        >
          <div
            style={{
              width: 120,
              aspectRatio: '16 / 9',
              background: 'var(--surface-2)',
              borderRadius: 'var(--r-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ink-3)',
              fontSize: 24,
              flexShrink: 0,
            }}
          >
            ▶
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {lesson.video_filename ?? 'Video lesson'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
              {durationToHuman(lesson.duration_seconds)}
              {lesson.video_size_bytes ? ` · ${bytesToHuman(lesson.video_size_bytes)}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={handleReplace} className="btn btn-secondary btn-sm">
              Thay video
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--danger)' }}
            >
              Xóa
            </button>
          </div>
        </div>
      )}

      {state.kind === 'error' && (
        <div
          role="alert"
          data-testid="video-error"
          style={{
            border: '1px solid var(--danger)',
            background: 'var(--danger-soft)',
            color: 'var(--danger)',
            borderRadius: 'var(--r-md)',
            padding: 16,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            fontSize: 13,
          }}
        >
          <span>{state.message}</span>
          <button
            type="button"
            onClick={() => setState({ kind: 'idle' })}
            className="btn btn-secondary btn-sm"
          >
            Thử lại
          </button>
        </div>
      )}
    </div>
  )
}
