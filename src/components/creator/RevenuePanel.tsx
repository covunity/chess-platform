import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import {
  fetchCreatorWallet,
  fetchRecentEarnings,
  fetchPayoutHistory,
  type CreatorWallet,
  type RecentEarning,
  type PayoutHistoryEntry,
} from '../../lib/creatorWalletApi'
import { maskAccount } from '../../lib/bankAccount'

const EMPTY_WALLET: CreatorWallet = {
  pendingBalance: 0,
  totalPaidOut: 0,
  lifetimeEarnings: 0,
}

function formatVnd(n: number): string {
  return `${n.toLocaleString('vi-VN')} ₫`
}

function formatDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

interface Props {
  creatorId: string
}

export default function RevenuePanel({ creatorId }: Props) {
  const { t } = useTranslation()
  const [wallet, setWallet] = useState<CreatorWallet>(EMPTY_WALLET)
  const [earnings, setEarnings] = useState<RecentEarning[]>([])
  const [payouts, setPayouts] = useState<PayoutHistoryEntry[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [w, e, p] = await Promise.all([
        fetchCreatorWallet(supabase, creatorId),
        fetchRecentEarnings(supabase, creatorId, 20),
        fetchPayoutHistory(supabase, creatorId),
      ])
      if (cancelled) return
      setWallet(w.wallet)
      setEarnings(e.earnings)
      setPayouts(p.payouts)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [creatorId])

  return (
    <div data-testid="revenue-panel">
      {/* Balance cards: pending (prominent) + lifetime (secondary) */}
      <div className="flex gap-4 mb-3">
        <div
          data-testid="revenue-pending-balance"
          className="card"
          style={{ flex: 2, padding: '20px 24px' }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--ink-3)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 6,
            }}
          >
            {t('creator.revenue.pendingBalance')}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 32,
              fontWeight: 600,
              color: 'var(--ink-1)',
              lineHeight: 1.1,
            }}
          >
            {formatVnd(wallet.pendingBalance)}
          </div>
        </div>
        <div
          data-testid="revenue-lifetime-earnings"
          className="card"
          style={{ flex: 1, padding: '20px 24px' }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--ink-3)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 6,
            }}
          >
            {t('creator.revenue.lifetimeEarnings')}
          </div>
          <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink-2)' }}>
            {formatVnd(wallet.lifetimeEarnings)}
          </div>
        </div>
      </div>
      <p
        data-testid="revenue-cadence-caption"
        style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 28 }}
      >
        {t('creator.revenue.cadenceCaption')}
      </p>

      {/* Recent earnings table */}
      <div className="card overflow-hidden mb-6">
        <div
          className="border-b border-(--border)"
          style={{ padding: '14px 20px', fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}
        >
          {t('creator.revenue.recentEarnings.heading')}
        </div>
        {earnings.length === 0 ? (
          <div
            data-testid="recent-earnings-empty"
            style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 14 }}
          >
            {t('creator.revenue.recentEarnings.empty')}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ fontSize: 11, color: 'var(--ink-3)', textAlign: 'left' }}>
                <th style={{ padding: '10px 20px', fontWeight: 600 }}>
                  {t('creator.revenue.recentEarnings.colCourse')}
                </th>
                <th style={{ padding: '10px 20px', fontWeight: 600 }}>
                  {t('creator.revenue.recentEarnings.colBuyer')}
                </th>
                <th style={{ padding: '10px 20px', fontWeight: 600, textAlign: 'right' }}>
                  {t('creator.revenue.recentEarnings.colAmount')}
                </th>
                <th style={{ padding: '10px 20px', fontWeight: 600 }}>
                  {t('creator.revenue.recentEarnings.colDate')}
                </th>
              </tr>
            </thead>
            <tbody>
              {earnings.map((e) => (
                <tr
                  key={e.orderId}
                  data-testid={`recent-earning-${e.orderId}`}
                  style={{ borderTop: '1px solid var(--border)', fontSize: 13 }}
                >
                  <td style={{ padding: '12px 20px', color: 'var(--ink-1)' }}>{e.courseTitle}</td>
                  <td style={{ padding: '12px 20px', color: 'var(--ink-2)' }}>{e.buyerEmail}</td>
                  <td
                    style={{
                      padding: '12px 20px',
                      color: 'var(--ink-1)',
                      fontWeight: 500,
                      textAlign: 'right',
                    }}
                  >
                    {formatVnd(e.creatorPayout)}
                  </td>
                  <td style={{ padding: '12px 20px', color: 'var(--ink-3)' }}>
                    {formatDate(e.confirmedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Payout history table */}
      <div className="card overflow-hidden">
        <div
          className="border-b border-(--border)"
          style={{ padding: '14px 20px', fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}
        >
          {t('creator.revenue.payoutHistory.heading')}
        </div>
        {payouts.length === 0 ? (
          <div
            data-testid="payout-history-empty"
            style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 14 }}
          >
            {t('creator.revenue.payoutHistory.empty')}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ fontSize: 11, color: 'var(--ink-3)', textAlign: 'left' }}>
                <th style={{ padding: '10px 20px', fontWeight: 600 }}>
                  {t('creator.revenue.payoutHistory.colDate')}
                </th>
                <th style={{ padding: '10px 20px', fontWeight: 600, textAlign: 'right' }}>
                  {t('creator.revenue.payoutHistory.colAmount')}
                </th>
                <th style={{ padding: '10px 20px', fontWeight: 600 }}>
                  {t('creator.revenue.payoutHistory.colBank')}
                </th>
                <th style={{ padding: '10px 20px', fontWeight: 600 }}>
                  {t('creator.revenue.payoutHistory.colReference')}
                </th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr
                  key={p.id}
                  data-testid={`payout-history-${p.id}`}
                  style={{ borderTop: '1px solid var(--border)', fontSize: 13 }}
                >
                  <td style={{ padding: '12px 20px', color: 'var(--ink-3)' }}>
                    {formatDate(p.transferredAt)}
                  </td>
                  <td
                    style={{
                      padding: '12px 20px',
                      color: 'var(--ink-1)',
                      fontWeight: 500,
                      textAlign: 'right',
                    }}
                  >
                    {formatVnd(p.amount)}
                  </td>
                  <td style={{ padding: '12px 20px', color: 'var(--ink-2)' }}>
                    {p.bankName} {maskAccount(p.accountNumber)}
                  </td>
                  <td
                    style={{
                      padding: '12px 20px',
                      color: 'var(--ink-3)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                    }}
                  >
                    {p.referenceNote ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
