export interface RawShift {
  date: string
  rawStartTime: string
  rawEndTime: string
}

export interface NormalizedShift {
  date: string
  rawStartTime: string
  rawEndTime: string
  /** ISO 8601 local-time string, e.g. "2026-08-01T08:00:00" */
  startISO: string
  /** ISO 8601 local-time string, e.g. "2026-08-01T16:00:00" */
  endISO: string
  /** true when the original start time had :45 minutes and was rounded up */
  startWasRounded: boolean
}

/**
 * Add one day to a YYYY-MM-DD string.
 */
function addOneDay(date: string): string {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Parse a time string like "7:45 AM" or "3:30 PM" into { hours, minutes }.
 * Returns null if the string cannot be parsed.
 */
function parseTime(raw: string): { hours: number; minutes: number } | null {
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!match) return null

  let hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)
  const meridiem = match[3].toUpperCase()

  if (meridiem === 'AM') {
    if (hours === 12) hours = 0
  } else {
    if (hours !== 12) hours += 12
  }

  return { hours, minutes }
}

/**
 * Build a local ISO 8601 datetime string (no timezone offset) from a
 * YYYY-MM-DD date and { hours, minutes }.
 */
function toLocalISO(date: string, hours: number, minutes: number): string {
  const hh = String(hours).padStart(2, '0')
  const mm = String(minutes).padStart(2, '0')
  return `${date}T${hh}:${mm}:00`
}

/**
 * Apply the :45 rounding rule: if a start time ends in :45 minutes, round it
 * up to the next full hour.
 *
 * @param time - { hours, minutes } from parseTime
 * @returns { hours, minutes, rounded, dayOverflow } where rounded indicates a
 *   change was made and dayOverflow is true when the clock crossed midnight.
 */
function applyRounding(time: { hours: number; minutes: number }): {
  hours: number
  minutes: number
  rounded: boolean
  dayOverflow: boolean
} {
  if (time.minutes === 45) {
    const nextHour = time.hours + 1
    if (nextHour === 24) {
      return { hours: 0, minutes: 0, rounded: true, dayOverflow: true }
    }
    return { hours: nextHour, minutes: 0, rounded: true, dayOverflow: false }
  }
  return { ...time, rounded: false, dayOverflow: false }
}

/**
 * Transform an array of raw shifts into normalized shifts with ISO datetimes.
 * Applies :45 rounding to start times.
 */
export function normalizeShifts(rawShifts: RawShift[]): NormalizedShift[] {
  const results: NormalizedShift[] = []

  for (const shift of rawShifts) {
    const startParsed = parseTime(shift.rawStartTime)
    const endParsed = parseTime(shift.rawEndTime)

    if (!startParsed || !endParsed) {
      console.warn(`[normalizeShifts] Could not parse times for shift on ${shift.date}:`, shift)
      continue
    }

    const { hours: startH, minutes: startM, rounded, dayOverflow } = applyRounding(startParsed)
    // If rounding crossed midnight, the start date advances by one day
    const startDate = dayOverflow ? addOneDay(shift.date) : shift.date

    results.push({
      date: shift.date,
      rawStartTime: shift.rawStartTime,
      rawEndTime: shift.rawEndTime,
      startISO: toLocalISO(startDate, startH, startM),
      endISO: toLocalISO(shift.date, endParsed.hours, endParsed.minutes),
      startWasRounded: rounded,
    })
  }

  return results
}
