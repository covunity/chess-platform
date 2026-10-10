import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import ClassroomChat from '../Chat/ClassroomChat'
import type { LiveChatMessage } from '../../../types/liveChat'
import { LIVEKIT_TOPICS, getPracticeChatTopic } from '../../../types/liveClassroom'

// Mocks
const mockPublishData = vi.fn()
const mockRoom = {
  localParticipant: {
    identity: 'user-alice',
    name: 'Alice',
    publishData: mockPublishData,
  },
}

let registeredDataChannelHandler: ((msg: any) => void) | null = null

vi.mock('@livekit/components-react', () => ({
  useRoomContext: () => mockRoom,
  useDataChannel: (_topic: string, onMessage: (msg: any) => void) => {
    registeredDataChannelHandler = onMessage
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => {
      if (opts?.id) return `${key} ${opts.id}`
      if (key === 'liveClassroom.you') return 'You'
      return key
    },
    i18n: { language: 'en' },
  }),
}))

const mockSendLiveChatMessage = vi.fn()
const mockGetLiveChatMessages = vi.fn()

vi.mock('../../../lib/liveChatApi', () => ({
  sendLiveChatMessage: (...args: any[]) => mockSendLiveChatMessage(...args),
  getLiveChatMessages: (...args: any[]) => mockGetLiveChatMessages(...args),
}))

function makeIncomingMessage(payload: any, fromIdentity = 'user-bob', name = 'Bob') {
  return {
    payload: new TextEncoder().encode(JSON.stringify(payload)),
    from: { identity: fromIdentity, name },
    participant: { identity: fromIdentity, name },
  }
}

