import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  X,
  UserCheck,
  UserPlus,
  Trash2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Search,
  Shield,
} from 'lucide-react'
import {
  type LiveSession,
  type LiveSessionStaff,
} from '../../types/liveSession'
import {
  listLiveSessionStaff,
  addLiveSessionAssistant,
  removeLiveSessionAssistant,
  lookupUserForAssistant,
} from '../../lib/liveSessionApi'

export interface SessionStaffModalProps {
  session: LiveSession
  courseCreatorId?: string
  onClose: () => void
}

export default function SessionStaffModal({
  session,
  courseCreatorId,
  onClose,
}: SessionStaffModalProps) {
  const { t } = useTranslation()
  const isTerminal = session.status === 'ENDED' || session.status === 'CANCELLED'

  const [staffList, setStaffList] = useState<LiveSessionStaff[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ id: string; name: string; email: string }[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedUser, setSelectedUser] = useState<{ id: string; name: string; email: string } | null>(null)

  const loadStaff = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { staff, error: err } = await listLiveSessionStaff(undefined, session.id)
    if (err) {
      setError(err.message)
    } else {
      setStaffList(staff || [])
    }
    setLoading(false)
  }, [session.id])

  useEffect(() => {
    loadStaff()
  }, [loadStaff])

  // Search users with debounce
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResults([])
      return
    }

    const timer = setTimeout(async () => {
      setSearching(true)
      const { users, error: err } = await lookupUserForAssistant(undefined, searchQuery.trim())
      if (!err && users) {
        // Filter out course creator and already assigned assistants
        const filtered = users.filter(
          (u) =>
            u.id !== courseCreatorId &&
            !staffList.some((st) => st.userId === u.id)
        )
        setSearchResults(filtered)
      }
      setSearching(false)
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery, courseCreatorId, staffList])

  const handleAddAssistant = async (userToAdd?: { id: string; name: string; email: string }) => {
    const target = userToAdd || selectedUser
    if (!target) return

    if (target.id === courseCreatorId) {
      setError('Không thể gán người tạo khóa học làm trợ giảng.')
      return
    }

    if (staffList.some((st) => st.userId === target.id)) {
      setError('Người dùng này đã là trợ giảng cho buổi học này.')
      return
    }

    setActionLoadingId(target.id)
    setError(null)
    setSuccessMsg(null)

    const { success, error: err } = await addLiveSessionAssistant(undefined, session.id, target.id)
    if (err || !success) {
      setError(err?.message || 'Không thể thêm trợ giảng')
    } else {
      setSuccessMsg(`Đã thêm ${target.name || target.email} làm trợ giảng`)
      setSelectedUser(null)
      setSearchQuery('')
      setSearchResults([])
      await loadStaff()
    }
    setActionLoadingId(null)
  }

  const handleRemoveAssistant = async (userId: string, userName?: string) => {
    if (isTerminal) return
    setActionLoadingId(userId)
    setError(null)
    setSuccessMsg(null)

    const { success, error: err } = await removeLiveSessionAssistant(undefined, session.id, userId)
    if (err || !success) {
      setError(err?.message || 'Không thể xóa trợ giảng')
    } else {
      setSuccessMsg(`Đã xóa ${userName || 'trợ giảng'} khỏi buổi học`)
      await loadStaff()
    }
    setActionLoadingId(null)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="w-full max-w-lg bg-(--surface) border border-(--border) rounded-xl shadow-2xl overflow-hidden flex flex-col my-8"
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-(--border) bg-(--surface-2)">
          <div className="flex items-center gap-2 min-w-0">
            <Shield className="w-5 h-5 text-indigo-500 shrink-0" />
            <div>
              <h2 id="staff-modal-title" className="font-bold text-sm sm:text-base text-(--ink-1) truncate">
                Quản lý Trợ giảng
              </h2>
              <p className="text-xs text-(--ink-3) truncate">{session.title}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="p-1 rounded-md text-(--ink-3) hover:text-(--ink-1) hover:bg-(--surface-3) transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 flex flex-col gap-4 overflow-y-auto max-h-[75vh]">
          {/* Status Message Banners */}
          {error && (
            <div className="p-3 rounded-md bg-red-500/10 border border-red-500/30 text-xs font-semibold text-red-600 dark:text-red-400 flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
              <CheckCircle2 size={14} className="shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {isTerminal && (
            <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/30 text-xs font-medium text-amber-600 dark:text-amber-400 flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0" />
              <span>Buổi học đã kết thúc hoặc bị hủy, không thể thay đổi danh sách trợ giảng.</span>
            </div>
          )}

          {/* Add Assistant Section (Only for active sessions) */}
          {!isTerminal && (
            <div className="p-4 rounded-lg bg-(--surface-2) border border-(--border) flex flex-col gap-3">
              <label className="text-xs font-bold text-(--ink-1) flex items-center gap-1.5">
                <UserPlus size={14} className="text-indigo-500" />
                <span>Thêm trợ giảng mới</span>
              </label>

              <div className="relative">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-(--ink-3) absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value)
                        setSelectedUser(null)
                      }}
                      placeholder="Tìm theo email, tên hoặc User ID..."
                      className="w-full pl-9 pr-3 py-1.5 rounded-md border border-(--border) bg-(--surface) text-xs text-(--ink-1) placeholder:text-(--ink-3) focus:outline-hidden focus:border-indigo-500"
                    />
                  </div>
                </div>

                {/* Dropdown Results */}
                {searching && (
                  <div className="absolute top-full left-0 right-0 mt-1 p-2 bg-(--surface) border border-(--border) rounded-md shadow-lg z-20 text-xs text-(--ink-3) flex items-center gap-2">
                    <Loader2 size={12} className="animate-spin" />
                    <span>Đang tìm kiếm người dùng...</span>
                  </div>
                )}

                {searchResults.length > 0 && (
                  <ul className="absolute top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-(--surface) border border-(--border) rounded-md shadow-lg z-20 py-1 divide-y divide-(--border)">
                    {searchResults.map((user) => (
                      <li
                        key={user.id}
                        onClick={() => handleAddAssistant(user)}
                        className="px-3 py-2 text-xs flex items-center justify-between hover:bg-(--surface-2) cursor-pointer transition-colors"
                      >
                        <div className="min-w-0 pr-2">
                          <p className="font-semibold text-(--ink-1) truncate">{user.name || 'User'}</p>
                          <p className="text-[11px] text-(--ink-3) truncate">{user.email}</p>
                        </div>
                        <span className="shrink-0 px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-semibold text-[10px]">
                          + Gán
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* Current Staff List */}
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-bold text-(--ink-2) uppercase tracking-wider">
              Danh sách trợ giảng ({staffList.length})
            </h3>

            {loading ? (
              <div className="py-6 flex flex-col items-center justify-center gap-2 text-xs text-(--ink-3)">
                <Loader2 size={16} className="animate-spin text-indigo-500" />
                <span>Đang tải danh sách trợ giảng...</span>
              </div>
            ) : staffList.length === 0 ? (
              <div className="py-6 text-center text-xs text-(--ink-3) border border-dashed border-(--border) rounded-md bg-(--surface-2)/50">
                Chưa có trợ giảng nào được gán cho buổi học này.
              </div>
            ) : (
              <div className="divide-y divide-(--border) border border-(--border) rounded-lg overflow-hidden bg-(--surface)">
                {staffList.map((st) => (
                  <div key={st.id} className="p-3 flex items-center justify-between gap-3 hover:bg-(--surface-2)/40 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-xs shrink-0">
                        {(st.userName || st.userEmail || 'A').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-semibold text-(--ink-1) truncate">
                            {st.userName || 'Trợ giảng'}
                          </p>
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                            Assistant
                          </span>
                        </div>
                        {st.userEmail && (
                          <p className="text-[11px] text-(--ink-3) truncate">{st.userEmail}</p>
                        )}
                      </div>
                    </div>

                    {!isTerminal && (
                      <button
                        type="button"
                        onClick={() => handleRemoveAssistant(st.userId, st.userName)}
                        disabled={actionLoadingId === st.userId}
                        title="Xóa trợ giảng"
                        className="p-1.5 rounded-md text-(--ink-3) hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                      >
                        {actionLoadingId === st.userId ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-(--border) bg-(--surface-2) flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-md text-xs font-semibold border border-(--border) text-(--ink-1) hover:bg-(--surface-3) transition-colors cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  )
}
