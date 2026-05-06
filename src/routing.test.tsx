import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  )
}

describe('routing', () => {
  it('renders homepage at /', () => {
    renderAt('/')
    expect(screen.getByRole('banner')).toBeInTheDocument()
  })

  it('renders /terms page', () => {
    renderAt('/terms')
    expect(screen.getByTestId('terms-page')).toBeInTheDocument()
  })

  it('renders /privacy page', () => {
    renderAt('/privacy')
    expect(screen.getByTestId('privacy-page')).toBeInTheDocument()
  })

  it('renders 404 for unknown routes', () => {
    renderAt('/this-does-not-exist')
    expect(screen.getByTestId('not-found-page')).toBeInTheDocument()
  })
})
