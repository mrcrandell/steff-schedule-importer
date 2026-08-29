import { calendar_v3, google } from '@googleapis/calendar'
import type { NormalizedShift } from '../utils/normalizeShifts'

interface SyncPayload {
  shifts: NormalizedShift[]
  /** OAuth2 access token obtained by the client after the Google OAuth flow */
  accessToken: string
  /** IANA timezone string, e.g. "America/Chicago". Defaults to UTC. */
  timeZone?: string
  /** Calendar ID to insert events into. Defaults to 'primary'. */
  calendarId?: string
}

/**
 * POST /api/sync-calendar
 *
 * Accepts normalized shift objects and inserts them as Google Calendar events.
 * Requires a valid OAuth2 access token from the client.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()

  if (!config.googleClientId || !config.googleClientSecret) {
    throw createError({ statusCode: 500, statusMessage: 'Google OAuth credentials are not configured' })
  }

  const body = await readBody<SyncPayload>(event)

  if (!body?.shifts || !Array.isArray(body.shifts) || body.shifts.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No shifts provided' })
  }

  if (!body.accessToken) {
    throw createError({ statusCode: 401, statusMessage: 'Missing Google OAuth access token' })
  }

  const calendarId = body.calendarId ?? 'primary'
  // Use the timezone supplied by the client; fall back to UTC so calendar
  // events are never silently assigned the server's deployment timezone.
  const timeZone = body.timeZone ?? 'UTC'

  // Set up OAuth2 client with the access token provided by the client
  const oauth2Client = new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri,
  )
  oauth2Client.setCredentials({ access_token: body.accessToken })

  const cal = google.calendar({ version: 'v3', auth: oauth2Client })

  const results: Array<{ shift: NormalizedShift; eventId: string | null; error?: string }> = []

  for (const shift of body.shifts) {
    const eventBody: calendar_v3.Schema$Event = {
      summary: 'Work Shift',
      description: `Shift for STEFF${shift.startWasRounded ? ' (start time rounded from ' + shift.rawStartTime + ')' : ''}`,
      start: {
        dateTime: shift.startISO,
        timeZone,
      },
      end: {
        dateTime: shift.endISO,
        timeZone,
      },
    }

    try {
      const res = await cal.events.insert({ calendarId, requestBody: eventBody })
      results.push({ shift, eventId: res.data.id ?? null })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[sync-calendar] Failed to insert event for ${shift.date}:`, msg)
      results.push({ shift, eventId: null, error: msg })
    }
  }

  return { results }
})
