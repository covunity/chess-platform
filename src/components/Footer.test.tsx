import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Footer from './Footer'

function renderFooter() {
  return render(
    <MemoryRouter>
      <Footer />
    </MemoryRouter>
  )
}

describe('Footer', () => {
  it('renders footer element', () => {
    renderFooter()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
  })

  it('links to Terms page', () => {
    renderFooter()
    expect(screen.getByRole('link', { name: 'Điều khoản' })).toHaveAttribute('href', '/terms')
  })

  it('links to Privacy page', () => {
    renderFooter()
    expect(screen.getByRole('link', { name: 'Bảo mật' })).toHaveAttribute('href', '/privacy')
  })

  it('points "Become a creator" to /become-creator', () => {
    renderFooter()
    expect(screen.getByRole('link', { name: 'Trở thành creator' })).toHaveAttribute(
      'href',
      '/become-creator'
    )
  })
})
