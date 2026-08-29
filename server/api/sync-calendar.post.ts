import { auth, calendar, calendar_v3 } from "@googleapis/calendar";
import type { NormalizedShift } from "../utils/normalizeShifts";

const EVENT_SUMMARY = "Steff Working";

interface SyncPayload {
  shifts: NormalizedShift[];
  /** OAuth2 access token obtained by the client after the Google OAuth flow */
  accessToken: string;
  /** IANA timezone string, e.g. "America/Chicago". Defaults to UTC. */
  timeZone?: string;
  /** Calendar ID to insert events into. Defaults to the "Steff Working" calendar. */
  calendarId?: string;
}

const DEFAULT_CALENDAR_NAME = "Steff Working";

/**
 * POST /api/sync-calendar
 *
 * Accepts normalized shift objects and inserts them as Google Calendar events.
 * Requires a valid OAuth2 access token from the client.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();

  if (!config.googleClientId || !config.googleClientSecret) {
    throw createError({
      statusCode: 500,
      statusMessage: "Google OAuth credentials are not configured",
    });
  }

  const body = await readBody<SyncPayload>(event);

  if (
    !body?.shifts ||
    !Array.isArray(body.shifts) ||
    body.shifts.length === 0
  ) {
    throw createError({ statusCode: 400, statusMessage: "No shifts provided" });
  }

  if (!body.accessToken) {
    throw createError({
      statusCode: 401,
      statusMessage: "Missing Google OAuth access token",
    });
  }

  // Set up OAuth2 client with the access token provided by the client
  const oauth2Client = new auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri,
  );
  oauth2Client.setCredentials({ access_token: body.accessToken });

  const cal = calendar({ version: "v3", auth: oauth2Client });
  const calendarId =
    body.calendarId ?? (await findCalendarIdByName(cal, DEFAULT_CALENDAR_NAME));
  // Use the timezone supplied by the client; fall back to UTC so calendar
  // events are never silently assigned the server's deployment timezone.
  const timeZone = body.timeZone ?? "UTC";

  const results: Array<{
    shift: NormalizedShift;
    eventId: string | null;
    error?: string;
  }> = [];

  for (const shift of body.shifts) {
    const eventBody: calendar_v3.Schema$Event = {
      summary: EVENT_SUMMARY,
      description: `Shift for STEFF${shift.startWasRounded ? " (start time rounded from " + shift.rawStartTime + ")" : ""}`,
      start: {
        dateTime: shift.startISO,
        timeZone,
      },
      end: {
        dateTime: shift.endISO,
        timeZone,
      },
    };

    try {
      const matchingEvents = await findMatchingEvents(
        cal,
        calendarId,
        shift,
        timeZone,
      );
      const currentEvent = matchingEvents.find(
        (existingEvent) => existingEvent.summary === EVENT_SUMMARY,
      );
      const legacyEvent = matchingEvents.find(
        (existingEvent) => existingEvent.summary === "Work Shift",
      );

      if (currentEvent?.id) {
        results.push({ shift, eventId: currentEvent.id });
        continue;
      }

      if (legacyEvent?.id) {
        const res = await cal.events.patch({
          calendarId,
          eventId: legacyEvent.id,
          requestBody: {
            summary: EVENT_SUMMARY,
            description: eventBody.description,
          },
        });
        results.push({ shift, eventId: res.data.id ?? legacyEvent.id });
        continue;
      }

      const res = await cal.events.insert({
        calendarId,
        requestBody: eventBody,
      });
      results.push({ shift, eventId: res.data.id ?? null });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[sync-calendar] Failed to insert event for ${shift.date}:`,
        msg,
      );
      results.push({ shift, eventId: null, error: msg });
    }
  }

  return { results };
});

async function findCalendarIdByName(
  cal: calendar_v3.Calendar,
  calendarName: string,
): Promise<string> {
  const response = await cal.calendarList.list();
  const matchingCalendar = response.data.items?.find(
    (entry) => entry.summary === calendarName,
  );

  if (!matchingCalendar?.id) {
    throw createError({
      statusCode: 404,
      statusMessage: `Google Calendar "${calendarName}" was not found`,
    });
  }

  return matchingCalendar.id;
}

async function findMatchingEvents(
  cal: calendar_v3.Calendar,
  calendarId: string,
  shift: NormalizedShift,
  timeZone: string,
): Promise<calendar_v3.Schema$Event[]> {
  const response = await cal.events.list({
    calendarId,
    singleEvents: true,
    timeMin: `${shift.date}T00:00:00Z`,
    timeMax: `${addDays(shift.date, 2)}T00:00:00Z`,
  });

  return (
    response.data.items?.filter((event) => {
      const startDateTime = event.start?.dateTime;
      const endDateTime = event.end?.dateTime;

      if (!startDateTime || !endDateTime) {
        return false;
      }

      return (
        formatEventDateTime(startDateTime, timeZone) === shift.startISO &&
        formatEventDateTime(endDateTime, timeZone) === shift.endISO
      );
    }) ?? []
  );
}

function formatEventDateTime(dateTime: string, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(new Date(dateTime));

  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return `${getPart("year")}-${getPart("month")}-${getPart("day")}T${getPart("hour")}:${getPart("minute")}:${getPart("second")}`;
}

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
