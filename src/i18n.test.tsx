import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from './i18n'

function Probe() {
  return <div data-testid="nav-title">{i18n.t('nav.title')}</div>
}

describe('i18n', () => {
  it('provides Vietnamese translations for nav.title', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <Probe />
      </I18nextProvider>
    )
    expect(screen.getByTestId('nav-title').textContent).not.toBe('nav.title')
  })

  it('has the same keys in en.json as vi.json', async () => {
    const vi = await import('./locales/vi.json')
    const en = await import('./locales/en.json')
    expect(Object.keys(en.default)).toEqual(Object.keys(vi.default))
  })
})
