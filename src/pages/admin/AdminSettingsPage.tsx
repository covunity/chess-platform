import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { getBankConfig, updateBankConfig } from '../../lib/configApi'
import type { BankConfig } from '../../lib/configApi'
import { buildVietQRUrl } from '../../lib/vietqr'

type Tab = 'payment'
const TABS: Tab[] = ['payment']

const BIN_REGEX = /^\d{6}$/

interface FormState {
  short_name: string
  bin: string
  account_number: string
  account_name: string
}

const EMPTY_FORM: FormState = {
  short_name: '',
  bin: '',
  account_number: '',
  account_name: '',
}

function bankToForm(bank: BankConfig | null): FormState {
  if (!bank) return EMPTY_FORM
  return {
    short_name:     bank.short_name     ?? '',
    bin:            bank.bin            ?? '',
    account_number: bank.account_number ?? '',
    account_name:   bank.account_name   ?? '',
  }
}

export default function AdminSettingsPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('payment')
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [binError, setBinError] = useState<string | null>(null)
  const [toast, setToast] = useState<'success' | 'error' | null>(null)

  async function loadConfig() {
    setLoading(true)
    const { bank } = await getBankConfig(supabase)
    setForm(bankToForm(bank))
    setLoading(false)
  }

  useEffect(() => {
    getBankConfig(supabase).then(({ bank }) => {
      setForm(bankToForm(bank))
      setLoading(false)
    })
  }, [])

  const previewUrl = useMemo(() => {
    if (!form.short_name.trim() || !form.account_number.trim()) return null
    try {
      return buildVietQRUrl({
        shortName: form.short_name.trim(),
        accountNumber: form.account_number.trim(),
        accountName: form.account_name.trim() || ' ',
        amount: 10000,
        addInfo: 'PREVIEW',
      })
    } catch {
      return null
    }
  }, [form.short_name, form.account_number, form.account_name])

  function setField<K extends keyof FormState>(key: K, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
    if (key === 'bin') setBinError(null)
  }

  async function handleSave() {
    setBinError(null)
    if (!BIN_REGEX.test(form.bin)) {
      setBinError(t('admin.settings.payment.validation.binFormat'))
      return
    }
    setSaving(true)
    const { error } = await updateBankConfig(supabase, {
      short_name:     form.short_name.trim(),
      bin:            form.bin,
      account_number: form.account_number.trim(),
      account_name:   form.account_name.trim(),
    })
    setSaving(false)
    if (error) {
      setToast('error')
      return
    }
    setToast('success')
    await loadConfig()
  }

  // Auto-dismiss toast after 3s
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(id)
  }, [toast])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center px-6 border-b border-(--border) bg-(--surface) shrink-0"
        style={{ height: 60 }}
      >
        <h1 className="text-lg font-semibold tracking-tight text-(--ink-1)" style={{ letterSpacing: '-0.01em' }}>
          {t('admin.settings.title')}
        </h1>
      </div>

      {/* Tabs row */}
      <div className="px-6 pt-4">
        <div role="tablist" className="flex items-center gap-1">
          {TABS.map(s => (
            <button
              key={s}
              role="tab"
              type="button"
              data-testid={`settings-tab-${s}`}
              aria-selected={tab === s}
              onClick={() => setTab(s)}
              className="btn btn-sm"
              style={{
                background: tab === s ? 'var(--ink-1)' : 'transparent',
                color: tab === s ? 'var(--ink-on-accent)' : 'var(--ink-2)',
                border: '1px solid var(--border)',
              }}
            >
              {t(`admin.settings.${s}.tabLabel`)}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 p-6 overflow-auto">
        {tab === 'payment' && (
          <div className="card" style={{ padding: 24, maxWidth: 720 }}>
            <h2 className="text-base font-semibold text-(--ink-1) mb-4">
              {t('admin.settings.payment.cardTitle')}
            </h2>

            {loading ? (
              <div className="text-(--ink-3) text-sm">…</div>
            ) : (
              <div className="grid gap-4">
                <div>
                  <label className="label mb-1" htmlFor="bank-short-name">
                    {t('admin.settings.payment.bankShortName')}
                  </label>
                  <input
                    id="bank-short-name"
                    data-testid="input-short-name"
                    className="input w-full"
                    type="text"
                    value={form.short_name}
                    onChange={e => setField('short_name', e.target.value)}
                  />
                </div>

                <div>
                  <label className="label mb-1" htmlFor="bank-bin">
                    {t('admin.settings.payment.bin')}
                  </label>
                  <input
                    id="bank-bin"
                    data-testid="input-bin"
                    className="input w-full"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={form.bin}
                    onChange={e => setField('bin', e.target.value)}
                    aria-invalid={binError !== null}
                  />
                  {binError && (
                    <p
                      data-testid="bin-validation-error"
                      role="alert"
                      className="text-(--danger)"
                      style={{ fontSize: 12, marginTop: 6 }}
                    >
                      {binError}
                    </p>
                  )}
                </div>

                <div>
                  <label className="label mb-1" htmlFor="bank-account-number">
                    {t('admin.settings.payment.accountNumber')}
                  </label>
                  <input
                    id="bank-account-number"
                    data-testid="input-account-number"
                    className="input w-full"
                    type="text"
                    value={form.account_number}
                    onChange={e => setField('account_number', e.target.value)}
                  />
                </div>

                <div>
                  <label className="label mb-1" htmlFor="bank-account-name">
                    {t('admin.settings.payment.accountName')}
                  </label>
                  <input
                    id="bank-account-name"
                    data-testid="input-account-name"
                    className="input w-full"
                    type="text"
                    value={form.account_name}
                    onChange={e => setField('account_name', e.target.value)}
                  />
                </div>

                <div
                  className="flex items-start gap-4 mt-2"
                  style={{
                    background: 'var(--surface-2)',
                    borderRadius: 'var(--r-md)',
                    padding: 16,
                  }}
                >
                  <div>
                    <p className="text-(--ink-2)" style={{ fontSize: 12, marginBottom: 8 }}>
                      {t('admin.settings.payment.preview')}
                    </p>
                    {previewUrl ? (
                      <img
                        data-testid="vietqr-preview"
                        src={previewUrl}
                        alt={t('admin.settings.payment.preview')}
                        width={180}
                        height={180}
                        style={{ width: 180, height: 180, background: '#fff', borderRadius: 'var(--r-sm)' }}
                      />
                    ) : (
                      <div
                        data-testid="vietqr-preview-empty"
                        className="text-(--ink-3)"
                        style={{ width: 180, height: 180, display: 'grid', placeItems: 'center', fontSize: 12 }}
                      >
                        —
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end mt-2">
                  <button
                    type="button"
                    className="btn btn-primary"
                    data-testid="save-button"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {t('admin.settings.payment.save')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Toasts */}
      {toast === 'success' && (
        <div
          data-testid="save-success-toast"
          className="toast toast-success"
        >
          {t('admin.settings.payment.saved')}
        </div>
      )}
      {toast === 'error' && (
        <div
          data-testid="save-error-toast"
          className="toast toast-error"
        >
          {t('admin.settings.payment.saveError')}
        </div>
      )}
    </div>
  )
}
