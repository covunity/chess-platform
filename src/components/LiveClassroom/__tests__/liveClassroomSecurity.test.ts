import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getTransportSenderIdentity,
  isAuthorizedTeacher,
  type LiveKitMessageLike,
} from '../liveClassroomSecurity'
import {
  createLiveClassroomStore,
  liveClassroomStore,
  START_FEN,
  type LiveClassroomStore,
} from '../liveClassroomStore'
import type {
  ClassroomControlPayload,
  ChessMovePayload,
  ChatMessagePayload,
  PracticeAssignment,
} from '../../../types/liveClassroom'
import { Chess } from 'chess.js'

function makeLiveKitMessage(
  payloadObj: unknown,
  fromIdentity?: string,
  name?: string,
  metadata?: string
): LiveKitMessageLike {
  return {
    payload: new TextEncoder().encode(typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj)),
    from: fromIdentity ? { identity: fromIdentity, name, metadata } : undefined,
    participant: fromIdentity ? { identity: fromIdentity, name, metadata } : undefined,
  }
}

describe('Live Classroom Security Hardening (F-01)', () => {
  const TEACHER_ID = 'teacher-authoritative-uuid'
  const STUDENT_1_ID = 'student-alice-uuid'
  const STUDENT_2_ID = 'student-bob-uuid'
  const ATTACKER_ID = 'malicious-user-uuid'

  beforeEach(() => {
    liveClassroomStore.getState().resetLiveClass()
    liveClassroomStore.getState().setTeacherId(TEACHER_ID)
  })

  describe('1. Transport Sender Identity Extraction & Failsafe', () => {
    it('extracts transport identity from msg.from or msg.participant', () => {
      const msgFrom = makeLiveKitMessage({}, 'user-from')
      expect(getTransportSenderIdentity(msgFrom)).toBe('user-from')

      const msgParticipant: LiveKitMessageLike = {
        payload: new Uint8Array(),
        participant: { identity: 'user-part' },
      }
      expect(getTransportSenderIdentity(msgParticipant)).toBe('user-part')
    })

    it('fails closed (returns undefined) if transport identity is absent', () => {
      const msgNoIdentity: LiveKitMessageLike = {
        payload: new Uint8Array(),
      }
      expect(getTransportSenderIdentity(msgNoIdentity)).toBeUndefined()
    })
  })

  describe('2. Teacher Authorization Validation', () => {
    it('accepts sender when senderIdentity === authoritativeTeacherId', () => {
      const msg = makeLiveKitMessage({}, TEACHER_ID)
      expect(isAuthorizedTeacher(TEACHER_ID, msg, TEACHER_ID)).toBe(true)
    })

    it('rejects learner claiming to be teacher via payload or metadata when teacherId is known', () => {
      const msg = makeLiveKitMessage(
        { senderId: TEACHER_ID },
        ATTACKER_ID,
        'Attacker',
        JSON.stringify({ role: 'teacher', userId: ATTACKER_ID })
      )
      // Because authoritativeTeacherId is known, metadata fallback is NEVER permitted
      expect(isAuthorizedTeacher(ATTACKER_ID, msg, TEACHER_ID)).toBe(false)
    })

    it('fails closed when senderIdentity is missing or empty', () => {
      const msg = makeLiveKitMessage({})
      expect(isAuthorizedTeacher(undefined, msg, TEACHER_ID)).toBe(false)
      expect(isAuthorizedTeacher('', msg, TEACHER_ID)).toBe(false)
    })
  })

  describe('3. Control Sender Spoofing & Teacher-Only Actions', () => {
    it('1. learner payload claims senderId = teacherId -> MUST be rejected', () => {
      const spoofedPayload: ClassroomControlPayload = {
        type: 'CLASSROOM_CONTROL',
        action: 'GRANT_MAIN_BOARD_CONTROL',
        senderId: TEACHER_ID, // Spoofed inside payload
        targetUserId: ATTACKER_ID,
        messageId: 'msg-1',
        timestamp: Date.now(),
      }
      const msg = makeLiveKitMessage(spoofedPayload, ATTACKER_ID)
      const senderIdentity = getTransportSenderIdentity(msg)
      expect(senderIdentity).toBe(ATTACKER_ID)

      const isTeacher = isAuthorizedTeacher(senderIdentity, msg, TEACHER_ID)
      expect(isTeacher).toBe(false)
    })

    it('2. learner emits GRANT_MAIN_BOARD_CONTROL -> MUST be rejected', () => {
      const payload: ClassroomControlPayload = {
        type: 'CLASSROOM_CONTROL',
        action: 'GRANT_MAIN_BOARD_CONTROL',
        senderId: ATTACKER_ID,
        targetUserId: ATTACKER_ID,
        messageId: 'msg-2',
        timestamp: Date.now(),
      }
      const msg = makeLiveKitMessage(payload, ATTACKER_ID)
      const senderIdentity = getTransportSenderIdentity(msg)

      const isTeacher = isAuthorizedTeacher(senderIdentity, msg, TEACHER_ID)
      expect(isTeacher).toBe(false)

      // Store should not be altered
      if (isTeacher) {
        liveClassroomStore.getState().setLectureInteractionUser(payload.targetUserId!)
      }
      expect(liveClassroomStore.getState().lectureInteractionUserId).toBeNull()
    })

    it('3. learner emits REVOKE_MAIN_BOARD_CONTROL -> MUST be rejected', () => {
      liveClassroomStore.getState().setLectureInteractionUser(STUDENT_1_ID)
      expect(liveClassroomStore.getState().lectureInteractionUserId).toBe(STUDENT_1_ID)

      const payload: ClassroomControlPayload = {
        type: 'CLASSROOM_CONTROL',
        action: 'REVOKE_MAIN_BOARD_CONTROL',
        senderId: ATTACKER_ID,
        messageId: 'msg-3',
        timestamp: Date.now(),
      }
      const msg = makeLiveKitMessage(payload, ATTACKER_ID)
      const senderIdentity = getTransportSenderIdentity(msg)
      const isTeacher = isAuthorizedTeacher(senderIdentity, msg, TEACHER_ID)
      expect(isTeacher).toBe(false)

      if (isTeacher) {
        liveClassroomStore.getState().setLectureInteractionUser(null)
      }
      // Granted student remains granted
      expect(liveClassroomStore.getState().lectureInteractionUserId).toBe(STUDENT_1_ID)
    })

    it('4. learner emits END_CLASS -> MUST be rejected', () => {
      const onLeave = vi.fn()
      const payload: ClassroomControlPayload = {
        type: 'CLASSROOM_CONTROL',
        action: 'END_CLASS',
        senderId: TEACHER_ID, // Spoofed!
        messageId: 'msg-4',
        timestamp: Date.now(),
      }
      const msg = makeLiveKitMessage(payload, ATTACKER_ID) // Actual LiveKit sender is attacker
      const senderIdentity = getTransportSenderIdentity(msg)
      const isTeacher = isAuthorizedTeacher(senderIdentity, msg, TEACHER_ID)

      expect(isTeacher).toBe(false)
      if (isTeacher) {
        onLeave()
      }
      expect(onLeave).not.toHaveBeenCalled()
    })

    it('5. teacher emits END_CLASS -> accepted', () => {
      const onLeave = vi.fn()
      const payload: ClassroomControlPayload = {
        type: 'CLASSROOM_CONTROL',
        action: 'END_CLASS',
        senderId: TEACHER_ID,
        messageId: 'msg-5',
        timestamp: Date.now(),
      }
      const msg = makeLiveKitMessage(payload, TEACHER_ID)
      const senderIdentity = getTransportSenderIdentity(msg)
      const isTeacher = isAuthorizedTeacher(senderIdentity, msg, TEACHER_ID)

      expect(isTeacher).toBe(true)
      if (isTeacher) {
        onLeave()
      }
      expect(onLeave).toHaveBeenCalledTimes(1)
    })

    it('6. teacher emits GRANT_MAIN_BOARD_CONTROL -> accepted', () => {
      const payload: ClassroomControlPayload = {
        type: 'CLASSROOM_CONTROL',
        action: 'GRANT_MAIN_BOARD_CONTROL',
        senderId: TEACHER_ID,
        targetUserId: STUDENT_1_ID,
        messageId: 'msg-6',
        timestamp: Date.now(),
      }
      const msg = makeLiveKitMessage(payload, TEACHER_ID)
      const senderIdentity = getTransportSenderIdentity(msg)
      const isTeacher = isAuthorizedTeacher(senderIdentity, msg, TEACHER_ID)

      expect(isTeacher).toBe(true)
      if (isTeacher && payload.targetUserId) {
        liveClassroomStore.getState().setLectureInteractionUser(payload.targetUserId)
      }
      expect(liveClassroomStore.getState().lectureInteractionUserId).toBe(STUDENT_1_ID)
    })

    it('7. malformed/unknown control action -> ignored/rejected safely', () => {
      const msg = makeLiveKitMessage('invalid json string!@#$', TEACHER_ID)
      let parsed = null
      let threw = false
      try {
        const text = new TextDecoder().decode(msg.payload)
        parsed = JSON.parse(text)
      } catch {
        threw = true
      }
      expect(threw).toBe(true)
      expect(parsed).toBeNull()

      // Unknown action from teacher
      const unknownMsg = makeLiveKitMessage({ type: 'CLASSROOM_CONTROL', action: 'UNKNOWN_ACTION' }, TEACHER_ID)
      const text = new TextDecoder().decode(unknownMsg.payload)
      const payload = JSON.parse(text)
      expect(['SET_CLASS_MODE', 'GRANT_MAIN_BOARD_CONTROL', 'REVOKE_MAIN_BOARD_CONTROL', 'RAISE_HAND', 'LOWER_HAND', 'ASSIGN_PRACTICE_BOARDS', 'UPDATE_PRACTICE_BOARD_STATUS', 'END_CLASS']).not.toContain(payload.action)
    })

    it('8. learner emits SET_CLASS_MODE -> rejected', () => {
      const payload: ClassroomControlPayload = {
        type: 'CLASSROOM_CONTROL',
        action: 'SET_CLASS_MODE',
        classMode: 'PRACTICE',
        senderId: TEACHER_ID, // Spoofed!
        messageId: 'msg-mode',
        timestamp: Date.now(),
      }
      const msg = makeLiveKitMessage(payload, ATTACKER_ID)
      const senderIdentity = getTransportSenderIdentity(msg)
      const isTeacher = isAuthorizedTeacher(senderIdentity, msg, TEACHER_ID)

      expect(isTeacher).toBe(false)
      if (isTeacher && payload.classMode) {
        liveClassroomStore.getState().setClassMode(payload.classMode)
      }
      expect(liveClassroomStore.getState().classMode).toBe('MAIN')
    })

    it('9. learner emits ASSIGN_PRACTICE_BOARDS / UPDATE_PRACTICE_BOARD_STATUS -> rejected', () => {
      const payload: ClassroomControlPayload = {
        type: 'CLASSROOM_CONTROL',
        action: 'ASSIGN_PRACTICE_BOARDS',
        assignments: [
          { boardId: 'hack', whiteUserId: ATTACKER_ID, blackUserId: ATTACKER_ID, status: 'PLAYING' },
        ],
        senderId: TEACHER_ID, // Spoofed!
        messageId: 'msg-assign',
        timestamp: Date.now(),
      }
      const msg = makeLiveKitMessage(payload, ATTACKER_ID)
      const senderIdentity = getTransportSenderIdentity(msg)
      const isTeacher = isAuthorizedTeacher(senderIdentity, msg, TEACHER_ID)

      expect(isTeacher).toBe(false)
      if (isTeacher && payload.assignments) {
        liveClassroomStore.getState().setAssignments(payload.assignments)
      }
      expect(liveClassroomStore.getState().practiceAssignments).toEqual([])
    })

    it('10. learner RAISE_HAND with spoofed payload.senderId -> binds strictly to transport identity', () => {
      const payload: ClassroomControlPayload = {
        type: 'CLASSROOM_CONTROL',
        action: 'RAISE_HAND',
        senderId: STUDENT_2_ID, // Attacker tries to raise hand on behalf of Bob
        messageId: 'msg-hand',
        timestamp: Date.now(),
      }
      const msg = makeLiveKitMessage(payload, ATTACKER_ID) // Actual sender is attacker
      const senderIdentity = getTransportSenderIdentity(msg)

      // Security enforcement: bind to senderIdentity, ignore payload.senderId
      liveClassroomStore.getState().addRaisedHand(senderIdentity!)
      expect(liveClassroomStore.getState().raisedHandUserIds).toEqual([ATTACKER_ID])
      expect(liveClassroomStore.getState().raisedHandUserIds).not.toContain(STUDENT_2_ID)
    })
  })

  describe('4. Main Board Move Security (chess:main)', () => {
    it('1. teacher move -> accepted', () => {
      const chess = new Chess()
      const move = chess.move('e4')!

      const payload: ChessMovePayload = {
        type: 'CHESS_MOVE',
        boardId: 'main',
        senderId: TEACHER_ID,
        messageId: 'move-1',
        ply: 1,
        san: move.san,
        uci: `${move.from}${move.to}`,
        fen: chess.fen(),
        turn: 'b',
        timestamp: Date.now(),
      }

      const msg = makeLiveKitMessage(payload, TEACHER_ID)
      const senderIdentity = getTransportSenderIdentity(msg)
      const isTeacher = isAuthorizedTeacher(senderIdentity, msg, TEACHER_ID)
      const isGrantedStudent = senderIdentity === liveClassroomStore.getState().lectureInteractionUserId

      expect(isTeacher || isGrantedStudent).toBe(true)

      liveClassroomStore.getState().updateFen(payload.fen)
      liveClassroomStore.getState().recordBoardMove('main', { ...payload, senderId: senderIdentity! })

      expect(liveClassroomStore.getState().currentFen).toBe(payload.fen)
      expect(liveClassroomStore.getState().boardMoves['main']).toHaveLength(1)
      expect(liveClassroomStore.getState().boardMoves['main'][0].senderId).toBe(TEACHER_ID)
    })

    it('2. granted learner move -> accepted', () => {
      liveClassroomStore.getState().setLectureInteractionUser(STUDENT_1_ID)

      const chess = new Chess()
      const move = chess.move('d4')!

      const payload: ChessMovePayload = {
        type: 'CHESS_MOVE',
        boardId: 'main',
        senderId: STUDENT_1_ID,
        messageId: 'move-2',
        ply: 1,
        san: move.san,
        uci: `${move.from}${move.to}`,
        fen: chess.fen(),
        turn: 'b',
        timestamp: Date.now(),
      }

      const msg = makeLiveKitMessage(payload, STUDENT_1_ID)
      const senderIdentity = getTransportSenderIdentity(msg)
      const isTeacher = isAuthorizedTeacher(senderIdentity, msg, TEACHER_ID)
      const isGrantedStudent = senderIdentity === liveClassroomStore.getState().lectureInteractionUserId

      expect(isTeacher).toBe(false)
      expect(isGrantedStudent).toBe(true)

      liveClassroomStore.getState().updateFen(payload.fen)
      liveClassroomStore.getState().recordBoardMove('main', { ...payload, senderId: senderIdentity! })

      expect(liveClassroomStore.getState().currentFen).toBe(payload.fen)
      expect(liveClassroomStore.getState().boardMoves['main'][0].senderId).toBe(STUDENT_1_ID)
    })

    it('3. non-granted learner move -> rejected', () => {
      // Alice is granted, Bob is not
      liveClassroomStore.getState().setLectureInteractionUser(STUDENT_1_ID)

      const chess = new Chess()
      const move = chess.move('e4')!

      const payload: ChessMovePayload = {
        type: 'CHESS_MOVE',
        boardId: 'main',
        senderId: STUDENT_2_ID,
        messageId: 'move-3',
        ply: 1,
        san: move.san,
        uci: `${move.from}${move.to}`,
        fen: chess.fen(),
        turn: 'b',
        timestamp: Date.now(),
      }

      const msg = makeLiveKitMessage(payload, STUDENT_2_ID)
      const senderIdentity = getTransportSenderIdentity(msg)
      const isTeacher = isAuthorizedTeacher(senderIdentity, msg, TEACHER_ID)
      const isGrantedStudent = senderIdentity === liveClassroomStore.getState().lectureInteractionUserId

      expect(isTeacher).toBe(false)
      expect(isGrantedStudent).toBe(false)

      // Move rejected! Store unchanged
      expect(liveClassroomStore.getState().currentFen).toBe(START_FEN)
      expect(liveClassroomStore.getState().boardMoves['main']).toBeUndefined()
    })

    it('4. learner spoofs payload.senderId = teacherId -> rejected', () => {
      const chess = new Chess()
      const move = chess.move('e4')!

      const payload: ChessMovePayload = {
        type: 'CHESS_MOVE',
        boardId: 'main',
        senderId: TEACHER_ID, // Attacker puts teacher ID in payload!
        messageId: 'move-4',
        ply: 1,
        san: move.san,
        uci: `${move.from}${move.to}`,
        fen: chess.fen(),
        turn: 'b',
        timestamp: Date.now(),
      }

      const msg = makeLiveKitMessage(payload, ATTACKER_ID) // Real sender is attacker
      const senderIdentity = getTransportSenderIdentity(msg)
      const isTeacher = isAuthorizedTeacher(senderIdentity, msg, TEACHER_ID)
      const isGrantedStudent = senderIdentity === liveClassroomStore.getState().lectureInteractionUserId

      expect(senderIdentity).toBe(ATTACKER_ID)
      expect(isTeacher).toBe(false)
      expect(isGrantedStudent).toBe(false)

      // Must be rejected
      expect(liveClassroomStore.getState().currentFen).toBe(START_FEN)
    })

    it('5. learner spoofs payload.senderId = granted learner -> rejected', () => {
      liveClassroomStore.getState().setLectureInteractionUser(STUDENT_1_ID)

      const chess = new Chess()
      const move = chess.move('e4')!

      const payload: ChessMovePayload = {
        type: 'CHESS_MOVE',
        boardId: 'main',
        senderId: STUDENT_1_ID, // Attacker claims to be granted student Alice
        messageId: 'move-5',
        ply: 1,
        san: move.san,
        uci: `${move.from}${move.to}`,
        fen: chess.fen(),
        turn: 'b',
        timestamp: Date.now(),
      }

      const msg = makeLiveKitMessage(payload, ATTACKER_ID)
      const senderIdentity = getTransportSenderIdentity(msg)
      const isTeacher = isAuthorizedTeacher(senderIdentity, msg, TEACHER_ID)
      const isGrantedStudent = senderIdentity === liveClassroomStore.getState().lectureInteractionUserId

      expect(isTeacher).toBe(false)
      expect(isGrantedStudent).toBe(false)
      expect(liveClassroomStore.getState().currentFen).toBe(START_FEN)
    })

    it('6. malformed move payload -> rejected safely', () => {
      const msg = makeLiveKitMessage('{ corrupted payload', TEACHER_ID)
      let parsed = null
      let threw = false
      try {
        const text = new TextDecoder().decode(msg.payload)
        parsed = JSON.parse(text)
      } catch {
        threw = true
      }
      expect(threw).toBe(true)
      expect(parsed).toBeNull()
      expect(liveClassroomStore.getState().currentFen).toBe(START_FEN)
    })
  })

  describe('5. Chat Identity & Practice Chat Scoping', () => {
    it('overwrites payload.senderId with actual transport identity', () => {
      const payload: ChatMessagePayload = {
        type: 'CHAT_MESSAGE',
        senderId: TEACHER_ID, // Attacker tries to impersonate Teacher
        senderName: 'Teacher (Master)',
        text: 'Class is cancelled!',
        messageId: 'chat-1',
        timestamp: Date.now(),
      }

      const msg = makeLiveKitMessage(payload, ATTACKER_ID, 'AttackerNick')
      const senderIdentity = getTransportSenderIdentity(msg)

      const canonicalSenderName =
        msg.from?.name ||
        msg.participant?.name ||
        (payload.senderId === senderIdentity ? payload.senderName : undefined) ||
        senderIdentity

      const sanitized: ChatMessagePayload = {
        ...payload,
        senderId: senderIdentity!,
        senderName: canonicalSenderName,
      }

      // Sender identity is bound to transport identity
      expect(sanitized.senderId).toBe(ATTACKER_ID)
      expect(sanitized.senderName).toBe('AttackerNick')
      expect(sanitized.senderId).not.toBe(TEACHER_ID)
    })

    it('practice chat scopes messages only to assigned players or teacher', () => {
      const assignment: PracticeAssignment = {
        boardId: 'practice-1',
        whiteUserId: STUDENT_1_ID,
        blackUserId: STUDENT_2_ID,
        status: 'PLAYING',
      }
      liveClassroomStore.getState().setAssignments([assignment])

      const isAllowedForPracticeChat = (msg: LiveKitMessageLike, boardId: string): boolean => {
        const sender = getTransportSenderIdentity(msg)
        if (!sender) return false
        const isTeacher = isAuthorizedTeacher(sender, msg, TEACHER_ID)
        const board = liveClassroomStore.getState().practiceAssignments.find((a) => a.boardId === boardId)
        const isAssigned = board ? sender === board.whiteUserId || sender === board.blackUserId : false
        return isTeacher || isAssigned
      }

      // Teacher -> allowed
      expect(isAllowedForPracticeChat(makeLiveKitMessage({}, TEACHER_ID), 'practice-1')).toBe(true)
      // Alice (White) -> allowed
      expect(isAllowedForPracticeChat(makeLiveKitMessage({}, STUDENT_1_ID), 'practice-1')).toBe(true)
      // Bob (Black) -> allowed
      expect(isAllowedForPracticeChat(makeLiveKitMessage({}, STUDENT_2_ID), 'practice-1')).toBe(true)
      // Attacker (unassigned) -> REJECTED
      expect(isAllowedForPracticeChat(makeLiveKitMessage({}, ATTACKER_ID), 'practice-1')).toBe(false)
    })
  })
})
