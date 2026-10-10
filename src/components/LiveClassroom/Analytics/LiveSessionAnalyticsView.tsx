import { useState, useEffect, useRef, useMemo } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  Loader2,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Users,
  Swords,
  Clock,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  Search,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  Award,
  Eye,
  Info,
  Layers,
  HelpCircle,
  X,
} from 'lucide-react'
import { supabase as defaultSupabase } from '../../../lib/supabase'
import { getLiveSessionAnalytics } from '../../../lib/liveSessionAnalyticsApi'
import type {
  LiveSessionAnalytics,
  ParticipantAttendanceSummary,
} from '../../../types/liveSessionAnalytics'
import { SessionGameReplayModal } from '../Replay'

export interface LiveSessionAnalyticsViewProps {
  sessionId: string
  supabaseClient?: SupabaseClient
  onClose?: () => void
  onOpenReplay?: (boardId?: string) => void
  className?: string
}

function formatDurationSeconds(seconds: number | null): string {
  if (seconds === null || isNaN(seconds)) return 'N/A'
  if (seconds === 0) return '0 giây'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const parts: string[] = []
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  if (s > 0 || parts.length === 0) parts.push(`${s}s`)
  return parts.join(' ')
}

function formatDateTime(isoString: string | null): string {
  if (!isoString) return '—'
  try {
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return '—'
    return d.toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return '—'
  }
}

