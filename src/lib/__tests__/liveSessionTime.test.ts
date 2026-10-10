import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SESSION_TIMEZONE,
  isValidTimezone,
  resolveSessionTimezone,
  formatSessionDate,
  formatSessionTime,
  getDurationMinutes,
  isoToDatetimeLocalString,
  datetimeLocalToIsoString,
  getDefaultTomorrowStart,
  getDefaultEndFromStart,
} from '../liveSessionTime'

describe('liveSessionTime utilities', () => {
  describe('Timezone validation and fallback', () => {
    it('validates recognized IANA timezones', () => {
      expect(isValidTimezone('Asia/Ho_Chi_Minh')).toBe(true)
      expect(isValidTimezone('America/New_York')).toBe(true)
      expect(isValidTimezone('UTC')).toBe(true)
      expect(isValidTimezone('Europe/Paris')).toBe(true)
    })

    it('rejects invalid or missing timezones', () => {
      expect(isValidTimezone('')).toBe(false)
      expect(isValidTimezone(null)).toBe(false)
      expect(isValidTimezone(undefined)).toBe(false)
      expect(isValidTimezone('Invalid/Timezone_Name')).toBe(false)
      expect(isValidTimezone('12345')).toBe(false)
    })

    it('resolves valid timezones and falls back to Asia/Ho_Chi_Minh', () => {
      expect(resolveSessionTimezone('America/New_York')).toBe('America/New_York')
      expect(resolveSessionTimezone('UTC')).toBe('UTC')
      expect(resolveSessionTimezone(null)).toBe(DEFAULT_SESSION_TIMEZONE)
      expect(resolveSessionTimezone(undefined)).toBe(DEFAULT_SESSION_TIMEZONE)
      expect(resolveSessionTimezone('GarbageTimezone')).toBe('Asia/Ho_Chi_Minh')
    })
  })

  describe('Time and Date formatting in target timezones', () => {
    // 2026-10-15T12:30:00.000Z:
    // in Asia/Ho_Chi_Minh (UTC+7) -> 2026-10-15 19:30
    // in America/New_York (EDT, UTC-4) -> 2026-10-15 08:30
    // in UTC -> 2026-10-15 12:30
    // in Tokyo Asia/Tokyo (UTC+9) -> 2026-10-15 21:30
    const testInstant = '2026-10-15T12:30:00.000Z'

    it('formats time and date in Asia/Ho_Chi_Minh', () => {
      const time = formatSessionTime(testInstant, 'Asia/Ho_Chi_Minh')
      expect(time).toBe('19:30')

      const date = formatSessionDate(testInstant, 'Asia/Ho_Chi_Minh')
      expect(date).toContain('15/10/2026')
    })

    it('formats the same instant in America/New_York (EDT)', () => {
      const time = formatSessionTime(testInstant, 'America/New_York')
      expect(time).toBe('08:30')

      const date = formatSessionDate(testInstant, 'America/New_York')
      expect(date).toContain('15/10/2026')
    })

    it('formats the same instant in UTC', () => {
      const time = formatSessionTime(testInstant, 'UTC')
      expect(time).toBe('12:30')
    })

    it('formats across day boundary properly (e.g. Tokyo vs New York)', () => {
      // 2026-10-15T22:30:00.000Z:
      // in New York (EDT, UTC-4) -> 2026-10-15 18:30
      // in Tokyo (UTC+9) -> 2026-10-16 07:30 (next day!)
      const boundaryInstant = '2026-10-15T22:30:00.000Z'
      const nyTime = formatSessionTime(boundaryInstant, 'America/New_York')
      expect(nyTime).toBe('18:30')
      expect(formatSessionDate(boundaryInstant, 'America/New_York')).toContain('15/10/2026')

      const tokyoTime = formatSessionTime(boundaryInstant, 'Asia/Tokyo')
      expect(tokyoTime).toBe('07:30')
      expect(formatSessionDate(boundaryInstant, 'Asia/Tokyo')).toContain('16/10/2026')
    })

    it('uses fallback Asia/Ho_Chi_Minh when timezone is invalid or null', () => {
      const timeInvalid = formatSessionTime(testInstant, 'invalid-tz')
      expect(timeInvalid).toBe('19:30')

      const timeNull = formatSessionTime(testInstant, null)
      expect(timeNull).toBe('19:30')
    })
  })

  describe('Bidirectional conversion between ISO and datetime-local string', () => {
    it('converts ISO string to datetime-local input string for Asia/Ho_Chi_Minh', () => {
      const iso = '2026-10-15T12:30:00.000Z'
      const dtLocal = isoToDatetimeLocalString(iso, 'Asia/Ho_Chi_Minh')
      expect(dtLocal).toBe('2026-10-15T19:30')
    })

    it('converts datetime-local input string back to UTC ISO in Asia/Ho_Chi_Minh', () => {
      const dtLocal = '2026-10-15T19:30'
      const iso = datetimeLocalToIsoString(dtLocal, 'Asia/Ho_Chi_Minh')
      expect(iso).toBe('2026-10-15T12:30:00.000Z')
    })

    it('roundtrips accurately for America/New_York', () => {
      const dtLocal = '2026-10-15T19:30'
      const iso = datetimeLocalToIsoString(dtLocal, 'America/New_York')
      // 19:30 EDT = 23:30 UTC
      expect(iso).toBe('2026-10-15T23:30:00.000Z')

      const back = isoToDatetimeLocalString(iso, 'America/New_York')
      expect(back).toBe(dtLocal)
    })

    it('roundtrips accurately for UTC', () => {
      const dtLocal = '2026-10-15T19:30'
      const iso = datetimeLocalToIsoString(dtLocal, 'UTC')
      expect(iso).toBe('2026-10-15T19:30:00.000Z')

      const back = isoToDatetimeLocalString(iso, 'UTC')
      expect(back).toBe(dtLocal)
    })

    it('roundtrips accurately across DST in America/New_York (Winter EST vs Summer EDT)', () => {
      // Winter: EST (UTC-5)
      const winterLocal = '2026-01-15T10:00'
      const winterIso = datetimeLocalToIsoString(winterLocal, 'America/New_York')
      expect(winterIso).toBe('2026-01-15T15:00:00.000Z')
      expect(isoToDatetimeLocalString(winterIso, 'America/New_York')).toBe(winterLocal)

      // Summer: EDT (UTC-4)
      const summerLocal = '2026-07-15T10:00'
      const summerIso = datetimeLocalToIsoString(summerLocal, 'America/New_York')
      expect(summerIso).toBe('2026-07-15T14:00:00.000Z')
      expect(isoToDatetimeLocalString(summerIso, 'America/New_York')).toBe(summerLocal)
    })

    it('roundtrips accurately across BST/GMT in Europe/London', () => {
      // Winter: GMT (UTC+0)
      const winterLocal = '2026-01-15T14:30'
      const winterIso = datetimeLocalToIsoString(winterLocal, 'Europe/London')
      expect(winterIso).toBe('2026-01-15T14:30:00.000Z')
      expect(isoToDatetimeLocalString(winterIso, 'Europe/London')).toBe(winterLocal)

      // Summer: BST (UTC+1)
      const summerLocal = '2026-07-15T14:30'
      const summerIso = datetimeLocalToIsoString(summerLocal, 'Europe/London')
      expect(summerIso).toBe('2026-07-15T13:30:00.000Z')
      expect(isoToDatetimeLocalString(summerIso, 'Europe/London')).toBe(summerLocal)
    })

    it('handles empty or invalid inputs gracefully', () => {
      expect(isoToDatetimeLocalString(null)).toBe('')
      expect(isoToDatetimeLocalString('')).toBe('')
      expect(datetimeLocalToIsoString('')).toBe('')
      expect(datetimeLocalToIsoString('invalid')).toBe('')
    })
  })

  describe('Duration and Default Helpers', () => {
    it('calculates duration in minutes correctly', () => {
      const start = '2026-10-15T19:30:00.000Z'
      const end = '2026-10-15T21:00:00.000Z'
      expect(getDurationMinutes(start, end)).toBe(90)
      expect(getDurationMinutes(start, null)).toBeNull()
      expect(getDurationMinutes(start, '2026-10-15T19:00:00.000Z')).toBeNull() // end <= start
    })

    it('computes default tomorrow start and end', () => {
      const start = getDefaultTomorrowStart('Asia/Ho_Chi_Minh')
      expect(start).toMatch(/^\d{4}-\d{2}-\d{2}T19:30$/)

      const end = getDefaultEndFromStart(start, 90)
      expect(end).toMatch(/^\d{4}-\d{2}-\d{2}T21:00$/)
    })
  })
})
