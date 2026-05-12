import { Outlet } from 'react-router-dom'
import TopNav from '../TopNav'

export default function CreatorLayout() {
  return (
    <div className="min-h-screen flex flex-col bg-(--bg)">
      <TopNav hideSearch />
      <div className="flex-1 flex flex-col">
        <Outlet />
      </div>
    </div>
  )
}
