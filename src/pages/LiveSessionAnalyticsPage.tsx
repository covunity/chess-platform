import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import LiveSessionAnalyticsView from '../components/LiveClassroom/Analytics/LiveSessionAnalyticsView'

export default function LiveSessionAnalyticsPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()

  if (!sessionId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center text-xs text-(--ink-3)">
        Không tìm thấy mã buổi học (Session ID).
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-(--bg) p-4 sm:p-6 lg:p-8 flex flex-col">
      <div className="max-w-6xl w-full mx-auto flex-1 flex flex-col">
        <div className="mb-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-(--surface) hover:bg-(--surface-2) text-xs font-semibold text-(--ink-2) border border-(--border) transition-colors cursor-pointer"
          >
            <ArrowLeft size={14} />
            <span>Quay lại</span>
          </button>
        </div>

        <div className="flex-1 flex flex-col">
          <LiveSessionAnalyticsView
            sessionId={sessionId}
            className="flex-1"
          />
        </div>
      </div>
    </div>
  )
}
