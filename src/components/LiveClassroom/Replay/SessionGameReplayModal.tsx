import { useEffect } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import SessionGameReplay from './SessionGameReplay'

export interface SessionGameReplayModalProps {
  sessionId: string
  isOpen: boolean
  onClose: () => void
  supabaseClient?: SupabaseClient
  initialGameId?: string
  initialBoardId?: string
}

export default function SessionGameReplayModal({
  sessionId,
  isOpen,
  onClose,
  supabaseClient,
  initialGameId,
  initialBoardId,
}: SessionGameReplayModalProps) {
  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Xem lại ván cờ buổi học"
      data-testid="session-game-replay-modal"
      className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-xs animate-in fade-in"
    >
      <div
        className="w-full max-w-5xl h-[90vh] max-h-210 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <SessionGameReplay
          sessionId={sessionId}
          supabaseClient={supabaseClient}
          initialGameId={initialGameId}
          initialBoardId={initialBoardId}
          onClose={onClose}
          className="w-full h-full"
        />
      </div>
    </div>
  )
}
