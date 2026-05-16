import { describe, it, expect, vi } from 'vitest'
import { updateProfileBio, MAX_BIO_LENGTH } from './profileApi'

function buildClient(captured: { args?: unknown }) {
  const update = vi.fn((patch: unknown) => {
    captured.args = patch
    return { eq: vi.fn().mockResolvedValue({ error: null }) }
  })
  return { from: vi.fn(() => ({ update })) }
}

describe('updateProfileBio', () => {
  it('stores the trimmed bio when text is provided', async () => {
    const captured: { args?: unknown } = {}
    const client = buildClient(captured)
    const { error } = await updateProfileBio(client as never, 'u1', 'Hi there')
    expect(error).toBeNull()
    expect(captured.args).toEqual({ bio: 'Hi there' })
  })

  it('clamps overly long bios to MAX_BIO_LENGTH', async () => {
    const captured: { args?: unknown } = {}
    const client = buildClient(captured)
    const long = 'a'.repeat(MAX_BIO_LENGTH + 20)
    await updateProfileBio(client as never, 'u1', long)
    const args = captured.args as { bio: string }
    expect(args.bio.length).toBe(MAX_BIO_LENGTH)
  })

  it('persists null when the input is empty / whitespace only', async () => {
    const captured: { args?: unknown } = {}
    const client = buildClient(captured)
    await updateProfileBio(client as never, 'u1', '   ')
    expect(captured.args).toEqual({ bio: null })
  })

  it('persists null when caller passes null', async () => {
    const captured: { args?: unknown } = {}
    const client = buildClient(captured)
    await updateProfileBio(client as never, 'u1', null)
    expect(captured.args).toEqual({ bio: null })
  })
})
