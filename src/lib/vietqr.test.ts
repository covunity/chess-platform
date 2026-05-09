import { buildVietQRUrl } from './vietqr'

describe('buildVietQRUrl', () => {
  const base = {
    shortName: 'MBBANK',
    accountNumber: '0123456789',
    accountName: 'CHESS COURSE',
    amount: 480000,
    addInfo: 'ORD-2026-000142',
  }

  it('builds the documented img.vietqr.io URL', () => {
    const url = buildVietQRUrl(base)
    expect(url).toBe(
      'https://img.vietqr.io/image/MBBANK-0123456789-compact.jpg' +
        '?amount=480000&addInfo=ORD-2026-000142&accountName=CHESS%20COURSE',
    )
  })

  it('uses compact template by default', () => {
    expect(buildVietQRUrl(base)).toContain('-compact.jpg')
  })

  it('respects an explicit template', () => {
    const url = buildVietQRUrl({ ...base, template: 'qr_only' })
    expect(url).toContain('-qr_only.jpg')
  })

  it('uppercases the account name', () => {
    const url = buildVietQRUrl({ ...base, accountName: 'chess course' })
    expect(url).toContain('accountName=CHESS%20COURSE')
  })

  it('strips Vietnamese diacritics from the account name', () => {
    const url = buildVietQRUrl({ ...base, accountName: 'Nguyễn Văn A' })
    expect(url).toContain('accountName=NGUYEN%20VAN%20A')
  })

  it('strips diacritics across all marks (ăâđêôơư + tones)', () => {
    const url = buildVietQRUrl({
      ...base,
      accountName: 'Đặng Thị Mỹ Phượng',
    })
    expect(url).toContain('accountName=DANG%20THI%20MY%20PHUONG')
  })

  it('URL-encodes special characters in addInfo', () => {
    const url = buildVietQRUrl({ ...base, addInfo: 'ORD 2026/000142&x=1' })
    expect(url).toContain('addInfo=ORD%202026%2F000142%26x%3D1')
  })

  it('throws on empty shortName', () => {
    expect(() => buildVietQRUrl({ ...base, shortName: '' })).toThrow()
  })

  it('throws on empty accountNumber', () => {
    expect(() => buildVietQRUrl({ ...base, accountNumber: '' })).toThrow()
  })

  it('throws on whitespace-only shortName', () => {
    expect(() => buildVietQRUrl({ ...base, shortName: '   ' })).toThrow()
  })

  it('serialises amount as an integer (no decimal)', () => {
    const url = buildVietQRUrl({ ...base, amount: 99999 })
    expect(url).toContain('amount=99999')
    expect(url).not.toContain('amount=99999.0')
  })

  it('rejects non-finite amount', () => {
    expect(() => buildVietQRUrl({ ...base, amount: NaN })).toThrow()
    expect(() => buildVietQRUrl({ ...base, amount: -1 })).toThrow()
  })

  it('omits the bin segment when not provided (shortName is enough)', () => {
    const url = buildVietQRUrl(base)
    // Path is shortName-accountNumber-template, BIN is metadata only.
    expect(url).toMatch(/MBBANK-0123456789-compact\.jpg/)
  })
})
