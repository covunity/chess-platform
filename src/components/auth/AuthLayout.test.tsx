import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import AuthLayout from './AuthLayout'

function renderLayout(children = <div data-testid="form-content">form</div>) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AuthLayout>{children}</AuthLayout>
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('AuthLayout', () => {
  it('renders the brand panel headline text', () => {
    renderLayout()
    // The h1 has br elements so we check the brand section contains the expected text
    const brand = document.querySelector('.auth-brand')
    expect(brand?.textContent).toContain('Learn chess')
    expect(brand?.textContent).toContain('masters teach it.')
  })

  it('renders stats in the brand panel', () => {
    renderLayout()
    expect(screen.getByText('240+')).toBeInTheDocument()
    expect(screen.getByText('38')).toBeInTheDocument()
    expect(screen.getByText('12k')).toBeInTheDocument()
  })

  it('renders children in the form panel', () => {
    renderLayout()
    expect(screen.getByTestId('form-content')).toBeInTheDocument()
  })

  it('renders logo-mark', () => {
    renderLayout()
    expect(document.querySelector('.logo-mark')).toBeInTheDocument()
  })
})
