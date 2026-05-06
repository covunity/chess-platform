import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import CheckEmailPage from './CheckEmailPage'

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <CheckEmailPage />
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('CheckEmailPage', () => {
  it('renders the heading', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /kiểm tra email/i })).toBeInTheDocument()
  })

  it('shows the verification body text', () => {
    renderPage()
    expect(screen.getByText(/email xác minh/i)).toBeInTheDocument()
  })

  it('has a link back to signup', () => {
    renderPage()
    expect(screen.getByRole('link', { name: /quay lại đăng ký/i })).toHaveAttribute('href', '/signup')
  })

  it('has a data-testid for routing tests', () => {
    renderPage()
    expect(screen.getByTestId('check-email-page')).toBeInTheDocument()
  })
})
