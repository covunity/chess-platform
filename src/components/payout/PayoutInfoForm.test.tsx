import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import PayoutInfoForm from './PayoutInfoForm'
import type { PayoutInfoInput } from '../../lib/creatorPayoutInfoApi'

const EMPTY: PayoutInfoInput = {
  bank_code: '',
  bank_name: '',
  account_number: '',
  account_holder: '',
  bank_branch: '',
}

function renderForm(value: PayoutInfoInput = EMPTY) {
  const onChange = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <PayoutInfoForm value={value} onChange={onChange} />
    </I18nextProvider>
  )
  return { onChange }
}

describe('PayoutInfoForm', () => {
  it('renders all four required fields with the section heading', () => {
    renderForm()
    expect(screen.getByText('Thông tin thanh toán')).toBeInTheDocument()
    expect(screen.getByTestId('payout-field-bank')).toBeInTheDocument()
    expect(screen.getByTestId('payout-field-account-number')).toBeInTheDocument()
    expect(screen.getByTestId('payout-field-account-holder')).toBeInTheDocument()
    expect(screen.getByTestId('payout-field-bank-branch')).toBeInTheDocument()
  })

  it('renders the seeded VN bank list as <option>s in the dropdown', () => {
    renderForm()
    const select = screen.getByTestId('payout-field-bank') as HTMLSelectElement
    const codes = Array.from(select.options).map(o => o.value)
    // Must include both a placeholder and well-known banks from src/data/vn-banks.json
    expect(codes).toContain('')
    expect(codes).toContain('VCB')
    expect(codes).toContain('MB')
    expect(codes.length).toBeGreaterThan(10)
  })

  it('selecting a bank emits onChange with both bank_code and bank_name', () => {
    const { onChange } = renderForm()
    const select = screen.getByTestId('payout-field-bank') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'VCB' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0] as PayoutInfoInput
    expect(next.bank_code).toBe('VCB')
    expect(next.bank_name).toContain('Vietcombank')
  })

  it('typing in account_number emits onChange with the new value', () => {
    const { onChange } = renderForm({ ...EMPTY, bank_code: 'VCB', bank_name: 'Vietcombank' })
    const input = screen.getByTestId('payout-field-account-number') as HTMLInputElement
    fireEvent.change(input, { target: { value: '0123456789' } })
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ account_number: '0123456789', bank_code: 'VCB' })
    )
  })

  it('typing in account_holder and bank_branch emits onChange', () => {
    const { onChange } = renderForm()
    fireEvent.change(screen.getByTestId('payout-field-account-holder'), {
      target: { value: 'NGUYEN VAN A' },
    })
    fireEvent.change(screen.getByTestId('payout-field-bank-branch'), {
      target: { value: 'Chi nhánh TP HCM' },
    })
    expect(onChange).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ account_holder: 'NGUYEN VAN A' })
    )
    expect(onChange).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ bank_branch: 'Chi nhánh TP HCM' })
    )
  })

  it('reflects controlled values from props', () => {
    renderForm({
      bank_code: 'MB',
      bank_name: 'MBBank',
      account_number: '0987654321',
      account_holder: 'TRAN B',
      bank_branch: 'Hà Đông',
    })
    expect((screen.getByTestId('payout-field-bank') as HTMLSelectElement).value).toBe('MB')
    expect((screen.getByTestId('payout-field-account-number') as HTMLInputElement).value).toBe('0987654321')
    expect((screen.getByTestId('payout-field-account-holder') as HTMLInputElement).value).toBe('TRAN B')
    expect((screen.getByTestId('payout-field-bank-branch') as HTMLInputElement).value).toBe('Hà Đông')
  })
})