describe('ClassroomChat — Persistence, Hydration & Realtime Flow (TASK 8.1)', () => {
  const defaultProps = {
    isPrivate: false,
    sessionId: 'session-123',
    currentUserId: 'user-alice',
    currentUserName: 'Alice',
    teacherId: 'teacher-1',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    registeredDataChannelHandler = null
    mockPublishData.mockResolvedValue(undefined)
    mockSendLiveChatMessage.mockResolvedValue({ message: null, error: null })
    mockGetLiveChatMessages.mockResolvedValue({ messages: [], error: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('optimistic send: renders immediately and publishes before DB round-trip', async () => {
    render(<ClassroomChat {...defaultProps} />)

    const input = screen.getByRole('textbox')
    const sendButton = screen.getByRole('button', { name: /send/i })

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Hello world' } })
    })

    await act(async () => {
      fireEvent.click(sendButton)
    })

    // 1. Immediately rendered in UI
    expect(screen.getByText('Hello world')).toBeDefined()
    expect(screen.getByText('You')).toBeDefined()
    expect((input as HTMLInputElement).value).toBe('')

    // 2. Published to LiveKit DataChannel
    expect(mockPublishData).toHaveBeenCalledTimes(1)
    const [payloadBytes, options] = mockPublishData.mock.calls[0]
    expect(options.reliable).toBe(true)
    expect(options.topic).toBe(LIVEKIT_TOPICS.CHAT_MAIN)

    const decoded = JSON.parse(new TextDecoder().decode(payloadBytes))
    expect(decoded.type).toBe('CHAT_MESSAGE')
    expect(decoded.text).toBe('Hello world')
    expect(decoded.senderId).toBe('user-alice')
    expect(decoded.messageId).toContain('user-alice')

    // 3. Persisted to Supabase in background
    expect(mockSendLiveChatMessage).toHaveBeenCalledWith(undefined, {
      sessionId: 'session-123',
      scope: 'MAIN',
      boardId: null,
      message: 'Hello world',
      clientMessageId: decoded.messageId,
      senderDisplayName: 'Alice',
    })
  })

  it('realtime incoming message renders with canonical sender identity', async () => {
    render(<ClassroomChat {...defaultProps} />)

    const incomingPayload = {
      type: 'CHAT_MESSAGE',
      senderId: 'user-bob',
      senderName: 'Bob',
      messageId: 'bob-msg-1',
      text: 'Good morning everyone!',
      timestamp: Date.now(),
    }

    await act(async () => {
      registeredDataChannelHandler?.(makeIncomingMessage(incomingPayload, 'user-bob', 'Bob'))
    })

    expect(screen.getByText('Good morning everyone!')).toBeDefined()
    expect(screen.getByText('Bob')).toBeDefined()
  })

  it('persisted history hydration: loads and renders stored messages on mount', async () => {
    const mockHistory: LiveChatMessage[] = [
      {
        id: 'db-msg-1',
        live_session_id: 'session-123',
        scope: 'MAIN',
        board_id: null,
        sender_user_id: 'user-bob',
        sender_display_name: 'Bob',
        client_message_id: 'client-1',
        message: 'Persisted history msg 1',
        created_at: new Date(Date.now() - 10000).toISOString(),
      },
      {
        id: 'db-msg-2',
        live_session_id: 'session-123',
        scope: 'MAIN',
        board_id: null,
        sender_user_id: 'user-alice',
        sender_display_name: 'Alice',
        client_message_id: 'client-2',
        message: 'Persisted history msg 2',
        created_at: new Date(Date.now() - 5000).toISOString(),
      },
    ]

    mockGetLiveChatMessages.mockResolvedValueOnce({ messages: mockHistory, error: null })

    render(<ClassroomChat {...defaultProps} />)

    await waitFor(() => {
      expect(mockGetLiveChatMessages).toHaveBeenCalledWith(undefined, {
        sessionId: 'session-123',
        scope: 'MAIN',
        boardId: null,
        limit: 50,
      })
    })

    expect(await screen.findByText('Persisted history msg 1')).toBeDefined()
    expect(screen.getByText('Persisted history msg 2')).toBeDefined()
  })

  it('no duplicate when DataChannel echo arrives after optimistic send', async () => {
    render(<ClassroomChat {...defaultProps} />)

    const input = screen.getByRole('textbox')
    const sendButton = screen.getByRole('button', { name: /send/i })

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Unique optimistic message' } })
      fireEvent.click(sendButton)
    })

    const [payloadBytes] = mockPublishData.mock.calls[0]
    const sentPayload = JSON.parse(new TextDecoder().decode(payloadBytes))

    // Echo arrives back over LiveKit DataChannel
    await act(async () => {
      registeredDataChannelHandler?.(makeIncomingMessage(sentPayload, 'user-alice', 'Alice'))
    })

    // Exactly one instance of message rendered
    const matched = screen.getAllByText('Unique optimistic message')
    expect(matched.length).toBe(1)
  })

  it('no duplicate when LiveKit broadcast matches already hydrated message', async () => {
    const mockHistory: LiveChatMessage[] = [
      {
        id: 'db-msg-3',
        live_session_id: 'session-123',
        scope: 'MAIN',
        board_id: null,
        sender_user_id: 'user-bob',
        sender_display_name: 'Bob',
        client_message_id: 'shared-msg-id-100',
        message: 'Shared message',
        created_at: new Date().toISOString(),
      },
    ]
    mockGetLiveChatMessages.mockResolvedValueOnce({ messages: mockHistory, error: null })

    render(<ClassroomChat {...defaultProps} />)
    expect(await screen.findByText('Shared message')).toBeDefined()

    // Realtime packet arrives with same client_message_id
    await act(async () => {
      registeredDataChannelHandler?.(
        makeIncomingMessage(
          {
            type: 'CHAT_MESSAGE',
            senderId: 'user-bob',
            senderName: 'Bob',
            messageId: 'shared-msg-id-100',
            text: 'Shared message',
            timestamp: Date.now(),
          },
          'user-bob',
          'Bob'
        )
      )
    })

    const matches = screen.getAllByText('Shared message')
    expect(matches.length).toBe(1)
  })

  it('PRACTICE chat isolation: correctly targets board and opponent/teacher', async () => {
    render(
      <ClassroomChat
        {...defaultProps}
        isPrivate={true}
        boardId="board-5"
        opponentId="user-charlie"
      />
    )

    const input = screen.getByRole('textbox')
    const sendButton = screen.getByRole('button', { name: /send/i })

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Private board tactics' } })
      fireEvent.click(sendButton)
    })

    expect(mockPublishData).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reliable: true,
        topic: getPracticeChatTopic('board-5'),
        destinationIdentities: ['user-charlie', 'teacher-1'],
      })
    )

    expect(mockSendLiveChatMessage).toHaveBeenCalledWith(undefined, {
      sessionId: 'session-123',
      scope: 'PRACTICE',
      boardId: 'board-5',
      message: 'Private board tactics',
      clientMessageId: expect.any(String),
      senderDisplayName: 'Alice',
    })
  })

  it('sender identity spoofing: uses LiveKit transport identity rather than payload senderId', async () => {
    render(<ClassroomChat {...defaultProps} />)

    const spoofedPayload = {
      type: 'CHAT_MESSAGE',
      senderId: 'teacher-1', // Impersonating teacher in payload
      senderName: 'Grandmaster Teacher',
      messageId: 'spoofed-id-1',
      text: 'I am the teacher, trust me!',
      timestamp: Date.now(),
    }

    await act(async () => {
      registeredDataChannelHandler?.(
        makeIncomingMessage(spoofedPayload, 'user-attacker', 'Attacker Real Name')
      )
    })

    // Must show actual transport identity or transport name, NOT spoofed teacher name
    expect(screen.queryByText('Grandmaster Teacher')).toBeNull()
    expect(screen.getByText('Attacker Real Name')).toBeDefined()
  })

  it('malformed / empty / oversized messages are rejected safely', async () => {
    render(<ClassroomChat {...defaultProps} />)

    const input = screen.getByRole('textbox')
    const sendButton = screen.getByRole('button', { name: /send/i })

    // 1. Whitespace only cannot be sent
    await act(async () => {
      fireEvent.change(input, { target: { value: '    ' } })
      fireEvent.click(sendButton)
    })
    expect(mockPublishData).not.toHaveBeenCalled()

    // 2. Malformed incoming payload does not crash
    await act(async () => {
      registeredDataChannelHandler?.({
        payload: new TextEncoder().encode('not-valid-json{{{'),
        from: { identity: 'user-bob' },
      })
    })

    // 3. Oversized incoming message (> 1000 chars) is ignored
    const oversizedPayload = {
      type: 'CHAT_MESSAGE',
      senderId: 'user-bob',
      messageId: 'oversized-1',
      text: 'a'.repeat(1005),
      timestamp: Date.now(),
    }
    await act(async () => {
      registeredDataChannelHandler?.(makeIncomingMessage(oversizedPayload, 'user-bob'))
    })
    expect(screen.queryByText('a'.repeat(1005))).toBeNull()
  })

  it('session and board changes clear previous scoped chat correctly', async () => {
    const { rerender } = render(
      <ClassroomChat
        {...defaultProps}
        isPrivate={true}
        boardId="board-1"
      />
    )

    const input = screen.getByRole('textbox')
    const sendButton = screen.getByRole('button', { name: /send/i })

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Board 1 Message' } })
      fireEvent.click(sendButton)
    })
    expect(screen.getByText('Board 1 Message')).toBeDefined()

    // Switch to board-2
    await act(async () => {
      rerender(
        <ClassroomChat
          {...defaultProps}
          isPrivate={true}
          boardId="board-2"
        />
      )
    })

    // Board 1 message should be cleared
    expect(screen.queryByText('Board 1 Message')).toBeNull()
    expect(mockGetLiveChatMessages).toHaveBeenLastCalledWith(undefined, {
      sessionId: 'session-123',
      scope: 'PRACTICE',
      boardId: 'board-2',
      limit: 50,
    })
  })

  it('failure semantics: DB persistence rejection does not crash UI or prevent realtime delivery', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockSendLiveChatMessage.mockRejectedValueOnce(new Error('Network disconnected from Supabase'))

    render(<ClassroomChat {...defaultProps} />)

    const input = screen.getByRole('textbox')
    const sendButton = screen.getByRole('button', { name: /send/i })

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Realtime still works' } })
      fireEvent.click(sendButton)
    })

    // Message rendered optimistically
    expect(screen.getByText('Realtime still works')).toBeDefined()

    // LiveKit publish executed
    expect(mockPublishData).toHaveBeenCalledTimes(1)

    // DB failure logged gracefully without crashing
    await waitFor(() => {
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('ClassroomChat'),
        expect.any(Error)
      )
    })
    consoleWarnSpy.mockRestore()
  })

  it('failure semantics: LiveKit publish failure still allows DB persistence and optimistic UI', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockPublishData.mockImplementationOnce(() => {
      throw new Error('DataChannel transport error')
    })

    render(<ClassroomChat {...defaultProps} />)

    const input = screen.getByRole('textbox')
    const sendButton = screen.getByRole('button', { name: /send/i })

    await act(async () => {
      fireEvent.change(input, { target: { value: 'DB will still persist' } })
      fireEvent.click(sendButton)
    })

    // 1. Rendered optimistically
    expect(screen.getByText('DB will still persist')).toBeDefined()

    // 2. DB persistence was still invoked
    expect(mockSendLiveChatMessage).toHaveBeenCalledWith(undefined, {
      sessionId: 'session-123',
      scope: 'MAIN',
      boardId: null,
      message: 'DB will still persist',
      clientMessageId: expect.any(String),
      senderDisplayName: 'Alice',
    })

    // 3. LiveKit publish error caught and logged
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('ClassroomChat: Failed to publish data'),
      expect.any(Error)
    )
    consoleWarnSpy.mockRestore()
  })

  it('component unmount immediately after send does not cause an unhandled rejection', async () => {
    let resolveDb: (val: any) => void
    const dbPromise = new Promise((resolve) => {
      resolveDb = resolve
    })
    mockSendLiveChatMessage.mockReturnValueOnce(dbPromise)

    const { unmount } = render(<ClassroomChat {...defaultProps} />)

    const input = screen.getByRole('textbox')
    const sendButton = screen.getByRole('button', { name: /send/i })

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Message before unmount' } })
      fireEvent.click(sendButton)
    })

    // Unmount while DB call is in flight
    unmount()

    // Resolve DB call after unmount
    await act(async () => {
      resolveDb!({ message: { id: 'persisted-1' }, error: null })
    })

    // Successfully completed without throwing unhandled rejection or crashing
    expect(mockSendLiveChatMessage).toHaveBeenCalledTimes(1)
  })

  it('missing sessionId does not call DB persistence or falsely report persistence success', async () => {
    render(<ClassroomChat {...defaultProps} sessionId={undefined} />)

    const input = screen.getByRole('textbox')
    const sendButton = screen.getByRole('button', { name: /send/i })

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Ephemeral message only' } })
      fireEvent.click(sendButton)
    })

    // UI renders optimistically
    expect(screen.getByText('Ephemeral message only')).toBeDefined()

    // LiveKit publishes
    expect(mockPublishData).toHaveBeenCalledTimes(1)

    // DB persistence is NOT called when sessionId is missing
    expect(mockSendLiveChatMessage).not.toHaveBeenCalled()
  })

  it('defense-in-depth: unauthorized practice message over transport is dropped by client-side filter', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(
      <ClassroomChat
        {...defaultProps}
        isPrivate={true}
        boardId="board-10"
        opponentId="user-bob"
      />
    )

    // Attacker sends message on board-10 topic, but attacker is NOT teacher and NOT assigned player
    const unauthorizedPayload = {
      type: 'CHAT_MESSAGE',
      senderId: 'user-intruder',
      senderName: 'Intruder',
      messageId: 'intruder-msg-1',
      text: 'Intruder chat in board 10',
      boardId: 'board-10',
      timestamp: Date.now(),
    }

    await act(async () => {
      registeredDataChannelHandler?.(
        makeIncomingMessage(unauthorizedPayload, 'user-intruder', 'Intruder')
      )
    })

    // UI never renders the unauthorized message
    expect(screen.queryByText('Intruder chat in board 10')).toBeNull()
    consoleWarnSpy.mockRestore()
  })
})
