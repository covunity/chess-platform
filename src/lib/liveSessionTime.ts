/**
 * Live Session Time & Timezone Utilities
 *
 * Provides IANA timezone-aware formatting and bidirectional conversion between
 * UTC ISO strings (timestamptz in DB) and datetime-local input strings.
 */

export const DEFAULT_SESSION_TIMEZONE = 'Asia/Ho_Chi_Minh'

/**
 * Validates whether a timezone identifier is a recognized IANA timezone.
 */
export function isValidTimezone(tz?: string | null): boolean {
  if (!tz || typeof tz !== 'string') return false
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/**
 * Resolves a timezone string to a valid IANA timezone, falling back to DEFAULT_SESSION_TIMEZONE.
 */
export function resolveSessionTimezone(tz?: string | null): string {
  return isValidTimezone(tz) ? tz! : DEFAULT_SESSION_TIMEZONE
}

/**
 * Formats a session date in the specified session timezone (Vietnamese locale).
 * Example: "thứ năm, 15/10/2026"
 */
export function formatSessionDate(isoString: string, timezone?: string | null): string {
  try {
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return isoString
    const tz = resolveSessionTimezone(timezone)
    return d.toLocaleDateString('vi-VN', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: tz,
    })
  } catch {
    return isoString
  }
}

/**
 * Formats a session time (HH:mm) in the specified session timezone.
 * Example: "19:30"
 */
export function formatSessionTime(isoString: string, timezone?: string | null): string {
  try {
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return ''
    const tz = resolveSessionTimezone(timezone)
    return d.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: tz,
    })
  } catch {
    return ''
  }
}

/**
 * Calculates duration in minutes between start and end ISO strings.
 */
export function getDurationMinutes(startIso: string, endIso?: string | null): number | null {
  if (!endIso) return null
  try {
    const start = new Date(startIso).getTime()
    const end = new Date(endIso).getTime()
    if (isNaN(start) || isNaN(end) || end <= start) return null
    return Math.round((end - start) / 60000)
  } catch {
    return null
  }
}

/**
 * Converts a UTC ISO string to an HTML <input type="datetime-local"> value (YYYY-MM-DDTHH:mm)
 * in the specified session timezone.
 */
export function isoToDatetimeLocalString(isoString?: string | null, timezone?: string | null): string {
  if (!isoString) return ''
  const d = new Date(isoString)
  if (isNaN(d.getTime())) return ''
  const tz = resolveSessionTimezone(timezone)

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  const parts = formatter.formatToParts(d)
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || ''

  const year = getPart('year')
  const month = getPart('month')
  const day = getPart('day')
  let hour = getPart('hour')
  if (hour === '24') hour = '00'
  const minute = getPart('minute')

  return `${year}-${month}-${day}T${hour}:${minute}`
}

/**
 * Converts an HTML <input type="datetime-local"> string (YYYY-MM-DDTHH:mm)
 * representing a date/time in the specified session timezone to a UTC ISO string.
 */
export function datetimeLocalToIsoString(datetimeLocal: string, timezone?: string | null): string {
  if (!datetimeLocal || typeof datetimeLocal !== 'string') return ''
  const tz = resolveSessionTimezone(timezone)
  const [datePart, timePart] = datetimeLocal.split('T')
  if (!datePart || !timePart) return ''

  const [yearStr, monthStr, dayStr] = datePart.split('-')
  const [hourStr, minuteStr] = timePart.split(':')
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  const hour = Number(hourStr)
  const minute = Number(minuteStr)

  if (isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hour) || isNaN(minute)) return ''

  // 1. Initial UTC guess interpreting the face value as UTC
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0))

  // 2. Measure what time utcGuess represents in tz
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const parts = formatter.formatToParts(utcGuess)
  const getPart = (type: string) => Number(parts.find((p) => p.type === type)?.value || '0')
  let tzHour = getPart('hour')
  if (tzHour === 24) tzHour = 0
  const tzAsUtc = Date.UTC(getPart('year'), getPart('month') - 1, getPart('day'), tzHour, getPart('minute'), getPart('second'))

  const offsetMs = tzAsUtc - utcGuess.getTime()

  // 3. Compensate for the offset to get exact UTC instant
  let targetInstant = new Date(utcGuess.getTime() - offsetMs)

  // 4. Refine once to handle any DST transitions across the offset boundary
  const refParts = formatter.formatToParts(targetInstant)
  const getRef = (type: string) => Number(refParts.find((p) => p.type === type)?.value || '0')
  let refHour = getRef('hour')
  if (refHour === 24) refHour = 0
  const refAsUtc = Date.UTC(getRef('year'), getRef('month') - 1, getRef('day'), refHour, getRef('minute'), getRef('second'))
  const refDiff = refAsUtc - Date.UTC(year, month - 1, day, hour, minute, 0)
  if (refDiff !== 0) {
    targetInstant = new Date(targetInstant.getTime() - refDiff)
  }

  return targetInstant.toISOString()
}

/**
 * Returns a default tomorrow start time (19:30) as a datetime-local input string
 * in the specified session timezone.
 */
export function getDefaultTomorrowStart(timezone?: string | null): string {
  const tz = resolveSessionTimezone(timezone)
  const now = new Date()

  // Find today's date in target timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const [year, month, day] = formatter.format(now).split('-').map(Number)

  // Add 1 day
  const tomorrowUtc = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0))
  const tomParts = formatter.format(tomorrowUtc).split('-')
  return `${tomParts[0]}-${tomParts[1]}-${tomParts[2]}T19:30`
}

/**
 * Given a datetime-local start string, calculates a default end string by adding durationMinutes.
 */
export function getDefaultEndFromStart(startDatetimeLocal: string, durationMinutes = 90): string {
  if (!startDatetimeLocal) return ''
  const [datePart, timePart] = startDatetimeLocal.split('T')
  if (!datePart || !timePart) return ''
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)
  if (isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hour) || isNaN(minute)) return ''

  const d = new Date(Date.UTC(year, month - 1, day, hour, minute + durationMinutes, 0))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
