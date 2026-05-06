import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { listUsers, changeUserRole } from '../../lib/adminApi'
import type { AdminUser, UserRole } from '../../lib/adminApi'
import { useDebounce } from '../../hooks/useDebounce'

const PAGE_SIZE = 20

const ROLE_PILL_CLASS: Record<UserRole, string> = {
  learner: 'pill',
  coach: 'pill pill-accent',
  admin: 'pill',
}

function RolePill({ role, t }: { role: UserRole; t: (k: string) => string }) {
  return (
    <span
      className={ROLE_PILL_CLASS[role]}
      style={role === 'admin' ? { background: 'var(--ink-1)', color: '#fff' } : undefined}
    >
      {t(`admin.users.role${role}`)}
    </span>
  )
}

interface DialogProps {
  user: AdminUser
  targetRole: UserRole
  saving: boolean
  onCancel: () => void
  onConfirm: () => void
  t: (k: string, opts?: Record<string, string>) => string
}

function RoleChangeDialog({ user, targetRole, saving, onCancel, onConfirm, t }: DialogProps) {
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
        <h2 id="dialog-title" className="text-lg font-semibold text-[--ink-1] mb-3">
          {t('admin.users.changeRoleTitle')}
        </h2>
        <p className="text-sm text-[--ink-2] mb-2">
          {t('admin.users.changeRoleBody', { name: displayName, from: fromLabel, to: toLabel })}
        </p>
        <p className="text-xs text-[--ink-3] mb-6">{t('admin.users.changeRoleWarning')}</p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={saving}
            aria-label={t('admin.users.cancel')}
          >
            {t('admin.users.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={saving}
            aria-label={t('admin.users.confirm')}
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
  return current === 'learner' ? 'coach' : 'learner'
}

export default function AdminUsersPage() {
  const { t } = useTranslation()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)

  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const [targetRole, setTargetRole] = useState<UserRole | null>(null)
  const [saving, setSaving] = useState(false)

  const totalPages = Math.ceil(total / PAGE_SIZE)

  useEffect(() => {
    setLoading(true)
    listUsers(supabase, { page, pageSize: PAGE_SIZE, search: debouncedSearch }).then(
      ({ users: u, total: tot }) => {
        setUsers(u)
        setTotal(tot)
        setLoading(false)
      }
    )
  }, [page, debouncedSearch])

  function openDialog(user: AdminUser) {
    if (user.role === 'admin') return
    setSelectedUser(user)
    setTargetRole(nextRole(user.role))
  }

  function closeDialog() {
    setSelectedUser(null)
    setTargetRole(null)
  }

  async function handleConfirm() {
    if (!selectedUser || !targetRole) return
    setSaving(true)
    const { user: updated } = await changeUserRole(supabase, selectedUser.id, targetRole)
    if (updated) {
      setUsers(prev => prev.map(u => (u.id === updated.id ? updated : u)))
    }
    setSaving(false)
    closeDialog()
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top header */}
      <div
        className="flex items-center justify-between px-6 border-b border-[--border] bg-[--surface] shrink-0"
        style={{ height: 60 }}
      >
        <h1 className="text-lg font-semibold tracking-tight text-[--ink-1]" style={{ letterSpacing: '-0.01em' }}>
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
              <tr className="border-b border-[--border]">
                {[
                  t('admin.users.colName'),
                  t('admin.users.colEmail'),
                  t('admin.users.colRole'),
                  t('admin.users.colCreatedAt'),
                  t('admin.users.colCoursesPurchased'),
                  t('admin.users.colCoursesCreated'),
                  '',
                ].map((col, i) => (
                  <th
                    key={i}
                    className="px-4 text-left font-medium uppercase text-[--ink-3]"
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
                  <td colSpan={7} className="text-center text-[--ink-3] py-10">
                    …
                  </td>
                </tr>
              ) : (
                users.map(user => (
                  <tr key={user.id} className="border-b border-[--border] last:border-0">
                    <td style={{ padding: '14px 16px' }}>
                      <div className="flex items-center gap-2">
                        <UserAvatar name={user.name} email={user.email} />
                        <span className="font-medium text-[--ink-1]">{user.name ?? '—'}</span>
                      </div>
                    </td>
                    <td style={{ padding: '14px 16px' }} className="text-[--ink-2]">
                      {user.email}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <RolePill role={user.role} t={t} />
                    </td>
                    <td style={{ padding: '14px 16px' }} className="text-[--ink-2]">
                      {formatDate(user.created_at)}
                    </td>
                    <td style={{ padding: '14px 16px' }} className="text-[--ink-2]">
                      0
                    </td>
                    <td style={{ padding: '14px 16px' }} className="text-[--ink-2]">
                      0
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      {user.role !== 'admin' && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => openDialog(user)}
                          aria-label={t('admin.users.changeRole')}
                        >
                          {t('admin.users.changeRole')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <span className="text-sm text-[--ink-3]">{total}</span>
            <div className="flex items-center gap-3">
              <button
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                aria-label="Previous page"
              >
                ←
              </button>
              <span className="text-sm text-[--ink-2]">
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
          onCancel={closeDialog}
          onConfirm={handleConfirm}
          t={t}
        />
      )}
    </div>
  )
}
