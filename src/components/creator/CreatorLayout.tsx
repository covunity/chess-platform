import { Outlet } from 'react-router-dom'

export default function CreatorLayout() {
  return (
    <div className="min-h-screen flex flex-col bg-(--bg)">
      <div className="flex-1">
        <Outlet />
      </div>
    </div>
  )
}
