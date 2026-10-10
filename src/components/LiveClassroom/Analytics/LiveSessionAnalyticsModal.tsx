import { useEffect } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import LiveSessionAnalyticsView from './LiveSessionAnalyticsView'

export interface LiveSessionAnalyticsModalProps {
  sessionId: string
  isOpen: boolean
  isSuspended?: boolean
  onClose: () => void
  supabaseClient?: SupabaseClient
  onOpenReplay?: (boardId?: string) => void
}

export default function LiveSessionAnalyticsModal({
  sessionId,
  isOpen,
  isSuspended = false,
  onClose,
  supabaseClient,
  onOpenReplay,
}: LiveSessionAnalyticsModalProps) {
  // Close on Escape key press (only active when modal is open and not suspended)
  useEffect(() => {
    if (!isOpen || isSuspended) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isSuspended, onClose])

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal={!isSuspended}
      aria-hidden={isSuspended}
      aria-label="Báo cáo phân tích buổi học"
      data-testid="live-session-analytics-modal"
      className={`fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-xs animate-in fade-in ${
        isSuspended ? 'hidden pointer-events-none' : ''
      }`}
    >
      <div
        className="w-full max-w-5xl h-[90vh] max-h-210 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <LiveSessionAnalyticsView
          sessionId={sessionId}
          supabaseClient={supabaseClient}
          onClose={onClose}
          onOpenReplay={onOpenReplay}
          className="w-full h-full"
        />
      </div>
    </div>
  )
}
