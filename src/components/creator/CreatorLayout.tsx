import { Outlet } from 'react-router-dom'
import TopNav from '../TopNav'

export default function CreatorLayout() {
  return (
    <div className="min-h-screen flex flex-col bg-(--bg)">
      <TopNav hideSearch />
      <div className="flex-1">
        <Outlet />
      </div>
    </div>
  )
}
