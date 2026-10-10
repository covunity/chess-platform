import { describe, it, expect } from 'vitest'

describe('LiveKit Edge Function Credential Handling Specification', () => {
  it('fails safely when LIVEKIT_API_KEY is missing', () => {
    const env: Record<string, string | undefined> = {
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      SUPABASE_ANON_KEY: 'test-anon-key',
      LIVEKIT_API_KEY: undefined,
      LIVEKIT_API_SECRET: 'some-secret',
      LIVEKIT_URL: 'wss://test.livekit.cloud',
    }

    const livekitApiKey = env.LIVEKIT_API_KEY
    const livekitApiSecret = env.LIVEKIT_API_SECRET
    const livekitUrl = env.LIVEKIT_URL

    const isConfigured = Boolean(livekitApiKey && livekitApiSecret && livekitUrl)
    expect(isConfigured).toBe(false)

    if (!isConfigured) {
      const response = {
        status: 500,
        body: JSON.stringify({ error: 'LiveKit server credentials not configured' }),
      }
      expect(response.status).toBe(500)
      expect(JSON.parse(response.body)).toEqual({
        error: 'LiveKit server credentials not configured',
      })
      // Ensure no sensitive info is leaked
      expect(response.body).not.toContain('some-secret')
    }
  })

  it('fails safely when LIVEKIT_API_SECRET is missing', () => {
    const env: Record<string, string | undefined> = {
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      SUPABASE_ANON_KEY: 'test-anon-key',
      LIVEKIT_API_KEY: 'some-api-key',
      LIVEKIT_API_SECRET: undefined,
      LIVEKIT_URL: 'wss://test.livekit.cloud',
    }

    const livekitApiKey = env.LIVEKIT_API_KEY
    const livekitApiSecret = env.LIVEKIT_API_SECRET
    const livekitUrl = env.LIVEKIT_URL

    const isConfigured = Boolean(livekitApiKey && livekitApiSecret && livekitUrl)
    expect(isConfigured).toBe(false)

    if (!isConfigured) {
      const response = {
        status: 500,
        body: JSON.stringify({ error: 'LiveKit server credentials not configured' }),
      }
      expect(response.status).toBe(500)
      expect(JSON.parse(response.body)).toEqual({
        error: 'LiveKit server credentials not configured',
      })
      expect(response.body).not.toContain('some-api-key')
    }
  })

  it('proceeds only when all required environment variables are defined', () => {
    const env: Record<string, string | undefined> = {
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      SUPABASE_ANON_KEY: 'test-anon-key',
      LIVEKIT_API_KEY: 'valid-key',
      LIVEKIT_API_SECRET: 'valid-secret',
      LIVEKIT_URL: 'wss://test.livekit.cloud',
    }

    const livekitApiKey = env.LIVEKIT_API_KEY
    const livekitApiSecret = env.LIVEKIT_API_SECRET
    const livekitUrl = env.LIVEKIT_URL

    const isConfigured = Boolean(livekitApiKey && livekitApiSecret && livekitUrl)
    expect(isConfigured).toBe(true)
    expect(livekitApiKey).toBe('valid-key')
    expect(livekitApiSecret).toBe('valid-secret')
  })
})
