import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <main data-testid="not-found-page" className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <h1 className="font-serif italic text-4xl text-[--ink-1] mb-4">
        Looks like this position isn't on the board.
      </h1>
      <p className="text-[--ink-3] mb-8">Trang bạn tìm kiếm không tồn tại.</p>
      <Link to="/" className="btn btn-accent">Về trang chủ</Link>
    </main>
  )
}
