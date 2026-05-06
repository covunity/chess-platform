import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import TopNav from './TopNav'

function renderNav() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <TopNav />
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('TopNav', () => {
  it('renders a banner landmark', () => {
    renderNav()
    expect(screen.getByRole('banner')).toBeInTheDocument()
  })

  it('renders Gambitly brand name', () => {
    renderNav()
    expect(screen.getByText('Gambitly')).toBeInTheDocument()
  })

  it('has a link to the homepage', () => {
    renderNav()
    expect(screen.getByRole('link', { name: /gambitly home/i })).toHaveAttribute('href', '/')
  })
})