export default function LiveSessionAnalyticsView({
  sessionId,
  supabaseClient = defaultSupabase,
  onClose,
  onOpenReplay,
  className = '',
}: LiveSessionAnalyticsViewProps) {
  // State
  const [analytics, setAnalytics] = useState<LiveSessionAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isUnauthorized, setIsUnauthorized] = useState(false)
  const [activeTab, setActiveTab] = useState<'operational' | 'chess'>('operational')
  const [rosterSearch, setRosterSearch] = useState('')
  const [replayBoardId, setReplayBoardId] = useState<string | null>(null)

  // Race condition & session-switch tracking refs
  const requestIdRef = useRef(0)
  const latestSessionIdRef = useRef(sessionId)
  const isMountedRef = useRef(true)

  const loadData = async (targetId: string) => {
    const currentReqId = ++requestIdRef.current
    latestSessionIdRef.current = targetId

    setLoading(true)
    setError(null)
    setIsUnauthorized(false)

    try {
      const { data, error: apiErr } = await getLiveSessionAnalytics(supabaseClient, targetId)

      // Guard against stale response if sessionId changed while waiting or unmounted
      if (!isMountedRef.current || currentReqId !== requestIdRef.current || latestSessionIdRef.current !== targetId) {
        return
      }

      if (apiErr) {
        const msg = apiErr.message.toLowerCase()
        if (msg.includes('forbidden') || msg.includes('unauthorized')) {
          setIsUnauthorized(true)
          setAnalytics(null)
        } else {
          setError(apiErr.message)
          setAnalytics(null)
        }
      } else {
        setAnalytics(data)
      }
    } catch (err) {
      if (!isMountedRef.current || currentReqId !== requestIdRef.current || latestSessionIdRef.current !== targetId) {
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      if (message.toLowerCase().includes('forbidden') || message.toLowerCase().includes('unauthorized')) {
        setIsUnauthorized(true)
      } else {
        setError(message)
      }
      setAnalytics(null)
    } finally {
      if (isMountedRef.current && currentReqId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    isMountedRef.current = true
    loadData(sessionId)
    return () => {
      // Invalidate pending requests on unmount or sessionId switch
      isMountedRef.current = false
      requestIdRef.current += 1
    }
  }, [sessionId, supabaseClient])

  // Filtered Student Roster
  const filteredRoster = useMemo(() => {
    if (!analytics?.operational.studentRoster) return []
    const term = rosterSearch.trim().toLowerCase()
    if (!term) return analytics.operational.studentRoster
    return analytics.operational.studentRoster.filter(
      (s) =>
        s.userName.toLowerCase().includes(term) ||
        s.userEmail.toLowerCase().includes(term) ||
        s.attendanceStatus.toLowerCase().includes(term)
    )
  }, [analytics, rosterSearch])

  // 1. Loading State
  if (loading) {
    return (
      <div
        data-testid="analytics-loading"
        className={`flex flex-col items-center justify-center min-h-80 p-8 text-center bg-(--surface) rounded-xl border border-(--border) ${className}`}
      >
        <Loader2 className="w-9 h-9 text-(--accent) animate-spin mb-3" />
        <p className="text-sm font-semibold text-(--ink-1)">Đang tải báo cáo phân tích buổi học...</p>
        <p className="text-xs text-(--ink-3) mt-1">Đang tổng hợp dữ liệu điểm danh và lịch sử thi đấu</p>
      </div>
    )
  }

  // 2. Unauthorized View
  if (isUnauthorized) {
    return (
      <div
        data-testid="analytics-unauthorized"
        className={`flex flex-col items-center justify-center min-h-80 p-8 text-center bg-(--surface) rounded-xl border border-red-500/20 ${className}`}
      >
        <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mb-4">
          <ShieldAlert size={28} />
        </div>
        <h3 className="text-base font-bold text-(--ink-1)">Không có quyền truy cập (403 Forbidden)</h3>
        <p className="text-xs text-(--ink-3) max-w-md mt-2">
          Báo cáo phân tích và điểm danh buổi học chỉ dành riêng cho Giáo viên phụ trách, Trợ giảng được phân công và
          Quản trị viên nền tảng.
        </p>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="mt-6 px-4 py-2 rounded-lg bg-(--surface-2) hover:bg-(--surface-3) text-xs font-semibold text-(--ink-2) border border-(--border) transition-colors cursor-pointer"
          >
            Đóng
          </button>
        )}
      </div>
    )
  }

  // 3. Error View
  if (error || !analytics) {
    return (
      <div
        data-testid="analytics-error"
        className={`flex flex-col items-center justify-center min-h-80 p-8 text-center bg-(--surface) rounded-xl border border-red-500/20 ${className}`}
      >
        <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mb-4">
          <AlertCircle size={28} />
        </div>
        <h3 className="text-base font-bold text-(--ink-1)">Không thể tải báo cáo</h3>
        <p className="text-xs text-(--ink-3) max-w-md mt-2">{error || 'Không tìm thấy dữ liệu phân tích buổi học.'}</p>
        <div className="flex items-center gap-3 mt-6">
          <button
            type="button"
            data-testid="analytics-retry-btn"
            onClick={() => loadData(sessionId)}
            className="px-4 py-2 rounded-lg bg-(--accent) text-white text-xs font-semibold hover:opacity-90 transition-opacity flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <RefreshCw size={14} />
            <span>Thử lại</span>
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-(--surface-2) hover:bg-(--surface-3) text-xs font-semibold text-(--ink-2) border border-(--border) transition-colors cursor-pointer"
            >
              Đóng
            </button>
          )}
        </div>
      </div>
    )
  }

  const { operational, chess } = analytics
  const { timing, studentAttendance, durationStats, staffAttendance } = operational

  const getStatusBadge = () => {
    switch (timing.status) {
      case 'LIVE':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-500/15 border border-red-500/30 text-red-600 dark:text-red-400">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            ĐANG DIỄN RA
          </span>
        )
      case 'SCHEDULED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400">
            <Clock size={11} /> SẮP DIỄN RA
          </span>
        )
      case 'ENDED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={11} /> ĐÃ KẾT THÚC
          </span>
        )
      case 'DRAFT':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400">
            BẢN NHÁP
          </span>
        )
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-500 line-through">
            ĐÃ HỦY
          </span>
        )
    }
  }

  return (
    <div
      data-testid="live-session-analytics-view"
      className={`flex flex-col bg-(--surface) rounded-xl border border-(--border) overflow-hidden shadow-xs ${className}`}
    >
      {/* ── Top Header ────────────────────────────────────────────────────────── */}
      <div className="p-5 sm:p-6 border-b border-(--border) bg-(--surface-2)">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              {getStatusBadge()}
              <h2 className="text-lg font-bold text-(--ink-1) truncate">{operational.title || 'Buổi học trực tuyến'}</h2>
            </div>
            <div className="flex items-center gap-4 text-xs text-(--ink-3) mt-1.5 flex-wrap">
              <span>Lịch: {formatDateTime(timing.scheduledStartAt)}</span>
              {timing.startedAt && <span>Bắt đầu thực tế: {formatDateTime(timing.startedAt)}</span>}
              {timing.endedAt && <span>Kết thúc: {formatDateTime(timing.endedAt)}</span>}
              <span>
                Thời lượng: <strong className="text-(--ink-1)">{formatDurationSeconds(timing.durationSeconds)}</strong>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              data-testid="analytics-refresh-btn"
              onClick={() => loadData(sessionId)}
              className="p-2 rounded-lg bg-(--surface) hover:bg-(--surface-3) text-(--ink-2) border border-(--border) transition-colors cursor-pointer"
              title="Làm mới báo cáo"
            >
              <RefreshCw size={15} />
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-lg bg-(--surface) hover:bg-(--surface-3) text-(--ink-2) border border-(--border) transition-colors cursor-pointer"
                title="Đóng báo cáo"
              >
                <X size={15} />
              </button>
            )}
          </div>
        </div>

        {/* ── Diagnostic & Integrity Banners ─────────────────────────────────── */}
        <div className="mt-4 flex flex-col gap-2">
          {/* Cache Mismatch Banner */}
          {analytics.hasCacheMismatch && (
            <div
              data-testid="cache-mismatch-banner"
              className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 text-xs flex items-start gap-2.5"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <strong className="font-semibold">Cảnh báo lệch bộ nhớ đệm (Course Cache Mismatch):</strong>
                <p className="mt-0.5 opacity-90">
                  Phát hiện chênh lệch giữa số lượng ghi danh thực tế và bộ nhớ đệm của khóa học. Sĩ số đang hiển thị dựa
                  trên dữ liệu ghi danh trực tiếp có thẩm quyền.
                </p>
              </div>
            </div>
          )}

          {/* Roster Conflict Banner */}
          {analytics.hasRosterConflict && (
            <div
              data-testid="roster-conflict-banner"
              className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-400 text-xs flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <strong className="font-semibold">Xung đột danh sách điểm danh (Roster Conflict):</strong>
                <p className="mt-0.5 opacity-90">
                  Số lượng học viên trong danh sách điểm danh vượt quá sĩ số ghi danh đã ghi nhận. Tỷ lệ tham dự và số học
                  viên chưa vào tạm thời bị ẩn để tránh sai lệch dữ liệu.
                </p>
              </div>
            </div>
          )}

          {/* Finalized Roster Missing Diagnostic Banner */}
          {analytics.isFinalizedRosterMissing && (
            <div
              data-testid="finalized-roster-missing-banner"
              className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2.5"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500 mt-0.5" />
              <div>
                <strong className="font-semibold">Thiếu danh sách điểm danh sau khi kết thúc:</strong>
                <p className="mt-0.5 opacity-90 leading-relaxed">
                  Buổi học đã kết thúc nhưng danh sách điểm danh chính thức chưa được hoàn thiện hoặc bị thiếu. Tỷ lệ tham dự và học viên chưa tham gia không thể xác định chính xác và không được tính là 0%.
                </p>
              </div>
            </div>
          )}

          {/* Partial Data Notice */}
          {analytics.isPartialData &&
            !analytics.hasCacheMismatch &&
            !analytics.hasRosterConflict &&
            !analytics.isFinalizedRosterMissing && (
              <div
                data-testid="partial-data-banner"
                className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-400 text-xs flex items-start gap-2.5"
              >
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-semibold">Dữ liệu thống kê tạm thời:</strong>
                  <p className="mt-0.5 opacity-90">
                    {timing.status === 'LIVE'
                      ? 'Buổi học đang diễn ra. Dữ liệu vắng mặt chưa được chốt sổ tự động.'
                      : timing.status === 'CANCELLED'
                      ? 'Buổi học đã bị hủy. Dữ liệu chỉ phản ánh giai đoạn trước khi hủy.'
                      : 'Báo cáo có thể chưa phản ánh đầy đủ toàn bộ người tham gia do thiếu thông tin chốt sổ.'}
                  </p>
                </div>
              </div>
            )}

          {/* Unstarted Notice */}
          {(timing.status === 'DRAFT' || timing.status === 'SCHEDULED') && (
            <div
              data-testid="unstarted-session-banner"
              className="p-3 rounded-lg bg-(--surface) border border-(--border) text-(--ink-3) text-xs flex items-center gap-2"
            >
              <Clock className="w-4 h-4 shrink-0 text-(--ink-4)" />
              <span>Buổi học chưa bắt đầu. Tỷ lệ tham dự và thời lượng sẽ có sau khi buổi học diễn ra.</span>
            </div>
          )}
        </div>

        {/* ── Navigation Tabs ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 mt-5">
          <button
            type="button"
            data-testid="tab-operational"
            onClick={() => setActiveTab('operational')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'operational'
                ? 'bg-(--accent) text-white shadow-xs'
                : 'bg-(--surface) text-(--ink-2) border border-(--border) hover:bg-(--surface-3)'
            }`}
          >
            <Users size={14} />
            <span>Vận hành & Điểm danh</span>
            <span className="opacity-80 text-[10px]">({operational.studentRoster.length})</span>
          </button>

          <button
            type="button"
            data-testid="tab-chess"
            onClick={() => setActiveTab('chess')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'chess'
                ? 'bg-(--accent) text-white shadow-xs'
                : 'bg-(--surface) text-(--ink-2) border border-(--border) hover:bg-(--surface-3)'
            }`}
          >
            <Swords size={14} />
            <span>Ván cờ ({chess.totalGames})</span>
          </button>
        </div>
      </div>

      {/* ── Tab Content ──────────────────────────────────────────────────────── */}
      <div className="p-5 sm:p-6 flex-1 overflow-y-auto">
        {activeTab === 'operational' ? (
          <div className="space-y-6">
            {/* KPI Cards Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {/* Total Enrolled */}
              <div
                data-testid="metric-total-enrolled"
                className="p-3.5 rounded-xl bg-(--surface-2) border border-(--border) flex flex-col justify-between"
              >
                <span className="text-[11px] font-medium text-(--ink-3)">Tổng ghi danh</span>
                <div className="mt-1">
                  <span className="text-xl font-bold text-(--ink-1)">
                    {studentAttendance.totalEnrolled !== null ? studentAttendance.totalEnrolled : 'N/A'}
                  </span>
                </div>
                <span className="text-[10px] text-(--ink-4) mt-1">
                  {studentAttendance.completeness === 'FINALIZED'
                    ? analytics.isFinalizedRosterMissing
                      ? 'Theo sĩ số khóa học (thiếu chốt sổ)'
                      : operational.studentRoster.length > 0
                      ? 'Theo danh sách chốt sổ'
                      : studentAttendance.totalEnrolled === 0
                      ? 'Không có học viên ghi danh'
                      : 'Theo sĩ số khóa học'
                    : 'Sĩ số khóa học'}
                </span>
              </div>

              {/* Attended Count */}
              <div
                data-testid="metric-attended-count"
                className="p-3.5 rounded-xl bg-(--surface-2) border border-(--border) flex flex-col justify-between"
              >
                <span className="text-[11px] font-medium text-(--ink-3)">Đã tham dự</span>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                    {studentAttendance.attendedCount}
                  </span>
                  <span className="text-[11px] text-(--ink-3)">học viên</span>
                </div>
                <span className="text-[10px] text-(--ink-4) mt-1">
                  {studentAttendance.presentCount} đủ • {studentAttendance.partialCount} một phần
                </span>
              </div>

              {/* Attendance Rate */}
              <div
                data-testid="metric-attendance-rate"
                className="p-3.5 rounded-xl bg-(--surface-2) border border-(--border) flex flex-col justify-between"
              >
                <span className="text-[11px] font-medium text-(--ink-3)">Tỷ lệ tham dự</span>
                <div className="mt-1">
                  <span className="text-xl font-bold text-(--accent)">
                    {studentAttendance.attendanceRatePct !== null ? `${studentAttendance.attendanceRatePct}%` : 'N/A'}
                  </span>
                </div>
                <span className="text-[10px] text-(--ink-4) mt-1">
                  {studentAttendance.attendanceRatePct !== null
                    ? (studentAttendance.completeness === 'FINALIZED' ? 'Theo hồ sơ chốt sổ' : 'Theo sĩ số ghi danh')
                    : 'Chưa xác định'}
                </span>
              </div>

              {/* Not Joined Count */}
              <div
                data-testid="metric-not-joined-count"
                className="p-3.5 rounded-xl bg-(--surface-2) border border-(--border) flex flex-col justify-between"
              >
                <span className="text-[11px] font-medium text-(--ink-3)">Chưa vào phòng</span>
                <div className="mt-1">
                  <span className="text-xl font-bold text-amber-600 dark:text-amber-400">
                    {studentAttendance.notJoinedCount !== null ? studentAttendance.notJoinedCount : 'N/A'}
                  </span>
                </div>
                <span className="text-[10px] text-(--ink-4) mt-1">Học viên chưa vào</span>
              </div>

              {/* Absent Count (Finalized) */}
              <div
                data-testid="metric-absent-count"
                className="p-3.5 rounded-xl bg-(--surface-2) border border-(--border) flex flex-col justify-between"
              >
                <span className="text-[11px] font-medium text-(--ink-3)">Vắng mặt</span>
                <div className="mt-1">
                  <span className="text-xl font-bold text-(--ink-2)">{studentAttendance.absentCount}</span>
                </div>
                <span className="text-[10px] text-(--ink-4) mt-1">
                  {studentAttendance.completeness === 'FINALIZED' ? 'Đã chốt sổ vắng' : 'Tạm thời'}
                </span>
              </div>

              {/* Late Count & Rate */}
              <div
                data-testid="metric-late-count"
                className="p-3.5 rounded-xl bg-(--surface-2) border border-(--border) flex flex-col justify-between"
              >
                <span className="text-[11px] font-medium text-(--ink-3)">Đến muộn</span>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-xl font-bold text-rose-500">{studentAttendance.lateCount}</span>
                  {studentAttendance.lateRatePct !== null && (
                    <span className="text-xs font-semibold text-rose-500/80">({studentAttendance.lateRatePct}%)</span>
                  )}
                </div>
                <span className="text-[10px] text-(--ink-4) mt-1">Học viên vào sau giờ</span>
              </div>
            </div>

            {/* Attendance Duration & Staff Summary */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Duration Stats Card */}
              <div
                data-testid="duration-stats-card"
                className="p-4 rounded-xl bg-(--surface-2) border border-(--border) space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-(--ink-1) flex items-center gap-1.5">
                    <Clock size={14} className="text-(--accent)" />
                    Thời lượng tham dự của học viên
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-center">
                  <div className="p-2 rounded-lg bg-(--surface) border border-(--border)">
                    <span className="text-[10px] text-(--ink-3) block">Tổng thời lượng</span>
                    <strong className="text-xs font-bold text-(--ink-1)">
                      {formatDurationSeconds(durationStats.totalDurationSeconds)}
                    </strong>
                  </div>
                  <div className="p-2 rounded-lg bg-(--surface) border border-(--border)">
                    <span className="text-[10px] text-(--ink-3) block">Trung bình</span>
                    <strong className="text-xs font-bold text-(--ink-1)">
                      {formatDurationSeconds(durationStats.averageDurationSeconds)}
                    </strong>
                  </div>
                  <div className="p-2 rounded-lg bg-(--surface) border border-(--border)">
                    <span className="text-[10px] text-(--ink-3) block">Ngắn nhất</span>
                    <strong className="text-xs font-bold text-(--ink-1)">
                      {formatDurationSeconds(durationStats.minDurationSeconds)}
                    </strong>
                  </div>
                  <div className="p-2 rounded-lg bg-(--surface) border border-(--border)">
                    <span className="text-[10px] text-(--ink-3) block">Dài nhất</span>
                    <strong className="text-xs font-bold text-(--ink-1)">
                      {formatDurationSeconds(durationStats.maxDurationSeconds)}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Staff Attendance Card */}
              <div
                data-testid="staff-stats-card"
                className="p-4 rounded-xl bg-(--surface-2) border border-(--border) space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-(--ink-1) flex items-center gap-1.5">
                    <Award size={14} className="text-(--accent)" />
                    Điểm danh Giáo viên & Trợ giảng
                  </span>
                  <span className="text-[11px] text-(--ink-3)">Tổng {staffAttendance.totalStaff} nhân sự</span>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                  <div className="p-2 rounded-lg bg-(--surface) border border-(--border)">
                    <span className="text-[10px] text-(--ink-3) block">Có mặt</span>
                    <strong className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      {staffAttendance.presentStaff}
                    </strong>
                  </div>
                  <div className="p-2 rounded-lg bg-(--surface) border border-(--border)">
                    <span className="text-[10px] text-(--ink-3) block">Vắng mặt</span>
                    <strong className="text-xs font-bold text-(--ink-2)">{staffAttendance.absentStaff}</strong>
                  </div>
                  <div className="p-2 rounded-lg bg-(--surface) border border-(--border)">
                    <span className="text-[10px] text-(--ink-3) block">Đến muộn</span>
                    <strong className="text-xs font-bold text-rose-500">{staffAttendance.lateStaff}</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Student Attendance Roster Table */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-(--ink-1)">Danh sách điểm danh học viên</h3>
                  <p className="text-xs text-(--ink-3)">
                    Hiển thị {filteredRoster.length} / {operational.studentRoster.length} học viên
                  </p>
                </div>

                <div className="relative w-full sm:w-64">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-(--ink-4)" />
                  <input
                    type="text"
                    data-testid="roster-search-input"
                    value={rosterSearch}
                    onChange={(e) => setRosterSearch(e.target.value)}
                    placeholder="Tìm tên, email..."
                    className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-(--surface-2) border border-(--border) text-xs text-(--ink-1) placeholder:text-(--ink-4) focus:outline-hidden focus:border-(--accent)"
                  />
                </div>
              </div>

              {filteredRoster.length === 0 ? (
                <div
                  data-testid="roster-empty-state"
                  className="p-8 text-center rounded-xl bg-(--surface-2) border border-(--border) text-xs text-(--ink-3)"
                >
                  {rosterSearch
                    ? 'Không tìm thấy học viên nào phù hợp với từ khóa.'
                    : 'Chưa có dữ liệu danh sách học viên trong buổi học này.'}
                </div>
              ) : (
                <div className="border border-(--border) rounded-xl overflow-hidden bg-(--surface)">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs" data-testid="roster-table">
                      <thead className="bg-(--surface-2) text-(--ink-3) font-semibold border-b border-(--border)">
                        <tr>
                          <th className="py-2.5 px-3">Học viên</th>
                          <th className="py-2.5 px-3">Trạng thái</th>
                          <th className="py-2.5 px-3">Thời lượng</th>
                          <th className="py-2.5 px-3">Đúng giờ / Muộn</th>
                          <th className="py-2.5 px-3">Vào lúc</th>
                          <th className="py-2.5 px-3">Rời phòng</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-(--border)">
                        {filteredRoster.map((student) => (
                          <tr key={student.userId} className="hover:bg-(--surface-2)/60 transition-colors">
                            <td className="py-2.5 px-3">
                              <span className="font-semibold text-(--ink-1) block">{student.userName}</span>
                              <span className="text-[11px] text-(--ink-3)">{student.userEmail || '—'}</span>
                            </td>
                            <td className="py-2.5 px-3">
                              {student.attendanceStatus === 'PRESENT' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                  CÓ MẶT
                                </span>
                              )}
                              {student.attendanceStatus === 'PARTIAL' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                  MỘT PHẦN
                                </span>
                              )}
                              {student.attendanceStatus === 'ABSENT' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-500/10 text-(--ink-3)">
                                  VẮNG MẶT
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-[11px] text-(--ink-2)">
                              {formatDurationSeconds(student.totalDurationSeconds)}
                            </td>
                            <td className="py-2.5 px-3">
                              {student.isLate ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-600">
                                  Đến muộn
                                </span>
                              ) : (
                                <span className="text-[11px] text-(--ink-3)">Đúng giờ</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-[11px] text-(--ink-3)">
                              {formatDateTime(student.firstJoinedAt)}
                            </td>
                            <td className="py-2.5 px-3 text-[11px] text-(--ink-3)">
                              {formatDateTime(student.lastLeftAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ── Tab 2: Chess Analytics ────────────────────────────────────────── */
          <div className="space-y-6">
            {/* Game Count Overview */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div
                data-testid="chess-metric-total-games"
                className="p-3.5 rounded-xl bg-(--surface-2) border border-(--border)"
              >
                <span className="text-[11px] font-medium text-(--ink-3)">Tổng ván đấu</span>
                <div className="mt-1">
                  <span className="text-xl font-bold text-(--ink-1)">{chess.totalGames}</span>
                </div>
                <span className="text-[10px] text-(--ink-4)">Trong toàn buổi học</span>
              </div>

              <div
                data-testid="chess-metric-completed-games"
                className="p-3.5 rounded-xl bg-(--surface-2) border border-(--border)"
              >
                <span className="text-[11px] font-medium text-(--ink-3)">Hoàn thành</span>
                <div className="mt-1">
                  <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                    {chess.completedGames}
                  </span>
                </div>
                <span className="text-[10px] text-(--ink-4)">Có kết quả cuối cùng</span>
              </div>

              <div
                data-testid="chess-metric-unfinished-games"
                className="p-3.5 rounded-xl bg-(--surface-2) border border-(--border)"
              >
                <span className="text-[11px] font-medium text-(--ink-3)">Chưa hoàn thành</span>
                <div className="mt-1">
                  <span className="text-xl font-bold text-amber-600 dark:text-amber-400">
                    {chess.unfinishedGames}
                  </span>
                </div>
                <span className="text-[10px] text-(--ink-4)">Đang đấu dở khi kết thúc</span>
              </div>

              <div
                data-testid="chess-metric-aborted-games"
                className="p-3.5 rounded-xl bg-(--surface-2) border border-(--border)"
              >
                <span className="text-[11px] font-medium text-(--ink-3)">Đã hủy (Aborted)</span>
                <div className="mt-1">
                  <span className="text-xl font-bold text-(--ink-3)">{chess.abortedGames}</span>
                </div>
                <span className="text-[10px] text-(--ink-4)">Hủy sớm hoặc lỗi</span>
              </div>
            </div>

            {/* Scope & Outcome Breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Game Scope Card */}
              <div
                data-testid="chess-scope-card"
                className="p-4 rounded-xl bg-(--surface-2) border border-(--border) space-y-3"
              >
                <h4 className="text-xs font-bold text-(--ink-1) flex items-center gap-1.5">
                  <Layers size={14} className="text-(--accent)" />
                  Phân bổ ván cờ theo khu vực
                </h4>
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="p-3 rounded-lg bg-(--surface) border border-(--border)">
                    <span className="text-[11px] text-(--ink-3) block">Bàn giảng bài chính (Main)</span>
                    <strong className="text-base font-bold text-(--ink-1)">{chess.scopeBreakdown.main}</strong>
                    <span className="text-[10px] text-(--ink-4) block mt-0.5">Ván đấu do giáo viên thị phạm</span>
                  </div>
                  <div className="p-3 rounded-lg bg-(--surface) border border-(--border)">
                    <span className="text-[11px] text-(--ink-3) block">Bàn luyện tập (Practice)</span>
                    <strong className="text-base font-bold text-(--ink-1)">{chess.scopeBreakdown.practice}</strong>
                    <span className="text-[10px] text-(--ink-4) block mt-0.5">Ván đấu ghép đôi học viên</span>
                  </div>
                </div>
              </div>

              {/* Outcome Distribution Card */}
              <div
                data-testid="chess-outcome-card"
                className="p-4 rounded-xl bg-(--surface-2) border border-(--border) space-y-3"
              >
                <h4 className="text-xs font-bold text-(--ink-1) flex items-center gap-1.5">
                  <TrendingUp size={14} className="text-(--accent)" />
                  Kết quả ván đấu (Chỉ tính ván hoàn thành)
                </h4>
                <div className="grid grid-cols-4 gap-2 pt-1 text-center">
                  <div className="p-2 rounded-lg bg-(--surface) border border-(--border)">
                    <span className="text-[10px] text-(--ink-3) block">Trắng thắng</span>
                    <strong className="text-xs font-bold text-(--ink-1)">{chess.resultBreakdown.whiteWins}</strong>
                  </div>
                  <div className="p-2 rounded-lg bg-(--surface) border border-(--border)">
                    <span className="text-[10px] text-(--ink-3) block">Đen thắng</span>
                    <strong className="text-xs font-bold text-(--ink-1)">{chess.resultBreakdown.blackWins}</strong>
                  </div>
                  <div className="p-2 rounded-lg bg-(--surface) border border-(--border)">
                    <span className="text-[10px] text-(--ink-3) block">Hòa</span>
                    <strong className="text-xs font-bold text-(--ink-1)">{chess.resultBreakdown.draws}</strong>
                  </div>
                  <div className="p-2 rounded-lg bg-(--surface) border border-(--border)">
                    <span className="text-[10px] text-(--ink-3) block">Chưa xong</span>
                    <strong className="text-xs font-bold text-(--ink-3)">
                      {chess.resultBreakdown.unfinishedOrUnknown}
                    </strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Move Statistics (Plies) */}
            <div
              data-testid="chess-move-stats-card"
              className="p-4 rounded-xl bg-(--surface-2) border border-(--border) space-y-2"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-(--ink-1)">Thống kê nước đi (Đơn vị: ply / nửa nước)</h4>
                <span className="text-[10px] text-(--ink-4)">1 lượt đi của Trắng hoặc Đen = 1 ply</span>
              </div>
              <div className="grid grid-cols-3 gap-3 pt-1 text-center">
                <div className="p-2.5 rounded-lg bg-(--surface) border border-(--border)">
                  <span className="text-[10px] text-(--ink-3) block">Tổng số plies</span>
                  <strong className="text-xs font-bold text-(--ink-1)">{chess.moveStats.totalMoves}</strong>
                </div>
                <div className="p-2.5 rounded-lg bg-(--surface) border border-(--border)">
                  <span className="text-[10px] text-(--ink-3) block">Trung bình / ván</span>
                  <strong className="text-xs font-bold text-(--ink-1)">
                    {chess.moveStats.averageMoves !== null ? `${chess.moveStats.averageMoves} plies` : 'N/A'}
                  </strong>
                </div>
                <div className="p-2.5 rounded-lg bg-(--surface) border border-(--border)">
                  <span className="text-[10px] text-(--ink-3) block">Dài nhất</span>
                  <strong className="text-xs font-bold text-(--ink-1)">
                    {chess.moveStats.maxMoves !== null ? `${chess.moveStats.maxMoves} plies` : 'N/A'}
                  </strong>
                </div>
              </div>
            </div>

            {/* Per-Board Breakdown List */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-(--ink-1)">Danh sách bàn cờ ({chess.byBoard.length})</h3>

              {chess.byBoard.length === 0 ? (
                <div
                  data-testid="chess-empty-state"
                  className="p-8 text-center rounded-xl bg-(--surface-2) border border-(--border) text-xs text-(--ink-3)"
                >
                  Chưa có ván cờ nào được ghi nhận trong buổi học này.
                </div>
              ) : (
                <div className="border border-(--border) rounded-xl overflow-hidden bg-(--surface)">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs" data-testid="boards-table">
                      <thead className="bg-(--surface-2) text-(--ink-3) font-semibold border-b border-(--border)">
                        <tr>
                          <th className="py-2.5 px-3">Bàn cờ</th>
                          <th className="py-2.5 px-3">Phân loại</th>
                          <th className="py-2.5 px-3">Tổng ván</th>
                          <th className="py-2.5 px-3">Hoàn thành</th>
                          <th className="py-2.5 px-3">Kết quả (Trắng/Đen/Hòa)</th>
                          <th className="py-2.5 px-3 text-right">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-(--border)">
                        {chess.byBoard.map((board) => (
                          <tr key={board.boardId} className="hover:bg-(--surface-2)/60 transition-colors">
                            <td className="py-2.5 px-3 font-semibold text-(--ink-1)">
                              {board.boardId === 'main' ? 'Bàn chính (Main)' : `Bàn luyện tập ${board.boardId}`}
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                  board.gameScope === 'MAIN'
                                    ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                                    : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                }`}
                              >
                                {board.gameScope === 'MAIN' ? 'CHÍNH' : 'LUYỆN TẬP'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-mono text-[11px] text-(--ink-2)">{board.totalGames}</td>
                            <td className="py-2.5 px-3 font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
                              {board.completedGames}
                            </td>
                            <td className="py-2.5 px-3 text-[11px] text-(--ink-3)">
                              T: {board.whiteWins} • Đ: {board.blackWins} • H: {board.draws}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                type="button"
                                data-testid={`replay-board-btn-${board.boardId}`}
                                onClick={() => {
                                  if (onOpenReplay) {
                                    onOpenReplay(board.boardId)
                                  } else {
                                    setReplayBoardId(board.boardId)
                                  }
                                }}
                                className="px-2.5 py-1 rounded-md bg-(--surface-2) hover:bg-(--surface-3) text-[11px] font-semibold text-(--ink-2) border border-(--border) transition-colors cursor-pointer inline-flex items-center gap-1"
                              >
                                <Eye size={12} />
                                <span>Xem lại</span>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Embedded Replay Modal (Fallback if onOpenReplay not provided) */}
      {replayBoardId && (
        <SessionGameReplayModal
          sessionId={sessionId}
          isOpen={Boolean(replayBoardId)}
          initialBoardId={replayBoardId}
          onClose={() => setReplayBoardId(null)}
          supabaseClient={supabaseClient}
        />
      )}
    </div>
  )
}
