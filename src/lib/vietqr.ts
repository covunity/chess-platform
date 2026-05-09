export type VietQRTemplate = 'compact' | 'compact2' | 'qr_only' | 'print'

export interface VietQRParams {
  shortName: string
  accountNumber: string
  accountName: string
  amount: number
  addInfo: string
  bin?: string
  template?: VietQRTemplate
}

const VIETQR_HOST = 'https://img.vietqr.io/image'

export function buildVietQRUrl(p: VietQRParams): string {
  if (!p.shortName || !p.shortName.trim()) {
    throw new Error('vietqr: shortName is required')
  }
  if (!p.accountNumber || !p.accountNumber.trim()) {
    throw new Error('vietqr: accountNumber is required')
  }
  if (!Number.isFinite(p.amount) || p.amount < 0) {
    throw new Error('vietqr: amount must be a non-negative finite number')
  }

  const template = p.template ?? 'compact'
  const accountName = encodeURIComponent(stripDiacritics(p.accountName).toUpperCase())
  const addInfo = encodeURIComponent(p.addInfo)
  const amount = Math.trunc(p.amount).toString()

  return (
    `${VIETQR_HOST}/${p.shortName}-${p.accountNumber}-${template}.jpg` +
    `?amount=${amount}&addInfo=${addInfo}&accountName=${accountName}`
  )
}

function stripDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
}
