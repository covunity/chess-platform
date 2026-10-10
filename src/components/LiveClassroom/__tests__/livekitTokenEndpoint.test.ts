import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  handleLivekitTokenRequest,
  validateClassroomAccess,
  type ClassroomAccessValidationResult,
} from '../../../../supabase/functions/livekit-token/index'
import { AccessToken } from '../../../test/livekitSdkStub'

describe('TASK 2.1 & 2.2 — LiveKit Edge Function Authorization & Endpoint Security', () => {
  const defaultEnv = {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    SUPABASE_ANON_KEY: 'test-anon-key',
    LIVEKIT_API_KEY: 'test-livekit-key',
    LIVEKIT_API_SECRET: 'test-livekit-secret',
    LIVEKIT_URL: 'wss://test.livekit.cloud',
  }

  beforeEach(() => {
    AccessToken.reset()
    vi.clearAllMocks()
  })

  function createMockRequest(
    body: Record<string, unknown>,
    authHeader = 'Bearer test-jwt-valid',
    method = 'POST'
  ): Request {
    return new Request('http://localhost/functions/v1/livekit-token', {
      method,
      headers: {
        'Content-Type': 'application/json',
        authorization: authHeader,
      },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    })
  }

  function createMockClients(options: {
    authUserId?: string
    authError?: Error | null
    rpcResult?: Record<string, unknown> | null
    rpcError?: Error | null
    userProfile?: Record<string, unknown> | null
  }) {
    const authUserId = options.authUserId ?? 'user-123'

    const authClient = {
      auth: {
        getUser: vi.fn().mockImplementation(async (token: string) => {
          if (options.authError || token !== 'test-jwt-valid') {
            return { data: { user: null }, error: options.authError ?? new Error('Invalid token') }
          }
          return {
            data: {
              user: {
                id: authUserId,
                email: 'test@example.com',
                user_metadata: { name: 'Test User' },
                app_metadata: { role: 'student' },
              },
            },
            error: null,
          }
        }),
      },
    } as unknown as SupabaseClient

    const mockRpc = vi.fn().mockResolvedValue({
      data: options.rpcResult !== undefined ? options.rpcResult : null,
      error: options.rpcError !== undefined ? options.rpcError : null,
    })

    const mockMaybeSingle = vi.fn().mockResolvedValue({
      data:
        options.userProfile !== undefined
          ? options.userProfile
          : {
              id: authUserId,
              name: 'Test User',
              email: 'test@example.com',
              role: 'student',
            },
      error: null,
    })

    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: mockMaybeSingle,
      }),
    })

    const serviceClient = {
      rpc: mockRpc,
      from: vi.fn().mockReturnValue({
        select: mockSelect,
      }),
    } as unknown as SupabaseClient

    return { authClient, serviceClient, mockRpc }
  }

  describe('1. TypeScript Interface Verification', () => {
    it('returns ClassroomAccessValidationResult containing livekitRoomName and sessionTitle', async () => {
      const { serviceClient } = createMockClients({
        rpcResult: {
          is_course_room: true,
          is_session: true,
          allowed: true,
          role: 'teacher',
          livekit_room_name: 'live-room-abc',
          session_title: 'Khai cuộc Gambit Vua',
        },
      })

      const result: ClassroomAccessValidationResult = await validateClassroomAccess(
        serviceClient,
        'session-123',
        'user-123',
        'teacher'
      )

      expect(result.valid).toBe(true)
      expect(result.role).toBe('teacher')
      expect(result.livekitRoomName).toBe('live-room-abc')
      expect(result.sessionTitle).toBe('Khai cuộc Gambit Vua')
    })
  })

  describe('2. Token Denial by Session Status (Invalid Access => 403 => No JWT Issued)', () => {
    it('A. SCHEDULED: returns 403 with session_not_live, does NOT construct AccessToken, does NOT mint JWT', async () => {
      const { authClient, serviceClient } = createMockClients({
        rpcResult: {
          is_course_room: true,
          is_session: true,
          allowed: false,
          reason: 'session_not_live',
          session_id: 'session-scheduled-1',
          session_status: 'SCHEDULED',
        },
      })

      const req = createMockRequest({
        roomId: 'session-scheduled-1',
        userId: 'user-123',
      })

      const res = await handleLivekitTokenRequest(req, {
        authClient,
        serviceClient,
        env: defaultEnv,
      })

      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.reason).toBe('session_not_live')
      expect(data.error).toBe('session_not_live')
      expect(data.token).toBeUndefined()

      // PROOF: AccessToken must NOT be instantiated, and toJwt() must NOT be called
      expect(AccessToken.instances.length).toBe(0)
      expect(AccessToken.toJwtCalls).toBe(0)
    })

    it('B. DRAFT: returns 403 with session_not_live, does NOT construct AccessToken, does NOT mint JWT', async () => {
      const { authClient, serviceClient } = createMockClients({
        rpcResult: {
          is_course_room: true,
          is_session: true,
          allowed: false,
          reason: 'session_not_live',
          session_id: 'session-draft-1',
          session_status: 'DRAFT',
        },
      })

      const req = createMockRequest({
        roomId: 'session-draft-1',
        userId: 'user-123',
      })

      const res = await handleLivekitTokenRequest(req, {
        authClient,
        serviceClient,
        env: defaultEnv,
      })

      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.reason).toBe('session_not_live')
      expect(data.error).toBe('session_not_live')
      expect(data.token).toBeUndefined()

      expect(AccessToken.instances.length).toBe(0)
      expect(AccessToken.toJwtCalls).toBe(0)
    })

    it('C. CANCELLED: returns 403 with session_not_live, does NOT construct AccessToken, does NOT mint JWT', async () => {
      const { authClient, serviceClient } = createMockClients({
        rpcResult: {
          is_course_room: true,
          is_session: true,
          allowed: false,
          reason: 'session_not_live',
          session_id: 'session-cancelled-1',
          session_status: 'CANCELLED',
        },
      })

      const req = createMockRequest({
        roomId: 'session-cancelled-1',
        userId: 'user-123',
      })

      const res = await handleLivekitTokenRequest(req, {
        authClient,
        serviceClient,
        env: defaultEnv,
      })

      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.reason).toBe('session_not_live')
      expect(data.error).toBe('session_not_live')
      expect(data.token).toBeUndefined()

      expect(AccessToken.instances.length).toBe(0)
      expect(AccessToken.toJwtCalls).toBe(0)
    })

    it('D. ENDED: returns 403 with session_not_live, does NOT construct AccessToken, does NOT mint JWT', async () => {
      const { authClient, serviceClient } = createMockClients({
        rpcResult: {
          is_course_room: true,
          is_session: true,
          allowed: false,
          reason: 'session_not_live',
          session_id: 'session-ended-1',
          session_status: 'ENDED',
        },
      })

      const req = createMockRequest({
        roomId: 'session-ended-1',
        userId: 'user-123',
      })

      const res = await handleLivekitTokenRequest(req, {
        authClient,
        serviceClient,
        env: defaultEnv,
      })

      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.reason).toBe('session_not_live')
      expect(data.error).toBe('session_not_live')
      expect(data.token).toBeUndefined()

      expect(AccessToken.instances.length).toBe(0)
      expect(AccessToken.toJwtCalls).toBe(0)
    })

    it('E. LIVE: returns 200 with minted JWT token and correct roomName & sessionTitle', async () => {
      const { authClient, serviceClient } = createMockClients({
        rpcResult: {
          is_course_room: true,
          is_session: true,
          allowed: true,
          role: 'student',
          livekit_room_name: 'live-course-c1-session-s1',
          session_title: 'Buổi 1: Nhập môn Cờ Vua',
          session_status: 'LIVE',
        },
      })

      const req = createMockRequest({
        roomId: 'session-live-1',
        userId: 'user-123',
      })

      const res = await handleLivekitTokenRequest(req, {
        authClient,
        serviceClient,
        env: defaultEnv,
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.token).toBe('mock-jwt-token')
      expect(data.roomName).toBe('live-course-c1-session-s1')
      expect(data.sessionTitle).toBe('Buổi 1: Nhập môn Cờ Vua')
      expect(data.role).toBe('student')
      expect(data.identity).toBe('user-123')
      expect(data.serverUrl).toBe('wss://test.livekit.cloud')

      // PROOF: AccessToken WAS constructed and toJwt() WAS called
      expect(AccessToken.instances.length).toBe(1)
      expect(AccessToken.toJwtCalls).toBe(1)
      const instance = AccessToken.instances[0]
      expect(instance.options.identity).toBe('user-123')
      expect(instance.grants[0]).toMatchObject({
        roomJoin: true,
        room: 'live-course-c1-session-s1',
      })
    })
  })

  describe('3. TASK 2.2 — Fail-Closed Authorization on RPC Error, Null Data, & Unknown Rooms', () => {
    it('A. RPC returns error: valid === false, reason === "access_check_failed", HTTP 403, NO token issued', async () => {
      const { authClient, serviceClient } = createMockClients({
        rpcResult: null,
        rpcError: new Error('Postgres connection pool exhausted'),
      })

      // 1. Direct validation helper check
      const validation = await validateClassroomAccess(
        serviceClient,
        'session-live-1',
        'user-123'
      )
      expect(validation.valid).toBe(false)
      expect(validation.reason).toBe('access_check_failed')

      // 2. Full HTTP endpoint check
      const req = createMockRequest({
        roomId: 'session-live-1',
        userId: 'user-123',
      })

      const res = await handleLivekitTokenRequest(req, {
        authClient,
        serviceClient,
        env: defaultEnv,
      })

      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.reason).toBe('access_check_failed')
      expect(data.error).toBe('access_check_failed')
      expect(data.token).toBeUndefined()
      // Raw database error must NOT be leaked
      expect(JSON.stringify(data)).not.toContain('Postgres connection pool exhausted')

      expect(AccessToken.instances.length).toBe(0)
      expect(AccessToken.toJwtCalls).toBe(0)
    })

    it('B. RPC returns data = null, error = null: valid === false, reason === "access_check_failed", HTTP 403, NO token', async () => {
      const { authClient, serviceClient } = createMockClients({
        rpcResult: null,
        rpcError: null,
      })

      // 1. Direct validation helper check
      const validation = await validateClassroomAccess(
        serviceClient,
        'session-live-1',
        'user-123'
      )
      expect(validation.valid).toBe(false)
      expect(validation.reason).toBe('access_check_failed')

      // 2. Full HTTP endpoint check
      const req = createMockRequest({
        roomId: 'session-live-1',
        userId: 'user-123',
      })

      const res = await handleLivekitTokenRequest(req, {
        authClient,
        serviceClient,
        env: defaultEnv,
      })

      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.reason).toBe('access_check_failed')
      expect(data.error).toBe('access_check_failed')
      expect(data.token).toBeUndefined()

      expect(AccessToken.instances.length).toBe(0)
      expect(AccessToken.toJwtCalls).toBe(0)
    })

    it('C. Unknown Room ID: neither live_session nor legacy course room -> DENY (HTTP 403, no token)', async () => {
      const { authClient, serviceClient } = createMockClients({
        rpcResult: {
          is_course_room: false,
          is_session: false,
          allowed: true, // SQL fallback might return true for generic room, but Edge Function MUST DENY
          role: 'student',
          livekit_room_name: 'arbitrary-room-id-999',
        },
      })

      // 1. Direct validation helper check
      const validation = await validateClassroomAccess(
        serviceClient,
        'arbitrary-room-id-999',
        'user-123'
      )
      expect(validation.valid).toBe(false)
      expect(validation.reason).toBe('room_not_found')

      // 2. Full HTTP endpoint check
      const req = createMockRequest({
        roomId: 'arbitrary-room-id-999',
        userId: 'user-123',
      })

      const res = await handleLivekitTokenRequest(req, {
        authClient,
        serviceClient,
        env: defaultEnv,
      })

      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.reason).toBe('room_not_found')
      expect(data.token).toBeUndefined()

      expect(AccessToken.instances.length).toBe(0)
      expect(AccessToken.toJwtCalls).toBe(0)
    })

    it('E. Legacy Course Room: valid course room allows token issuance with legacy behavior', async () => {
      const { authClient, serviceClient } = createMockClients({
        rpcResult: {
          is_course_room: true,
          is_session: false,
          allowed: true,
          role: 'teacher',
          livekit_room_name: 'legacy-course-room-uuid',
          course_id: 'course-legacy-1',
          course_title: 'Khóa học Cờ Vua Căn Bản',
        },
      })

      const req = createMockRequest({
        roomId: 'legacy-course-room-uuid',
        userId: 'user-123',
      })

      const res = await handleLivekitTokenRequest(req, {
        authClient,
        serviceClient,
        env: defaultEnv,
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.token).toBe('mock-jwt-token')
      expect(data.roomName).toBe('legacy-course-room-uuid')
      expect(data.role).toBe('teacher')

      expect(AccessToken.instances.length).toBe(1)
      expect(AccessToken.toJwtCalls).toBe(1)
    })

    it('E2. Legacy Course Room with roomId fallback when livekit_room_name is not provided', async () => {
      const { authClient, serviceClient } = createMockClients({
        rpcResult: {
          is_course_room: true,
          is_session: false,
          allowed: true,
          role: 'student',
          course_id: 'course-legacy-2',
        },
      })

      const req = createMockRequest({
        roomId: 'course-legacy-2',
        userId: 'user-123',
      })

      const res = await handleLivekitTokenRequest(req, {
        authClient,
        serviceClient,
        env: defaultEnv,
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.token).toBe('mock-jwt-token')
      expect(data.roomName).toBe('course-legacy-2')
      expect(data.role).toBe('student')

      expect(AccessToken.instances.length).toBe(1)
      expect(AccessToken.toJwtCalls).toBe(1)
    })
  })

  describe('4. Existing Authentication & Security Invariants', () => {
    it('F1. returns 401 if Authorization header is missing or malformed', async () => {
      const { authClient, serviceClient } = createMockClients({})
      const req = createMockRequest({ roomId: 'any-room', userId: 'user-123' }, 'Basic some-creds')

      const res = await handleLivekitTokenRequest(req, { authClient, serviceClient, env: defaultEnv })
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data.error).toContain('Authorization')
      expect(AccessToken.instances.length).toBe(0)
    })

    it('F2. returns 401 if auth token is invalid or expired', async () => {
      const { authClient, serviceClient } = createMockClients({
        authError: new Error('JWT expired'),
      })
      const req = createMockRequest({ roomId: 'any-room', userId: 'user-123' }, 'Bearer expired-jwt')

      const res = await handleLivekitTokenRequest(req, { authClient, serviceClient, env: defaultEnv })
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data.error).toBe('Invalid authentication token')
      expect(AccessToken.instances.length).toBe(0)
    })

    it('F3. returns 403 if request body userId does not match authenticated userId', async () => {
      const { authClient, serviceClient } = createMockClients({ authUserId: 'user-123' })
      const req = createMockRequest({
        roomId: 'any-room',
        userId: 'attacker-impersonating-another-user',
      })

      const res = await handleLivekitTokenRequest(req, { authClient, serviceClient, env: defaultEnv })
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toContain('Forbidden: Request userId does not match authenticated session')
      expect(AccessToken.instances.length).toBe(0)
      expect(AccessToken.toJwtCalls).toBe(0)
    })

    it('F4. returns 400 if roomId or userId is missing from request body', async () => {
      const { authClient, serviceClient } = createMockClients({})
      const req = createMockRequest({ userId: 'user-123' }) // missing roomId

      const res = await handleLivekitTokenRequest(req, { authClient, serviceClient, env: defaultEnv })
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toContain('roomId is required')
      expect(AccessToken.instances.length).toBe(0)
    })

    it('F5. returns 500 if LiveKit credentials are not configured', async () => {
      const { authClient, serviceClient } = createMockClients({})
      const req = createMockRequest({ roomId: 'room-1', userId: 'user-123' })

      const res = await handleLivekitTokenRequest(req, {
        authClient,
        serviceClient,
        env: {
          ...defaultEnv,
          LIVEKIT_API_KEY: undefined,
        },
      })
      expect(res.status).toBe(500)
      const data = await res.json()
      expect(data.error).toBe('LiveKit server credentials not configured')
      expect(AccessToken.instances.length).toBe(0)
    })
  })
})
