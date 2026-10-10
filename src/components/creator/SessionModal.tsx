import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Plus, Trash2, Calendar, Clock, BookOpen, AlertCircle, Loader2 } from 'lucide-react'
import {
  type LiveSession,
  type LiveSessionStatus,
  type LiveSessionAgendaItem,
  type CreateLiveSessionInput,
  type UpdateLiveSessionInput,
} from '../../types/liveSession'
import type { Chapter } from '../../lib/creatorApi'

interface SessionModalProps {
  courseId: string
  chapters: Chapter[]
  sessionToEdit?: LiveSession | null
  sessionNumber?: number
  onClose: () => void
  onSave: (input: CreateLiveSessionInput | UpdateLiveSessionInput) => Promise<void>
}

import {
  isoToDatetimeLocalString,
  datetimeLocalToIsoString,
  getDefaultTomorrowStart,
  getDefaultEndFromStart,
  resolveSessionTimezone,
  isValidTimezone,
} from '../../lib/liveSessionTime'

export default function SessionModal({
  courseId,
  chapters,
  sessionToEdit,
  sessionNumber = 1,
  onClose,
  onSave,
}: SessionModalProps) {
  const { t } = useTranslation()
  const isEditing = Boolean(sessionToEdit)
  const isReadOnly = sessionToEdit?.status === 'ENDED' || sessionToEdit?.status === 'CANCELLED'
  const isLive = sessionToEdit?.status === 'LIVE'

  const [title, setTitle] = useState(
    sessionToEdit?.title || `Buổi ${sessionNumber}: `
  )
  const [description, setDescription] = useState(sessionToEdit?.description || '')
  const initialTimezone = resolveSessionTimezone(sessionToEdit?.timezone)
  const [timezone, setTimezone] = useState(initialTimezone)

  // Track underlying UTC instants for timezone projection
  const [currentStartUtc, setCurrentStartUtc] = useState<string | null>(
    sessionToEdit?.scheduledStartAt || null
  )
  const [currentEndUtc, setCurrentEndUtc] = useState<string | null>(
    sessionToEdit?.scheduledEndAt || null
  )

  const [startInput, setStartInput] = useState(
    isoToDatetimeLocalString(sessionToEdit?.scheduledStartAt, initialTimezone) || getDefaultTomorrowStart(initialTimezone)
  )
  const [endInput, setEndInput] = useState(
    isoToDatetimeLocalString(sessionToEdit?.scheduledEndAt, initialTimezone) ||
      getDefaultEndFromStart(isoToDatetimeLocalString(sessionToEdit?.scheduledStartAt, initialTimezone) || getDefaultTomorrowStart(initialTimezone), 90)
  )

  // Timezone change preserves underlying UTC instant in edit mode and re-projects wall-clock inputs
  const handleTimezoneChange = (newTz: string) => {
    setTimezone(newTz)
    if (!isValidTimezone(newTz)) return

    // In edit mode (persisted session exists), re-project wall-clock inputs without shifting the instant
    if (isEditing && currentStartUtc) {
      setStartInput(isoToDatetimeLocalString(currentStartUtc, newTz))
      if (currentEndUtc) {
        setEndInput(isoToDatetimeLocalString(currentEndUtc, newTz))
      }
    }
    // In new session mode, changing timezone changes interpretation of wall-clock input on submit
  }

  // Explicit user edit to start wall-clock datetime updates the underlying UTC instant in edit mode
  const handleStartInputChange = (val: string) => {
    setStartInput(val)
    if (!val) {
      setCurrentStartUtc(null)
      return
    }
    if (isEditing) {
      const resolvedTz = resolveSessionTimezone(timezone)
      const newUtc = datetimeLocalToIsoString(val, resolvedTz)
      setCurrentStartUtc(newUtc || null)
    }

    if (!endInput || endInput <= val) {
      const defaultEndLocal = getDefaultEndFromStart(val, 90)
      setEndInput(defaultEndLocal)
      if (isEditing) {
        const resolvedTz = resolveSessionTimezone(timezone)
        const newEndUtc = datetimeLocalToIsoString(defaultEndLocal, resolvedTz)
        setCurrentEndUtc(newEndUtc || null)
      }
    }
  }

  // Explicit user edit to end wall-clock datetime updates the underlying UTC instant in edit mode
  const handleEndInputChange = (val: string) => {
    setEndInput(val)
    if (!val) {
      setCurrentEndUtc(null)
      return
    }
    if (isEditing) {
      const resolvedTz = resolveSessionTimezone(timezone)
      const newEndUtc = datetimeLocalToIsoString(val, resolvedTz)
      setCurrentEndUtc(newEndUtc || null)
    }
  }
  const [createStatus, setCreateStatus] = useState<'DRAFT' | 'SCHEDULED'>('SCHEDULED')
  const [lessonId, setLessonId] = useState<string>(sessionToEdit?.lessonId || '')
  const [maxParticipants, setMaxParticipants] = useState<string>(
    sessionToEdit?.maxParticipants ? String(sessionToEdit.maxParticipants) : ''
  )
  const [preparationNotes, setPreparationNotes] = useState(sessionToEdit?.preparationNotes || '')

  // Structured learning objectives
  const [learningObjectives, setLearningObjectives] = useState<string[]>(
    sessionToEdit?.learningObjectives && sessionToEdit.learningObjectives.length > 0
      ? sessionToEdit.learningObjectives
      : ['']
  )

  // Structured agenda items
  const [agenda, setAgenda] = useState<LiveSessionAgendaItem[]>(
    sessionToEdit?.agenda && sessionToEdit.agenda.length > 0
      ? sessionToEdit.agenda
      : [
          { title: 'Khởi động & Ôn bài', duration_minutes: 15 },
          { title: 'Bài giảng lý thuyết', duration_minutes: 35 },
          { title: 'Thực hành đấu 1v1', duration_minutes: 30 },
          { title: 'Tổng kết & Giải đáp', duration_minutes: 10 },
        ]
  )

  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Helper to flatten lessons for selection
  const allLessons = chapters.flatMap((c) =>
    (c.lessons || []).map((l) => ({
      id: l.id,
      title: `${c.title} — ${l.title}`,
    }))
  )

  const handleAddObjective = () => {
    setLearningObjectives([...learningObjectives, ''])
  }

  const handleRemoveObjective = (index: number) => {
    setLearningObjectives(learningObjectives.filter((_, i) => i !== index))
  }

  const handleObjectiveChange = (index: number, val: string) => {
    const next = [...learningObjectives]
    next[index] = val
    setLearningObjectives(next)
  }

  const handleAddAgendaItem = () => {
    setAgenda([...agenda, { title: '', duration_minutes: 15 }])
  }

  const handleRemoveAgendaItem = (index: number) => {
    setAgenda(agenda.filter((_, i) => i !== index))
  }

  const handleAgendaChange = (
    index: number,
    field: 'title' | 'duration_minutes',
    val: string | number
  ) => {
    const next = [...agenda]
    if (field === 'duration_minutes') {
      next[index] = { ...next[index], duration_minutes: Number(val) || 0 }
    } else {
      next[index] = { ...next[index], title: String(val) }
    }
    setAgenda(next)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isReadOnly) {
      onClose()
      return
    }
    setError(null)

    if (!title.trim()) {
      setError('Vui lòng nhập tiêu đề buổi học')
      return
    }

    if (!startInput) {
      setError('Vui lòng chọn thời gian bắt đầu buổi học')
      return
    }

    const resolvedTz = resolveSessionTimezone(timezone)
    const startIso = isEditing
      ? (currentStartUtc || datetimeLocalToIsoString(startInput, resolvedTz))
      : datetimeLocalToIsoString(startInput, resolvedTz)
    if (!startIso) {
      setError('Thời gian bắt đầu không hợp lệ')
      return
    }

    let endIso: string | null = null
    if (endInput) {
      endIso = isEditing
        ? (currentEndUtc || datetimeLocalToIsoString(endInput, resolvedTz))
        : datetimeLocalToIsoString(endInput, resolvedTz)
      if (!endIso) {
        setError('Thời gian kết thúc không hợp lệ')
        return
      }
      if (new Date(endIso) <= new Date(startIso)) {
        setError('Thời gian kết thúc phải sau thời gian bắt đầu')
        return
      }
    }

    let parsedMax: number | null = null
    if (maxParticipants.trim()) {
      parsedMax = parseInt(maxParticipants.trim(), 10)
      if (isNaN(parsedMax) || parsedMax <= 0) {
        setError('Số học viên tối đa phải là số nguyên dương')
        return
      }
    }

    // Clean objectives
    const cleanObjectives = learningObjectives.map((o) => o.trim()).filter(Boolean)

    // Clean agenda
    const cleanAgenda = agenda
      .map((a) => ({
        title: a.title.trim(),
        duration_minutes: Math.max(1, a.duration_minutes),
      }))
      .filter((a) => Boolean(a.title))

    setSaving(true)
    try {
      if (isEditing) {
        const updateInput: UpdateLiveSessionInput = {
          title: title.trim(),
          description: description.trim() || null,
          timezone: resolvedTz,
          agenda: cleanAgenda,
          learningObjectives: cleanObjectives,
          preparationNotes: preparationNotes.trim() || null,
          maxParticipants: parsedMax,
          ...(!isLive && {
            scheduledStartAt: startIso,
            scheduledEndAt: endIso,
            lessonId: lessonId || null,
          }),
        }
        await onSave(updateInput)
      } else {
        const createInput: CreateLiveSessionInput = {
          courseId,
          title: title.trim(),
          description: description.trim() || null,
          scheduledStartAt: startIso,
          scheduledEndAt: endIso,
          timezone: resolvedTz,
          status: createStatus,
          lessonId: lessonId || null,
          agenda: cleanAgenda,
          learningObjectives: cleanObjectives,
          preparationNotes: preparationNotes.trim() || null,
          maxParticipants: parsedMax,
        }
        await onSave(createInput)
      }
      onClose()
    } catch (err: unknown) {
      console.error('Session save error:', err)
      setError(err instanceof Error ? err.message : 'Lỗi lưu thông tin buổi học')
    } finally {
      setSaving(false)
    }
  }

  // Calculate total agenda duration
  const totalAgendaMinutes = agenda.reduce((sum, item) => sum + (Number(item.duration_minutes) || 0), 0)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-(--surface) border border-(--border) rounded-(--r-lg) shadow-xl w-full max-w-2xl my-8 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-(--border) flex items-center justify-between shrink-0 bg-(--surface-2)">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <h2 className="text-base font-bold text-(--ink-1)">
              {isReadOnly
                ? 'Thông tin buổi học'
                : isEditing
                ? 'Chỉnh sửa buổi học trực tuyến'
                : 'Tạo buổi học trực tuyến mới'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-(--ink-3) hover:text-(--ink-1) hover:bg-(--surface) transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 flex flex-col gap-5 text-xs sm:text-sm">
          {error && (
            <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 flex items-center gap-2 text-xs">
              <AlertCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-(--ink-1) mb-1.5">
              Tiêu đề buổi học <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              maxLength={200}
              disabled={isReadOnly}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="VD: Buổi 1: Khai cuộc & Nguyên tắc phát triển quân"
              className="w-full px-3 py-2 rounded-md bg-(--bg) border border-(--border) text-(--ink-1) focus:outline-hidden focus:border-(--accent) text-xs sm:text-sm disabled:opacity-60"
            />
          </div>

          {/* Start and End Times */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-(--ink-1) mb-1.5 flex items-center gap-1.5">
                <Calendar size={13} className="text-(--accent)" />
                <span>Thời gian bắt đầu</span> <span className="text-red-500">*</span>
                {isLive && <span className="text-[11px] text-(--ink-3) font-normal">(Cố định khi LIVE)</span>}
              </label>
              <input
                type="datetime-local"
                required
                disabled={isReadOnly || isLive}
                value={startInput}
                onChange={(e) => handleStartInputChange(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-(--bg) border border-(--border) text-(--ink-1) focus:outline-hidden focus:border-(--accent) text-xs disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-(--ink-1) mb-1.5 flex items-center gap-1.5">
                <Clock size={13} className="text-(--ink-3)" />
                <span>Thời gian kết thúc (dự kiến)</span>
                {isLive && <span className="text-[11px] text-(--ink-3) font-normal">(Cố định khi LIVE)</span>}
              </label>
              <input
                type="datetime-local"
                disabled={isReadOnly || isLive}
                value={endInput}
                onChange={(e) => handleEndInputChange(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-(--bg) border border-(--border) text-(--ink-1) focus:outline-hidden focus:border-(--accent) text-xs disabled:opacity-60"
              />
            </div>
          </div>

          {/* Status & Linked Lesson */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="session-create-status" className="block text-xs font-semibold text-(--ink-1) mb-1.5">
                {isEditing ? 'Trạng thái buổi học' : 'Trạng thái khởi tạo'}
              </label>
              {isEditing ? (
                <div className="py-1">
                  {sessionToEdit?.status === 'LIVE' && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-red-500/15 border border-red-500/30 text-red-600 dark:text-red-400">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      ĐANG DIỄN RA (LIVE)
                    </span>
                  )}
                  {sessionToEdit?.status === 'SCHEDULED' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400">
                      <Clock size={12} /> SẮP DIỄN RA (SCHEDULED)
                    </span>
                  )}
                  {sessionToEdit?.status === 'DRAFT' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400">
                      BẢN NHÁP (DRAFT)
                    </span>
                  )}
                  {sessionToEdit?.status === 'ENDED' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-500/10 border border-gray-500/20 text-(--ink-3)">
                      ĐÃ KẾT THÚC (ENDED)
                    </span>
                  )}
                  {sessionToEdit?.status === 'CANCELLED' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-500 line-through">
                      ĐÃ HỦY (CANCELLED)
                    </span>
                  )}
                </div>
              ) : (
                <select
                  id="session-create-status"
                  value={createStatus}
                  onChange={(e) => setCreateStatus(e.target.value as 'SCHEDULED' | 'DRAFT')}
                  className="w-full px-3 py-2 rounded-md bg-(--bg) border border-(--border) text-(--ink-1) focus:outline-hidden focus:border-(--accent) text-xs"
                >
                  <option value="SCHEDULED">📅 Đã lên lịch (SCHEDULED)</option>
                  <option value="DRAFT">📝 Bản nháp (DRAFT)</option>
                </select>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-(--ink-1) mb-1.5 flex items-center gap-1.5">
                <BookOpen size={13} className="text-(--accent)" />
                <span>Liên kết giáo trình / bài học (tùy chọn)</span>
                {isLive && <span className="text-[11px] text-(--ink-3) font-normal">(Cố định khi LIVE)</span>}
              </label>
              <select
                disabled={isReadOnly || isLive}
                value={lessonId}
                onChange={(e) => setLessonId(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-(--bg) border border-(--border) text-(--ink-1) focus:outline-hidden focus:border-(--accent) text-xs disabled:opacity-60"
              >
                <option value="">(Không liên kết bài học tĩnh)</option>
                {allLessons.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Max Participants & Timezone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-(--ink-1) mb-1.5">
                Số học viên tối đa (tùy chọn)
              </label>
              <input
                type="number"
                min={1}
                max={500}
                placeholder="VD: 30"
                value={maxParticipants}
                onChange={(e) => setMaxParticipants(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-(--bg) border border-(--border) text-(--ink-1) focus:outline-hidden focus:border-(--accent) text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-(--ink-1) mb-1.5">
                Múi giờ
              </label>
              <input
                type="text"
                value={timezone}
                onChange={(e) => handleTimezoneChange(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-(--bg) border border-(--border) text-(--ink-1) focus:outline-hidden focus:border-(--accent) text-xs font-mono"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-(--ink-1) mb-1.5">
              Mô tả ngắn về buổi học
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Giới thiệu nội dung trọng tâm và hình thức giảng dạy của buổi học này..."
              className="w-full px-3 py-2 rounded-md bg-(--bg) border border-(--border) text-(--ink-1) focus:outline-hidden focus:border-(--accent) text-xs"
            />
          </div>

          {/* Agenda Section */}
          <div className="p-3.5 rounded-md bg-(--surface-2) border border-(--border) flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-semibold text-xs text-(--ink-1)">Lịch trình chi tiết (Agenda)</span>
                <span className="text-xs text-(--ink-3) ml-2">Tổng: {totalAgendaMinutes} phút</span>
              </div>
              <button
                type="button"
                onClick={handleAddAgendaItem}
                className="text-xs font-medium text-(--accent) hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Plus size={13} /> Thêm mục
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {agenda.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="w-5 text-center text-xs font-mono text-(--ink-3)">{idx + 1}.</span>
                  <input
                    type="text"
                    placeholder="Tên phần học (VD: Khai cuộc)"
                    value={item.title}
                    onChange={(e) => handleAgendaChange(idx, 'title', e.target.value)}
                    className="flex-1 px-2.5 py-1.5 rounded-md bg-(--bg) border border-(--border) text-(--ink-1) text-xs focus:border-(--accent) focus:outline-hidden"
                  />
                  <div className="flex items-center gap-1 shrink-0">
                    <input
                      type="number"
                      min={1}
                      max={300}
                      value={item.duration_minutes}
                      onChange={(e) => handleAgendaChange(idx, 'duration_minutes', e.target.value)}
                      className="w-16 px-2 py-1.5 rounded-md bg-(--bg) border border-(--border) text-(--ink-1) text-xs text-right focus:border-(--accent) focus:outline-hidden"
                    />
                    <span className="text-xs text-(--ink-3)">phút</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveAgendaItem(idx)}
                    disabled={agenda.length <= 1}
                    className="p-1 rounded text-(--ink-3) hover:text-red-500 disabled:opacity-30 cursor-pointer"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Learning Objectives */}
          <div className="p-3.5 rounded-md bg-(--surface-2) border border-(--border) flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-xs text-(--ink-1)">Mục tiêu đạt được (Learning Objectives)</span>
              <button
                type="button"
                onClick={handleAddObjective}
                className="text-xs font-medium text-(--accent) hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Plus size={13} /> Thêm mục tiêu
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {learningObjectives.map((obj, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="w-5 text-center text-xs text-(--ink-3)">•</span>
                  <input
                    type="text"
                    placeholder="VD: Nắm vững 3 nguyên tắc mở cờ căn bản"
                    value={obj}
                    onChange={(e) => handleObjectiveChange(idx, e.target.value)}
                    className="flex-1 px-2.5 py-1.5 rounded-md bg-(--bg) border border-(--border) text-(--ink-1) text-xs focus:border-(--accent) focus:outline-hidden"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveObjective(idx)}
                    disabled={learningObjectives.length <= 1}
                    className="p-1 rounded text-(--ink-3) hover:text-red-500 disabled:opacity-30 cursor-pointer"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Preparation Notes */}
          <div>
            <label className="block text-xs font-semibold text-(--ink-1) mb-1.5">
              Chuẩn bị trước buổi học (Preparation Notes)
            </label>
            <textarea
              rows={2}
              disabled={isReadOnly}
              value={preparationNotes}
              onChange={(e) => setPreparationNotes(e.target.value)}
              placeholder="VD: Xem lại Lesson 2 và chuẩn bị sẵn tai nghe mic để phát biểu."
              className="w-full px-3 py-2 rounded-md bg-(--bg) border border-(--border) text-(--ink-1) focus:outline-hidden focus:border-(--accent) text-xs disabled:opacity-60"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-(--border) shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-md border border-(--border) text-(--ink-2) hover:bg-(--surface-2) transition-colors text-xs font-semibold cursor-pointer"
            >
              {isReadOnly ? 'Đóng' : 'Hủy'}
            </button>
            {!isReadOnly && (
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-md bg-(--accent) text-white font-semibold hover:opacity-90 transition-opacity text-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                <span>{isEditing ? 'Lưu thay đổi' : 'Tạo buổi học'}</span>
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
