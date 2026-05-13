import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import PayoutInfoForm from '../../components/payout/PayoutInfoForm'
import {
  EMPTY_PAYOUT_INPUT,
  getMyCreatorPayoutInfo,
  updateCreatorPayoutInfo,
  validatePayoutInput,
} from '../../lib/creatorPayoutInfoApi'
import type {
  PayoutInfoInput,
  PayoutValidationField,
} from '../../lib/creatorPayoutInfoApi'

const ERROR_I18N: Record<PayoutValidationField, string> = {
  bank_code: 'becomeCreator.payoutInfo.errors.bankCode',
  bank_name: 'becomeCreator.payoutInfo.errors.bankCode',
  account_number: 'becomeCreator.payoutInfo.errors.accountNumber',
  account_holder: 'becomeCreator.payoutInfo.errors.accountHolder',
  bank_branch: 'becomeCreator.payoutInfo.errors.bankBranch',
}

export default function PayoutSettingsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fields, setFields] = useState<PayoutInfoInput>(EMPTY_PAYOUT_INPUT)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    getMyCreatorPayoutInfo(supabase, user.id).then(({ payout, error: err }) => {
      if (cancelled) return
      if (err) {
        setError(t('creator.settings.payout.loadError'))
      } else if (payout) {
        setFields({
          bank_code: payout.bank_code,
          bank_name: payout.bank_name,
          account_number: payout.account_number,
          account_holder: payout.account_holder,
          bank_branch: payout.bank_branch,
        })
        setUpdatedAt(payout.updated_at)
      }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [user, t])

  async function handleSave() {
    setError(null)
    setSuccess(false)
    const validationField = validatePayoutInput(fields)
    if (validationField) {
      setError(t(ERROR_I18N[validationField]))
      return
    }

    setSaving(true)
    const { payout, error: rpcError } = await updateCreatorPayoutInfo(supabase, fields)
    setSaving(false)
    if (rpcError || !payout) {
      setError(t('creator.settings.payout.saveError'))
      return
    }
    setUpdatedAt(payout.updated_at)
    setSuccess(true)
  }

  if (loading) {
    return (
      <div
        data-testid="payout-settings-loading"
        aria-label="Loading"
        style={{ minHeight: 200 }}
      />
    )
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 32px' }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>
        {t('creator.settings.payout.eyebrow')}
      </div>
      <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 32, fontWeight: 400, color: 'var(--ink-1)', margin: 0, letterSpacing: '-0.02em' }}>
        {t('creator.settings.payout.heading')}
      </h1>
      <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6, marginTop: 12, maxWidth: 560 }}>
        {t('creator.settings.payout.intro')}
      </p>

      {updatedAt && (
        <p
          data-testid="payout-settings-saved-at"
          style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}
        >
          {t('creator.settings.payout.savedAt', {
            date: new Date(updatedAt).toLocaleString('vi-VN'),
          })}
        </p>
      )}

      <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <PayoutInfoForm value={fields} onChange={setFields} disabled={saving} />

        {error && (
          <div
            role="alert"
            data-testid="payout-settings-error"
            style={{ background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 'var(--r-md)', padding: '10px 14px', fontSize: 13 }}
          >
            {error}
          </div>
        )}

        {success && (
          <div
            role="status"
            data-testid="payout-settings-success"
            style={{ background: 'var(--success-soft)', color: 'var(--success)', borderRadius: 'var(--r-md)', padding: '10px 14px', fontSize: 13 }}
          >
            {t('creator.settings.payout.saveSuccess')}
          </div>
        )}

        <div>
          <button
            type="button"
            className="btn btn-accent"
            data-testid="payout-settings-save"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? t('creator.settings.payout.saving') : t('creator.settings.payout.saveBtn')}
          </button>
        </div>
      </div>
    </div>
  )
}
