import { useState, useEffect } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { listUsers, changeUserRole, changeUserAccountTier, parseViolatingCourses } from '../../lib/adminApi'
import type { AdminUser, UserRole } from '../../lib/adminApi'
import { useDebounce } from '../../hooks/useDebounce'
import { useAccountTiers } from '../../lib/accountTiers'
import type { AccountTierCode, AccountTier } from '../../lib/accountTiers'

const PAGE_SIZE = 20

const ROLE_PILL_CLASS: Record<UserRole, string> = {
  learner: 'pill',
  creator: 'pill pill-accent',
  admin: 'pill',
}

function RolePill({ role, t }: { role: UserRole; t: (k: string) => string }) {
  const baseStyle: CSSProperties = { whiteSpace: 'nowrap' }
  const style: CSSProperties =
    role === 'admin'
      ? { ...baseStyle, background: 'var(--ink-1)', color: '#fff' }
      : baseStyle
  return (
    <span className={ROLE_PILL_CLASS[role]} style={style}>
      {t(`admin.users.role${role}`)}
    </span>
  )
}

const TIER_I18N_KEY: Record<AccountTierCode, string> = {
  individual: 'accountTier.individual',
  business: 'accountTier.business',
  athlete: 'accountTier.athlete',
  training_center: 'accountTier.trainingCenter',
}

function TierBadge({ tierCode, isEnterprise, t }: { tierCode: AccountTierCode; isEnterprise: boolean; t: (k: string) => string }) {
  const baseStyle: CSSProperties = { whiteSpace: 'nowrap' }
  const style: CSSProperties = isEnterprise
    ? {
        ...baseStyle,
        background: 'var(--accent-soft)',
        color: 'var(--accent-ink)',
        border: '1px solid var(--accent-border)',
      }
    : baseStyle
  return (
    <span className="pill" style={style}>
      {t(TIER_I18N_KEY[tierCode] ?? tierCode)}
    </span>
  )
}

interface RoleDialogProps {
  user: AdminUser
  targetRole: UserRole
  saving: boolean
  onCancel: () => void
  onConfirm: () => void
  t: (k: string, opts?: Record<string, string>) => string
}

