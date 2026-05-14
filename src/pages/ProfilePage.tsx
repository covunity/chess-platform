import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { updateProfileName, uploadAvatar, removeAvatar, updateEditorAdvanced } from '../lib/profileApi'
import { validateNewPassword } from '../lib/authValidation'

const MAX_AVATAR_SIZE = 2 * 1024 * 1024
const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export default function ProfilePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, profile, updateProfile, updatePassword } = useAuth()

  useEffect(() => {
    if (!user) navigate('/login', { replace: true })
  }, [user, navigate])

  const fileInputRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState(profile?.name ?? '')
  const [prevProfileName, setPrevProfileName] = useState(profile?.name)
  const [infoLoading, setInfoLoading] = useState(false)
  const [infoSuccess, setInfoSuccess] = useState(false)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)

  const [avatarPreview, setAvatarPreview] = useState<string | null>(profile?.avatar_url ?? null)
  const [prevProfileAvatar, setPrevProfileAvatar] = useState(profile?.avatar_url)
  const [avatarLoading, setAvatarLoading] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordFieldErrors, setPasswordFieldErrors] = useState<{ password?: string; confirmPassword?: string }>({})

  const [editorAdvanced, setEditorAdvanced] = useState(profile?.editor_advanced ?? false)
  const [prevEditorAdvanced, setPrevEditorAdvanced] = useState(profile?.editor_advanced)

  if (profile?.name !== prevProfileName) {
    setPrevProfileName(profile?.name)
    setName(profile?.name ?? '')
  }
  if (profile?.avatar_url !== prevProfileAvatar) {
    setPrevProfileAvatar(profile?.avatar_url)
    setAvatarPreview(profile?.avatar_url ?? null)
  }
  if (profile?.editor_advanced !== prevEditorAdvanced) {
    setPrevEditorAdvanced(profile?.editor_advanced)
    setEditorAdvanced(profile?.editor_advanced ?? false)
  }

  if (!user) return null

  const initials = (profile?.name ?? user.email ?? '?').charAt(0).toUpperCase()

  async function handleEditorAdvancedToggle(checked: boolean) {
    if (!user) return
    setEditorAdvanced(checked)
    const { error } = await updateEditorAdvanced(supabase, user.id, checked)
    if (!error) {
      updateProfile({ editor_advanced: checked })
    } else {
      // Rollback on error
      setEditorAdvanced(!checked)
    }
  }

  function validateName(value: string): string | null {
    const trimmed = value.trim()
    if (!trimmed) return t('profile.errors.nameRequired')
    if (trimmed.length < 2) return t('auth.validation.nameTooShort')
    if (trimmed.length > 100) return t('auth.validation.nameTooLong')
    return null
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!user) return
    const file = e.target.files?.[0]
    if (!file) return

    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      setAvatarError(t('profile.errors.avatarType'))
      return
    }
    if (file.size > MAX_AVATAR_SIZE) {
      setAvatarError(t('profile.errors.avatarSize'))
      return
    }

    setAvatarError(null)
    setAvatarLoading(true)

    // Show local preview immediately
    const localUrl = URL.createObjectURL(file)
    setAvatarPreview(localUrl)

    const { url, error } = await uploadAvatar(supabase, user.id, file)
    setAvatarLoading(false)

    if (error || !url) {
      setAvatarPreview(profile?.avatar_url ?? null)
      setAvatarError(t('profile.errors.avatarUpload'))
      return
    }

    URL.revokeObjectURL(localUrl)
    setAvatarPreview(url)
    updateProfile({ avatar_url: url })
    // Reset input so same file can be re-selected after removal
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleRemoveAvatar() {
    if (!user) return
    if (!profile?.avatar_url) return
    setAvatarLoading(true)
    setAvatarError(null)

    const { error } = await removeAvatar(supabase, user.id, profile.avatar_url)
    setAvatarLoading(false)

    if (error) {
      setAvatarError(t('profile.errors.avatarRemove'))
      return
    }

    setAvatarPreview(null)
    updateProfile({ avatar_url: null })
  }

  async function handleSaveInfo(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    const err = validateName(name)
    if (err) { setNameError(err); return }
    setNameError(null)
    setInfoLoading(true)
    setInfoError(null)
    setInfoSuccess(false)

    const trimmedName = name.trim()
    const { error } = await updateProfileName(supabase, user.id, trimmedName)
    if (error) {
      setInfoLoading(false)
      setInfoError(t('profile.errors.saveProfile'))
      return
    }

    // Also keep auth user_metadata in sync so initials are correct everywhere
    await supabase.auth.updateUser({ data: { name: trimmedName } })

    updateProfile({ name: trimmedName })
    setInfoLoading(false)
    setInfoSuccess(true)
    setTimeout(() => setInfoSuccess(false), 3000)
  }

  async function handleSavePassword(e: React.FormEvent) {
    e.preventDefault()
    const errors = validateNewPassword(newPassword, confirmPassword)
    if (Object.keys(errors).length > 0) {
      setPasswordFieldErrors(errors)
      return
    }
    setPasswordFieldErrors({})
    setPasswordLoading(true)
    setPasswordError(null)
    setPasswordSuccess(false)

    const { error } = await updatePassword(newPassword)
    setPasswordLoading(false)

    if (error) {
      setPasswordError(t('profile.errors.savePassword'))
      return
    }

    setNewPassword('')
    setConfirmPassword('')
    setPasswordSuccess(true)
    setTimeout(() => setPasswordSuccess(false), 4000)
  }

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 24px 80px' }}>
      {/* Page header */}
      <p style={{
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--ink-3)',
        marginBottom: 8,
      }}>
        {t('profile.eyebrow')}
      </p>
      <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 38, lineHeight: 1.1, color: 'var(--ink-1)', marginBottom: 40 }}>
        {t('profile.heading')}
      </h1>

      {/* ── Avatar section ─────────────────────────────────── */}
      <section
        className="card"
        style={{ padding: '28px 28px', marginBottom: 20 }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 20 }}>
          {t('profile.avatarSection')}
        </h2>

        <div className="flex items-center" style={{ gap: 24 }}>
          {/* Avatar display */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            {avatarPreview ? (
              <img
                src={avatarPreview}
                alt={profile?.name ?? user.email ?? ''}
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '2px solid var(--border)',
                }}
              />
            ) : (
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: '50%',
                  background: 'oklch(0.85 0.07 200)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 28,
                  fontWeight: 600,
                  color: 'var(--surface)',
                }}
              >
                {initials}
              </div>
            )}
            {avatarLoading && (
              <div style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                background: 'rgba(0,0,0,0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
                    <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
                  </path>
                </svg>
              </div>
            )}
          </div>

          {/* Avatar actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_AVATAR_TYPES.join(',')}
              style={{ display: 'none' }}
              onChange={handleAvatarChange}
              disabled={avatarLoading}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarLoading}
            >
              {t('profile.avatarUpload')}
            </button>
            {avatarPreview && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleRemoveAvatar}
                disabled={avatarLoading}
                style={{ color: 'var(--danger)' }}
              >
                {t('profile.avatarRemove')}
              </button>
            )}
            <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: 0 }}>
              {t('profile.avatarHint')}
            </p>
          </div>
        </div>

        {avatarError && (
          <p style={{ marginTop: 12, fontSize: 13, color: 'var(--danger)' }}>{avatarError}</p>
        )}
      </section>

      {/* ── Profile info section ───────────────────────────── */}
      <section className="card" style={{ padding: '28px 28px', marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 20 }}>
          {t('profile.infoSection')}
        </h2>

        <form onSubmit={handleSaveInfo} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>
              {t('profile.labelName')}
            </label>
            <input
              className="input"
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setNameError(null); setInfoSuccess(false) }}
              style={{ width: '100%', borderColor: nameError ? 'var(--danger)' : undefined }}
            />
            {nameError && (
              <p style={{ marginTop: 4, fontSize: 12, color: 'var(--danger)' }}>{nameError}</p>
            )}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>
              {t('profile.labelEmail')}
            </label>
            <input
              className="input"
              type="email"
              value={user.email ?? ''}
              readOnly
              style={{ width: '100%', background: 'var(--surface-2)', color: 'var(--ink-3)', cursor: 'not-allowed' }}
            />
            <p style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3)' }}>
              {t('profile.emailHint')}
            </p>
          </div>

          <div className="flex items-center" style={{ gap: 12, marginTop: 4 }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={infoLoading}
            >
              {infoLoading ? '...' : t('profile.saveInfo')}
            </button>
            {infoSuccess && (
              <span style={{ fontSize: 13, color: 'var(--success)', fontWeight: 500 }}>
                ✓ {t('profile.savedInfo')}
              </span>
            )}
            {infoError && (
              <span style={{ fontSize: 13, color: 'var(--danger)' }}>{infoError}</span>
            )}
          </div>
        </form>
      </section>

      {/* ── Change password section ────────────────────────── */}
      <section className="card" style={{ padding: '28px 28px' }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 20 }}>
          {t('profile.passwordSection')}
        </h2>

        <form onSubmit={handleSavePassword} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>
              {t('profile.labelNewPassword')}
            </label>
            <input
              className="input"
              type="password"
              value={newPassword}
              onChange={e => { setNewPassword(e.target.value); setPasswordFieldErrors({}); setPasswordSuccess(false) }}
              autoComplete="new-password"
              style={{ width: '100%', borderColor: passwordFieldErrors.password ? 'var(--danger)' : undefined }}
            />
            {passwordFieldErrors.password ? (
              <p style={{ marginTop: 4, fontSize: 12, color: 'var(--danger)' }}>
                {t(passwordFieldErrors.password)}
              </p>
            ) : (
              <p style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3)' }}>
                {t('profile.passwordHint')}
              </p>
            )}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>
              {t('profile.labelConfirmPassword')}
            </label>
            <input
              className="input"
              type="password"
              value={confirmPassword}
              onChange={e => { setConfirmPassword(e.target.value); setPasswordFieldErrors({}); setPasswordSuccess(false) }}
              autoComplete="new-password"
              style={{ width: '100%', borderColor: passwordFieldErrors.confirmPassword ? 'var(--danger)' : undefined }}
            />
            {passwordFieldErrors.confirmPassword && (
              <p style={{ marginTop: 4, fontSize: 12, color: 'var(--danger)' }}>
                {t(passwordFieldErrors.confirmPassword)}
              </p>
            )}
          </div>

          <div className="flex items-center" style={{ gap: 12, marginTop: 4 }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={passwordLoading}
            >
              {passwordLoading ? '...' : t('profile.savePassword')}
            </button>
            {passwordSuccess && (
              <span style={{ fontSize: 13, color: 'var(--success)', fontWeight: 500 }}>
                ✓ {t('profile.savedPassword')}
              </span>
            )}
            {passwordError && (
              <span style={{ fontSize: 13, color: 'var(--danger)' }}>{passwordError}</span>
            )}
          </div>
        </form>
      </section>

      {/* ── Advanced editor section ────────────────────────── */}
      <section
        data-testid="editor-advanced-section"
        className="card"
        style={{ padding: '28px 28px', marginTop: 20 }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 16 }}>
          {t('profile.editorAdvancedSection')}
        </h2>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <input
            id="editor-advanced"
            type="checkbox"
            data-testid="editor-advanced-checkbox"
            checked={editorAdvanced}
            onChange={(e) => handleEditorAdvancedToggle(e.target.checked)}
            style={{ marginTop: 3, flexShrink: 0 }}
          />
          <div>
            <label htmlFor="editor-advanced" style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', cursor: 'pointer' }}>
              {t('profile.editorAdvancedToggleLabel')}
            </label>
            <p
              data-testid="editor-advanced-help"
              style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4, margin: 0 }}
            >
              {t('profile.editorAdvancedToggleHelp')}
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
