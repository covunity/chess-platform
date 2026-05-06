import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="border-t border-(--border) bg-(--surface-2) py-6 px-14">
      <div className="max-w-[1280px] mx-auto flex flex-wrap items-center gap-6 text-[13px] text-(--ink-3)">
        <span className="font-serif text-(--ink-1)">Gambitly</span>
        <Link to="#">Become a creator</Link>
        <Link to="#">Help center</Link>
        <Link to="/terms">Terms</Link>
        <Link to="/privacy">Privacy</Link>
        <span className="ml-auto">EN / VI</span>
      </div>
    </footer>
  )
}
