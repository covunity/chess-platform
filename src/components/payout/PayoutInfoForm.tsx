import { useTranslation } from 'react-i18next'
import vnBanksRaw from '../../data/vn-banks.json'
import type { PayoutInfoInput } from '../../lib/creatorPayoutInfoApi'

interface VnBank {
  bank_code: string
  bank_name: string
  short_name: string
  bin: string
}

const VN_BANKS: VnBank[] = vnBanksRaw as VnBank[]

interface Props {
  value: PayoutInfoInput
  onChange: (next: PayoutInfoInput) => void
  disabled?: boolean
}

export default function PayoutInfoForm({ value, onChange, disabled }: Props) {
  const { t } = useTranslation()

  function update(partial: Partial<PayoutInfoInput>) {
    onChange({ ...value, ...partial })
  }

  function handleBankChange(code: string) {
    const bank = VN_BANKS.find(b => b.bank_code === code)
    update({
      bank_code: code,
      bank_name: bank ? `${bank.short_name} — ${bank.bank_name}` : '',
    })
  }

  return (
    <div
      data-testid="payout-info-form"
      style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      <div>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', margin: 0 }}>
          {t('becomeCreator.payoutInfo.section')}
        </p>
        <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '4px 0 0', lineHeight: 1.5 }}>
          {t('becomeCreator.payoutInfo.sectionHint')}
        </p>
      </div>

      <Field label={t('becomeCreator.payoutInfo.bankLabel')} required>
        <select
          data-testid="payout-field-bank"
          className="input"
          value={value.bank_code}
          onChange={e => handleBankChange(e.target.value)}
          disabled={disabled}
        >
          <option value="">{t('becomeCreator.payoutInfo.bankPlaceholder')}</option>
          {VN_BANKS.map(b => (
            <option key={b.bank_code} value={b.bank_code}>
              {b.short_name} — {b.bank_name}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label={t('becomeCreator.payoutInfo.accountNumberLabel')}
        hint={t('becomeCreator.payoutInfo.accountNumberHint')}
        required
      >
        <input
          data-testid="payout-field-account-number"
          className="input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={value.account_number}
          onChange={e => update({ account_number: e.target.value.replace(/\s+/g, '') })}
          disabled={disabled}
        />
      </Field>

      <Field
        label={t('becomeCreator.payoutInfo.accountHolderLabel')}
        hint={t('becomeCreator.payoutInfo.accountHolderHint')}
        required
      >
        <input
          data-testid="payout-field-account-holder"
          className="input"
          type="text"
          autoComplete="off"
          value={value.account_holder}
          onChange={e => update({ account_holder: e.target.value })}
          disabled={disabled}
        />
      </Field>

      <Field label={t('becomeCreator.payoutInfo.bankBranchLabel')} required>
        <input
          data-testid="payout-field-bank-branch"
          className="input"
          type="text"
          autoComplete="off"
          value={value.bank_branch}
          onChange={e => update({ bank_branch: e.target.value })}
          disabled={disabled}
        />
      </Field>
    </div>
  )
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="label" style={{ marginBottom: 0 }}>
        {label}
        {required && <span aria-hidden="true" style={{ color: 'var(--danger)', marginLeft: 4 }}>*</span>}
      </span>
      {children}
      {hint && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{hint}</span>}
    </div>
  )
}

