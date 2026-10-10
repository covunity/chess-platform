import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useRoomContext, useDataChannel } from '@livekit/components-react'
import { Send, MessageSquare } from 'lucide-react'
import {
  type ChatMessagePayload,
  LIVEKIT_TOPICS,
  getPracticeChatTopic,
} from '../../../types/liveClassroom'
import { useLiveClassroomStore } from '../useLiveClassroomStore'
import {
  getTransportSenderIdentity,
  isAuthorizedTeacher,
  type LiveKitMessageLike,
} from '../liveClassroomSecurity'
import { sendLiveChatMessage, getLiveChatMessages } from '../../../lib/liveChatApi'

export interface ClassroomChatProps {
  isPrivate: boolean
  opponentId?: string
  teacherId?: string
  boardId?: string
  sessionId?: string
  currentUserId: string
  currentUserName?: string
  embedded?: boolean
}

export default function ClassroomChat({
  isPrivate,
  opponentId,
  teacherId,
  boardId,
  sessionId,
  currentUserId,
  currentUserName,
  embedded = false,
}: ClassroomChatProps) {
  const { t } = useTranslation()
  const room = useRoomContext()
  const [messages, setMessages] = useState<ChatMessagePayload[]>([])
  const [inputText, setInputText] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const seenMessageIds = useRef<Set<string>>(new Set())

  const storeTeacherId = useLiveClassroomStore((s) => s.teacherId)
  const practiceAssignments = useLiveClassroomStore((s) => s.practiceAssignments)
  const effectiveTeacherId = teacherId || storeTeacherId || undefined

  const topic = isPrivate && boardId
    ? getPracticeChatTopic(boardId)
    : LIVEKIT_TOPICS.CHAT_MAIN

  // Auto-scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' })
  }, [messages])

  // Hydrate persisted chat history when entering session or switching boards
  useEffect(() => {
    let isCancelled = false

    // Clear in-memory chat state and deduplication cache on session/board/scope switch
    setMessages([])
    seenMessageIds.current.clear()

    if (!sessionId) return

    getLiveChatMessages(undefined, {
      sessionId,
      scope: isPrivate ? 'PRACTICE' : 'MAIN',
      boardId: isPrivate ? (boardId || null) : null,
      limit: 50,
    })
      .then(({ messages: history, error }) => {
        if (isCancelled) return
        if (error) {
          console.warn('ClassroomChat: Failed to load chat history', error)
          return
        }

        if (history && history.length > 0) {
          const loaded: ChatMessagePayload[] = []
          for (const m of history) {
            const clientMsgId = m.client_message_id || m.id
            seenMessageIds.current.add(clientMsgId)
            seenMessageIds.current.add(m.id)

            loaded.push({
              type: 'CHAT_MESSAGE',
              messageId: clientMsgId,
              senderId: m.sender_user_id,
              senderName:
                m.sender_display_name ||
                (m.sender_user_id === currentUserId
                  ? currentUserName || t('liveClassroom.you')
                  : t('liveClassroom.participant')),
              text: m.message,
              timestamp: new Date(m.created_at).getTime(),
              boardId: m.board_id || undefined,
            })
          }

          setMessages((prev) => {
            if (prev.length === 0) return loaded
            const existingIds = new Set(prev.map((p) => p.messageId))
            const newFromHistory = loaded.filter((h) => !existingIds.has(h.messageId))
            return [...newFromHistory, ...prev]
          })
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          console.warn('ClassroomChat: Unexpected error loading history', err)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [sessionId, isPrivate, boardId, currentUserId, currentUserName])

  // Handle incoming chat messages
  const handleIncomingMessage = useCallback(
    (msg: LiveKitMessageLike) => {
      try {
        const senderIdentity = getTransportSenderIdentity(msg)
        if (!senderIdentity) return

        const text = new TextDecoder().decode(msg.payload)
        const payload = JSON.parse(text) as ChatMessagePayload

        if (payload.type !== 'CHAT_MESSAGE') return
        if (!payload.messageId || typeof payload.messageId !== 'string') return
        if (!payload.text || typeof payload.text !== 'string' || !payload.text.trim()) return
        if (payload.text.length > 1000) return
        if (seenMessageIds.current.has(payload.messageId)) return

        // Scoping for private practice chat
        if (isPrivate && boardId) {
          const isSenderTeacher = isAuthorizedTeacher(senderIdentity, msg, effectiveTeacherId)
          const assignment = practiceAssignments.find((a) => a.boardId === boardId)
          const isAssignedPlayer = assignment
            ? senderIdentity === assignment.whiteUserId || senderIdentity === assignment.blackUserId
            : senderIdentity === opponentId || senderIdentity === currentUserId

          if (!isSenderTeacher && !isAssignedPlayer) {
            if (import.meta.env.DEV) {
              console.warn(`ClassroomChat: Unauthorized practice chat message for board ${boardId} from`, senderIdentity)
            }
            return
          }
        }

        // Canonical sender identity from transport metadata - never trust payload.senderId
        const canonicalSenderName =
          msg.from?.name ||
          msg.participant?.name ||
          (payload.senderId === senderIdentity ? payload.senderName : undefined) ||
          senderIdentity

        const sanitizedPayload: ChatMessagePayload = {
          ...payload,
          senderId: senderIdentity,
          senderName: canonicalSenderName,
        }

        seenMessageIds.current.add(payload.messageId)
        setMessages((prev) => [...prev, sanitizedPayload])
      } catch {
        // ignore malformed payloads safely
      }
    },
    [isPrivate, boardId, effectiveTeacherId, opponentId, currentUserId, practiceAssignments]
  )

  useDataChannel(topic, handleIncomingMessage)

  // Send outgoing chat message
  const handleSendMessage = (e?: React.FormEvent) => {
    e?.preventDefault()
    const trimmed = inputText.trim()
    if (!trimmed) return

    // Cap message length at 500 chars
    const safeText = trimmed.slice(0, 500)
    const messageId = `${currentUserId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`

    const payload: ChatMessagePayload = {
      type: 'CHAT_MESSAGE',
      senderId: currentUserId,
      senderName: currentUserName || 'Me',
      messageId,
      text: safeText,
      timestamp: Date.now(),
      boardId: isPrivate ? boardId : undefined,
    }

    seenMessageIds.current.add(messageId)
    setMessages((prev) => [...prev, payload])
    setInputText('')

    // 1. Publish to LiveKit DataChannel immediately (non-blocking)
    try {
      const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))

      if (!isPrivate) {
        // Main classroom broadcast — NEVER set destinationIdentities
        room.localParticipant.publishData(payloadBytes, {
          reliable: true,
          topic: LIVEKIT_TOPICS.CHAT_MAIN,
        })
      } else if (boardId) {
        // Private practice board chat — target opponent and teacher
        const targets = [opponentId, teacherId].filter(
          (id): id is string => Boolean(id && id.trim() && id !== currentUserId)
        )

        room.localParticipant.publishData(payloadBytes, {
          reliable: true,
          topic: getPracticeChatTopic(boardId),
          destinationIdentities: targets.length > 0 ? targets : undefined,
        })
      }
    } catch (publishErr) {
      console.warn('ClassroomChat: Failed to publish data over LiveKit', publishErr)
    }

    // 2. Persist to Supabase asynchronously in background (independent of realtime delivery)
    if (sessionId) {
      sendLiveChatMessage(undefined, {
        sessionId,
        scope: isPrivate ? 'PRACTICE' : 'MAIN',
        boardId: isPrivate ? (boardId || null) : null,
        message: safeText,
        clientMessageId: messageId,
        senderDisplayName: currentUserName || null,
      })
        .then(({ error }) => {
          if (error) {
            console.warn('ClassroomChat: Failed to persist chat message to Supabase', error)
          }
        })
        .catch((persistErr) => {
          console.warn('ClassroomChat: Failed to persist chat message to Supabase', persistErr)
        })
    }
  }

  return (
    <div
      className={`flex flex-col h-full bg-(--surface) overflow-hidden ${
        embedded ? 'border-t border-(--border)' : 'rounded-lg border border-(--border) shadow-xs'
      }`}
    >
      {/* Header */}
      <div className="px-3 py-2.5 bg-(--surface-2) border-b border-(--border) flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-(--accent)" />
        <span className="text-xs font-semibold text-(--ink-1)">
          {isPrivate ? t('liveClassroom.practiceChat', { id: boardId ? `(#${boardId})` : '' }) : t('liveClassroom.classroomChat')}
        </span>
      </div>

      {/* Messages list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 text-xs">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-(--ink-4) italic text-center px-4">
            {isPrivate
              ? t('liveClassroom.noPracticeMessages')
              : t('liveClassroom.noMessages')}
          </div>
        ) : (
          messages.map((m) => {
            const isMe = m.senderId === currentUserId
            return (
              <div
                key={m.messageId}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
              >
                <div className="flex items-baseline gap-1.5 mb-0.5">
                  <span className="font-semibold text-[11px] text-(--ink-2)">
                    {isMe ? t('liveClassroom.you') : m.senderName || t('liveClassroom.participant')}
                  </span>
                  <span className="text-[10px] text-(--ink-4)">
                    {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div
                  className={`px-3 py-1.5 rounded-lg max-w-[85%] break-words leading-relaxed ${
                    isMe
                      ? 'bg-(--accent) text-white rounded-br-none'
                      : 'bg-(--surface-3) text-(--ink-1) rounded-bl-none'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <form
        onSubmit={handleSendMessage}
        className="p-2 border-t border-(--border) bg-(--surface) flex items-center gap-2"
      >
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={isPrivate ? t('liveClassroom.practiceChatPlaceholder') : t('liveClassroom.chatPlaceholder')}
          maxLength={500}
          className="flex-1 px-3 py-1.5 text-xs bg-(--surface-2) border border-(--border) rounded-md text-(--ink-1) placeholder:text-(--ink-4) focus:outline-none focus:ring-1 focus:ring-(--accent)"
        />
        <button
          type="submit"
          disabled={!inputText.trim()}
          aria-label={t('liveClassroom.send')}
          className="p-1.5 bg-(--accent) text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  )
}
