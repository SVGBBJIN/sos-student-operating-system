// Google Calendar adapter — pull mode, read-only.
//
// The cheapest high-confidence source we have: these are already structured
// events, so there's nothing to parse, classify, or second-guess. No submission
// concept exists here, so fetchSubmissions() returns [] and the adapter earns
// its keep entirely through fetchCalendar().
//
// Reuses the Classroom OAuth plumbing — same Google client credentials, one
// extra scope (calendar.readonly). "Courses" in the tracked_courses table are
// reinterpreted as calendar ids, which lets the existing Step-3 picker choose
// calendars with no UI change.
//
// API reference: https://developers.google.com/calendar/api/v3/reference/events/list

import { refreshGoogleToken, expiryFromNow } from "../oauth/google.js";
import type {
  NormalizedCalendarEvent,
  NormalizedSubmission,
  PullAdapter,
  PullAdapterCtx,
} from "./types.js";

const API_BASE = "https://www.googleapis.com/calendar/v3";
const MAX_PAGES = 10;

interface GCalEvent {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  recurringEventId?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
}

async function ensureFreshToken(ctx: PullAdapterCtx): Promise<string> {
  const { integration, saveTokens } = ctx;
  const expiresAt = integration.token_expires_at ? Date.parse(integration.token_expires_at) : 0;
  const needsRefresh = !integration.access_token || expiresAt - Date.now() < 60_000;
  if (!needsRefresh) return integration.access_token as string;

  if (!integration.refresh_token) {
    throw new Error("Google Calendar integration has no refresh_token — user must reconnect");
  }
  try {
    const next = await refreshGoogleToken(integration.refresh_token);
    const patch = {
      access_token: next.access_token,
      token_expires_at: expiryFromNow(next.expires_in),
      ...(next.refresh_token ? { refresh_token: next.refresh_token } : {}),
    };
    await saveTokens(patch);
    integration.access_token = patch.access_token;
    integration.token_expires_at = patch.token_expires_at;
    if (next.refresh_token) integration.refresh_token = next.refresh_token;
    return next.access_token;
  } catch (err) {
    if (/invalid_grant/i.test(String(err))) {
      await saveTokens({ status: "revoked" });
    }
    throw err;
  }
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Split an RFC3339 dateTime into the local date + time halves `events` stores.
 * All-day events arrive as a bare `date` and keep null times.
 */
function splitStamp(slot: GCalEvent["start"]): { date: string | null; time: string | null } {
  if (!slot) return { date: null, time: null };
  if (slot.date) return { date: slot.date, time: null };
  if (!slot.dateTime) return { date: null, time: null };

  const parsed = new Date(slot.dateTime);
  if (Number.isNaN(parsed.getTime())) return { date: null, time: null };
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`,
    time: `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:00`,
  };
}

async function listEventsForCalendar(
  token: string,
  calendarId: string,
  timeMin: string,
  timeMax: string
): Promise<GCalEvent[]> {
  const base =
    `${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events` +
    `?singleEvents=true&orderBy=startTime&maxResults=250` +
    `&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`;

  const out: GCalEvent[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  do {
    const url = pageToken ? `${base}&pageToken=${encodeURIComponent(pageToken)}` : base;
    const res = await fetch(url, { headers: authHeaders(token) });
    if (!res.ok) {
      // A calendar the user unshared shouldn't break the others.
      if (res.status === 404 || res.status === 403) break;
      const body = await res.text().catch(() => "");
      throw new Error(`Google Calendar events.list ${res.status} for ${calendarId}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json().catch(() => ({}))) as {
      items?: GCalEvent[];
      nextPageToken?: string;
    };
    for (const item of data.items ?? []) out.push(item);
    pageToken = data.nextPageToken;
    pages++;
  } while (pageToken && pages < MAX_PAGES);

  return out;
}

export const gcalAdapter: PullAdapter = {
  id: "gcal",
  mode: "pull",

  // Google Calendar has no submission concept. Returning [] keeps the
  // orchestrator's submission path uniform instead of special-casing provider ids.
  async fetchSubmissions(_ctx: PullAdapterCtx): Promise<NormalizedSubmission[]> {
    return [];
  },

  /** "Courses" are calendars here, so the existing Step-3 picker just works. */
  async listCourses(ctx: PullAdapterCtx): Promise<Array<{ externalCourseId: string; name: string }>> {
    const token = await ensureFreshToken(ctx);
    const out: Array<{ externalCourseId: string; name: string }> = [];
    let pageToken: string | undefined;
    let pages = 0;

    do {
      const url =
        `${API_BASE}/users/me/calendarList?maxResults=250&minAccessRole=reader` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
      const res = await fetch(url, { headers: authHeaders(token) });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Google calendarList ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        items?: Array<{ id?: string; summary?: string; summaryOverride?: string; primary?: boolean }>;
        nextPageToken?: string;
      };
      for (const c of data.items ?? []) {
        if (!c.id) continue;
        out.push({
          externalCourseId: c.id,
          name: c.summaryOverride ?? c.summary ?? (c.primary ? "Primary calendar" : c.id),
        });
      }
      pageToken = data.nextPageToken;
      pages++;
    } while (pageToken && pages < MAX_PAGES);

    return out;
  },

  async fetchCalendar(ctx: PullAdapterCtx): Promise<NormalizedCalendarEvent[]> {
    const token = await ensureFreshToken(ctx);
    if (ctx.courses.length === 0) return [];

    const from = new Date();
    from.setDate(from.getDate() - 7);
    const to = new Date();
    to.setDate(to.getDate() + 120);
    const timeMin = from.toISOString();
    const timeMax = to.toISOString();

    const out: NormalizedCalendarEvent[] = [];
    for (const cal of ctx.courses) {
      const calendarId = cal.external_course_id;
      const events = await listEventsForCalendar(token, calendarId, timeMin, timeMax);
      for (const e of events) {
        if (!e.id) continue;
        const start = splitStamp(e.start);
        if (!start.date) continue;
        const end = splitStamp(e.end);
        out.push({
          externalId: `gcal:${calendarId}:${e.id}`,
          title: e.summary ?? "(no title)",
          date: start.date,
          startTime: start.time,
          // An all-day event's `end.date` is exclusive in Google's model; we
          // only store a time here, so a null end is the honest answer.
          endTime: start.time ? end.time : null,
          description: e.description ?? null,
          location: e.location ?? null,
          url: e.htmlLink ?? null,
          cancelled: e.status === "cancelled",
          raw: e,
        });
      }
    }
    return out;
  },
};
