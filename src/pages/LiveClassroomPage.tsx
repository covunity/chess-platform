import { useParams } from 'react-router-dom'
import LiveClassroomView from '../components/LiveClassroom/LiveClassroomView'

export default function LiveClassroomPage() {
  const { roomId, sessionId } = useParams<{ roomId?: string; sessionId?: string }>()
  const targetId = sessionId || roomId || 'main-classroom'

  return (
    <div className="w-full">
      <LiveClassroomView key={targetId} roomId={targetId} />
    </div>
  )
}