function RoleChangeDialog({ user, targetRole, saving, onCancel, onConfirm, t }: RoleDialogProps) {
  const fromLabel = t(`admin.users.role${user.role}`)
  const toLabel = t(`admin.users.role${targetRole}`)
  const displayName = user.name ?? user.email

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(20,22,26,0.4)', zIndex: 50 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
    >
      <div
        data-testid="role-change-dialog"
        className="card"
        style={{ width: 440, borderRadius: 'var(--r-lg)', padding: 28 }}
      >
        <h2 id="dialog-title" className="text-lg font-semibold text-(--ink-1) mb-3">
          {t('admin.users.changeRoleTitle')}
        </h2>
        <p className="text-sm text-(--ink-2) mb-2">
          {t('admin.users.changeRoleBody', { name: displayName, from: fromLabel, to: toLabel })}
        </p>
        <p className="text-xs text-(--ink-3) mb-6">{t('admin.users.changeRoleWarning')}</p>
        <div className="flex justify-end gap-3">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving} aria-label={t('admin.users.cancel')}>
            {t('admin.users.cancel')}
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={saving} aria-label={t('admin.users.confirm')}>
            {t('admin.users.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

interface TierDialogProps {
  user: AdminUser
  tiers: AccountTier[]
  saving: boolean
  errorMsg: string | null
  onCancel: () => void
  onConfirm: (tierCode: AccountTierCode) => void
  t: (k: string, opts?: Record<string, string | number>) => string
}

function TierChangeDialog({ user, tiers, saving, errorMsg, onCancel, onConfirm, t }: TierDialogProps) {
  const [selectedTier, setSelectedTier] = useState<AccountTierCode>(user.account_tier_id)
  const tier = tiers.find(ti => ti.code === selectedTier)
  const displayName = user.name ?? user.email

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(20,22,26,0.4)', zIndex: 50 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tier-dialog-title"
    >
      <div
        data-testid="tier-change-dialog"
        className="card"
        style={{ width: 480, borderRadius: 'var(--r-lg)', padding: 28 }}
      >
        <h2 id="tier-dialog-title" className="text-lg font-semibold text-(--ink-1) mb-3">
          {t('admin.users.changeTierTitle')}
        </h2>
        <p className="text-sm text-(--ink-2) mb-4">
          {t('admin.users.changeTierBody', { name: displayName })}
        </p>

        <div className="mb-4">
          <label className="label mb-2" htmlFor="tier-select">
            {t('admin.users.changeTierSelectLabel')}
          </label>
          <select
            id="tier-select"
            data-testid="tier-select"
            className="input w-full"
            value={selectedTier}
            onChange={e => setSelectedTier(e.target.value as AccountTierCode)}
            style={{ height: 38 }}
          >
            {tiers.map(ti => (
              <option key={ti.code} value={ti.code}>
                {ti.name_vi}
              </option>
            ))}
          </select>
        </div>

        {tier && (
          <div
            className="mb-4"
            style={{
              background: 'var(--surface-2)',
              borderRadius: 'var(--r-md)',
              padding: '10px 14px',
              fontSize: 13,
              color: 'var(--ink-2)',
            }}
          >
            <div>{t('admin.users.changeTierFeeNote', { pct: String(tier.platform_fee_pct), max: String(tier.max_chapters_per_course) })}</div>
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            data-testid="tier-change-error"
            style={{
              background: 'var(--danger-soft)',
              color: 'var(--danger)',
              borderRadius: 'var(--r-md)',
              padding: '10px 14px',
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {errorMsg}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
            {t('admin.users.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="tier-change-confirm"
            onClick={() => onConfirm(selectedTier)}
            disabled={saving || selectedTier === user.account_tier_id}
          >
            {t('admin.users.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('vi-VN', { year: 'numeric', month: 'short', day: 'numeric' })
}

function UserAvatar({ name, email }: { name: string | null; email: string }) {
  const letter = name ? name.charAt(0).toUpperCase() : email.charAt(0).toUpperCase()
  return (
    <span className="avatar shrink-0" style={{ width: 32, height: 32 }} aria-hidden="true">
      {letter}
    </span>
  )
}

function nextRole(current: UserRole): UserRole {
  return current === 'learner' ? 'creator' : 'learner'
}

export default function AdminUsersPage() {
  const { t } = useTranslation()
  const { tiers, getTier } = useAccountTiers()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)

  // Role change
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const [targetRole, setTargetRole] = useState<UserRole | null>(null)
  const [saving, setSaving] = useState(false)

  // Tier change
  const [tierUser, setTierUser] = useState<AdminUser | null>(null)
  const [tierSaving, setTierSaving] = useState(false)
  const [tierErrorMsg, setTierErrorMsg] = useState<string | null>(null)

  const totalPages = Math.ceil(total / PAGE_SIZE)

  useEffect(() => {
    listUsers(supabase, { page, pageSize: PAGE_SIZE, search: debouncedSearch }).then(
      ({ users: u, total: tot }) => {
        setUsers(u)
        setTotal(tot)
        setLoading(false)
      }
    )
  }, [page, debouncedSearch])

  function openRoleDialog(user: AdminUser) {
    if (user.role === 'admin') return
    setSelectedUser(user)
    setTargetRole(nextRole(user.role))
  }

  function closeRoleDialog() {
    setSelectedUser(null)
    setTargetRole(null)
  }

  async function handleRoleConfirm() {
    if (!selectedUser || !targetRole) return
    setSaving(true)
    const { user: updated } = await changeUserRole(supabase, selectedUser.id, targetRole)
    if (updated) {
      setUsers(prev => prev.map(u => (u.id === updated.id ? updated : u)))
    }
    setSaving(false)
    closeRoleDialog()
  }

  function openTierDialog(user: AdminUser) {
    setTierUser(user)
    setTierErrorMsg(null)
  }

  function closeTierDialog() {
    setTierUser(null)
    setTierErrorMsg(null)
  }

  async function handleTierConfirm(newTier: AccountTierCode) {
    if (!tierUser) return
    setTierSaving(true)
    setTierErrorMsg(null)
    const { user: updated, error } = await changeUserAccountTier(supabase, tierUser.id, newTier)
    setTierSaving(false)
    if (error) {
      const msg = (error as { message?: string }).message ?? ''
      if (msg.includes('tier_downgrade_violates_chapter_limit')) {
        const courses = parseViolatingCourses(error)
        if (courses.length > 0) {
          const listed = courses
            .slice(0, 3)
            .map(c => `${c.title} (${c.chapter_count} chương)`)
            .join(', ')
          const extra =
            courses.length > 3
              ? ` ${t('errors.andMore', { count: String(courses.length - 3) })}`
              : ''
          setTierErrorMsg(t('errors.tierDowngradeBlockedWithCourses', { courses: listed + extra }))
        } else {
          setTierErrorMsg(t('errors.tierDowngradeBlocked'))
        }
      } else {
        setTierErrorMsg(t('admin.users.changeTierError'))
      }
      return
    }
    if (updated) {
      setUsers(prev => prev.map(u => (u.id === updated.id ? updated : u)))
    }
    closeTierDialog()
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top header */}
      <div
        className="flex items-center justify-between px-6 border-b border-(--border) bg-(--surface) shrink-0"
        style={{ height: 60 }}
      >
        <h1 className="text-lg font-semibold tracking-tight text-(--ink-1)" style={{ letterSpacing: '-0.01em' }}>
          {t('admin.users.pageTitle')}
        </h1>
        <input
          type="search"
          placeholder={t('admin.users.searchPlaceholder')}
          value={search}
          onChange={e => {
            setSearch(e.target.value)
            setPage(1)
          }}
          className="input"
          style={{ width: 280, height: 36 }}
          aria-label={t('admin.users.searchPlaceholder')}
        />
      </div>

      {/* Content */}
      <div className="flex-1 p-6 overflow-auto">
        <div className="card overflow-hidden">
          <table className="w-full" style={{ fontSize: 13 }}>
            <thead>
              <tr className="border-b border-(--border)">
                {[
                  t('admin.users.colName'),
                  t('admin.users.colEmail'),
                  t('admin.users.colRole'),
                  t('admin.users.colTier'),
                  t('admin.users.colCreatedAt'),
                  t('admin.users.colCoursesPurchased'),
                  t('admin.users.colCoursesCreated'),
                  '',
                ].map((col, i) => (
                  <th
                    key={i}
                    className="px-4 text-left font-medium uppercase text-(--ink-3)"
                    style={{ padding: '14px 16px', fontSize: 11.5, letterSpacing: '0.05em' }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center text-(--ink-3) py-10">
                    …
                  </td>
                </tr>
              ) : (
                users.map(user => {
                  const tier = getTier(user.account_tier_id)
                  return (
                    <tr key={user.id} className="border-b border-(--border) last:border-0">
                      <td style={{ padding: '14px 16px' }}>
                        <div className="flex items-center gap-2">
                          <UserAvatar name={user.name} email={user.email} />
                          <span className="font-medium text-(--ink-1)">{user.name ?? '—'}</span>
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px' }} className="text-(--ink-2)">
                        {user.email}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <RolePill role={user.role} t={t} />
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <TierBadge
                          tierCode={user.account_tier_id}
                          isEnterprise={tier?.is_enterprise ?? false}
                          t={t}
                        />
                      </td>
                      <td style={{ padding: '14px 16px' }} className="text-(--ink-2)">
                        {formatDate(user.created_at)}
                      </td>
                      <td style={{ padding: '14px 16px' }} className="text-(--ink-2)">
                        0
                      </td>
                      <td style={{ padding: '14px 16px' }} className="text-(--ink-2)">
                        0
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        {user.role !== 'admin' && (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => openRoleDialog(user)}
                              aria-label={t('admin.users.changeRole')}
                            >
                              {t('admin.users.changeRole')}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              data-testid={`change-tier-btn-${user.id}`}
                              onClick={() => openTierDialog(user)}
                              aria-label={t('admin.users.changeTier')}
                            >
                              {t('admin.users.changeTier')}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <span className="text-sm text-(--ink-3)">{total}</span>
            <div className="flex items-center gap-3">
              <button
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                aria-label="Previous page"
              >
                ←
              </button>
              <span className="text-sm text-(--ink-2)">
                {page} / {totalPages}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                aria-label="Next page"
              >
                →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Role change dialog */}
      {selectedUser && targetRole && (
        <RoleChangeDialog
          user={selectedUser}
          targetRole={targetRole}
          saving={saving}
          onCancel={closeRoleDialog}
          onConfirm={handleRoleConfirm}
          t={t}
        />
      )}

      {/* Tier change dialog */}
      {tierUser && (
        <TierChangeDialog
          user={tierUser}
          tiers={tiers}
          saving={tierSaving}
          errorMsg={tierErrorMsg}
          onCancel={closeTierDialog}
          onConfirm={handleTierConfirm}
          t={t}
        />
      )}
    </div>
  )
}
