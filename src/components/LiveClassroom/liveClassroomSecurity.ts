/**
 * Live Classroom Security Helpers
 *
 * Enforces inbound transport-level authentication for LiveKit DataChannel messages.
 * Never trust payload.senderId or client-supplied role claims.
 */

import { liveClassroomStore } from './liveClassroomStore'

export interface LiveKitMessageLike {
  payload: Uint8Array
  from?: {
    identity?: string
    name?: string
    metadata?: string
  }
  participant?: {
    identity?: string
    name?: string
    metadata?: string
  }
}

/**
 * Extracts authoritative participant identity from LiveKit transport message metadata.
 * Drops messages where transport identity cannot be established (fails closed).
 */
export function getTransportSenderIdentity(msg: LiveKitMessageLike): string | undefined {
  return msg?.from?.identity || msg?.participant?.identity
}

/**
 * Checks whether the sender is an authorized teacher.
 * Validates against:
 * 1. Authoritative teacher ID (prop or from Zustand store). If present, strictly enforced.
 * 2. Authenticated LiveKit participant metadata signed server-side by the token endpoint
 *    (fallback for test environments / ad-hoc rooms without database course context).
 */
export function isAuthorizedTeacher(
  senderIdentity: string | undefined,
  msg: LiveKitMessageLike,
  authoritativeTeacherId?: string | null
): boolean {
  if (!senderIdentity) return false

  const effectiveTeacherId = authoritativeTeacherId || liveClassroomStore.getState().teacherId

  // 1. Authoritative teacher ID match (strictly enforced if configured)
  if (effectiveTeacherId) {
    return senderIdentity === effectiveTeacherId
  }

  // 2. Fallback for test environments / ad-hoc rooms without course context:
  // Check server-signed LiveKit participant metadata
  const participant = msg?.from || msg?.participant
  if (participant?.metadata) {
    try {
      const parsed = JSON.parse(participant.metadata)
      if (parsed.role === 'teacher' && (parsed.userId === senderIdentity || !parsed.userId)) {
        return true
      }
    } catch {
      // ignore JSON parse error
    }
  }

  return false
}

/**
 * Checks whether the sender is an authorized assistant.
 * Validates against server-signed LiveKit participant metadata or session staff identities.
 * Never grants teacher privileges.
 */
export function isAuthorizedAssistant(
  senderIdentity: string | undefined,
  msg: LiveKitMessageLike,
  sessionStaffIds?: string[]
): boolean {
  if (!senderIdentity) return false

  // 1. Explicit session staff list check
  if (sessionStaffIds && sessionStaffIds.includes(senderIdentity)) {
    return true
  }

  // 2. Server-signed LiveKit participant metadata check
  const participant = msg?.from || msg?.participant
  if (participant?.metadata) {
    try {
      const parsed = JSON.parse(participant.metadata)
      if (parsed.role === 'assistant' && (parsed.userId === senderIdentity || !parsed.userId)) {
        return true
      }
    } catch {
      // ignore JSON parse error
    }
  }

  return false
}

/**
 * Checks whether the sender is authorized staff (either teacher or assistant).
 */
export function isAuthorizedStaff(
  senderIdentity: string | undefined,
  msg: LiveKitMessageLike,
  authoritativeTeacherId?: string | null,
  sessionStaffIds?: string[]
): boolean {
  return (
    isAuthorizedTeacher(senderIdentity, msg, authoritativeTeacherId) ||
    isAuthorizedAssistant(senderIdentity, msg, sessionStaffIds)
  )
}

