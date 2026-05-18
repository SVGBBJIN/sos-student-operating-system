// Aggregate behavioral signals from task_events for a user.
// Used by the priority engine and injected as a pinned context snippet.
// Uses fetch only — safe for both Node (Vercel) and Deno (supabase/functions).

export interface BehavioralSignals {
  completion_rate_30d: number;
  median_hours_to_complete: Record<string, number>;  // by subject
  postpone_rate_by_subject: Record<string, number>;
  time_of_day_histogram: number[];  // 24 buckets, completion counts per hour
  recent_abandons: Array<{ title: string; subject: string; age_days: number }>;
  total_events_30d: number;
}

const EMPTY: BehavioralSignals = {
  completion_rate_30d: 0,
  median_hours_to_complete: {},
  postpone_rate_by_subject: {},
  time_of_day_histogram: Array(24).fill(0) as number[],
  recent_abandons: [],
  total_events_30d: 0,
};

// In-process cache: key = "userId:hourBucket", value = signals + expiry.
const cache = new Map<string, { signals: BehavioralSignals; expiresAt: number }>();

function hourBucket(): number {
  return Math.floor(Date.now() / 3_600_000);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] + sorted[mid]) / 2)
    : (sorted[mid] ?? 0);
}

export async function getBehavioralSignals(
  userId: string,
  opts?: { windowDays?: number; supabaseUrl?: string; serviceKey?: string }
): Promise<BehavioralSignals> {
  const key = `${userId}:${hourBucket()}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.signals;

  const supabaseUrl = opts?.supabaseUrl ?? (
    typeof process !== "undefined"
      ? process.env.SUPABASE_URL
      : undefined
  ) ?? "";
  const serviceKey = opts?.serviceKey ?? (
    typeof process !== "undefined"
      ? process.env.SUPABASE_SERVICE_ROLE_KEY
      : undefined
  ) ?? "";

  if (!supabaseUrl || !serviceKey) return EMPTY;

  const windowDays = opts?.windowDays ?? 30;
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/task_events?user_id=eq.${encodeURIComponent(userId)}&occurred_at=gte.${encodeURIComponent(since)}&select=event_type,occurred_at,from_status,to_status,metadata,task_id`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Accept: "application/json",
        },
      }
    );

    if (!res.ok) return EMPTY;

    interface RawRow {
      event_type: string;
      occurred_at: string;
      from_status: string | null;
      to_status: string | null;
      metadata: Record<string, unknown>;
      task_id: string | null;
    }
    const rows: RawRow[] = await res.json() as RawRow[];
    if (!Array.isArray(rows) || rows.length === 0) return EMPTY;

    const creates = rows.filter((r) => r.event_type === "create");
    const completes = rows.filter((r) => r.event_type === "complete");
    const postpones = rows.filter((r) => r.event_type === "postpone");
    const abandons = rows.filter((r) => r.event_type === "abandon");

    // Completion rate
    const completion_rate_30d =
      creates.length > 0 ? completes.length / creates.length : 0;

    // Time-to-complete per subject (hours between create and complete for matched task_ids)
    const createByTask = new Map<string, { time: number; subject: string }>();
    for (const r of creates) {
      if (r.task_id) {
        createByTask.set(r.task_id, {
          time: new Date(r.occurred_at).getTime(),
          subject: String((r.metadata as Record<string, unknown>).subject ?? "other"),
        });
      }
    }
    const hoursBySubject: Record<string, number[]> = {};
    for (const r of completes) {
      if (r.task_id) {
        const created = createByTask.get(r.task_id);
        if (created) {
          const hours = (new Date(r.occurred_at).getTime() - created.time) / 3_600_000;
          if (hours > 0) {
            (hoursBySubject[created.subject] ??= []).push(hours);
          }
        }
      }
    }
    const median_hours_to_complete: Record<string, number> = {};
    for (const [subj, hrs] of Object.entries(hoursBySubject)) {
      median_hours_to_complete[subj] = median(hrs);
    }

    // Postpone rate per subject
    const postponeCountBySubject: Record<string, number> = {};
    const createCountBySubject: Record<string, number> = {};
    for (const r of creates) {
      const subj = String((r.metadata as Record<string, unknown>).subject ?? "other");
      createCountBySubject[subj] = (createCountBySubject[subj] ?? 0) + 1;
    }
    for (const r of postpones) {
      const subj = String((r.metadata as Record<string, unknown>).subject ?? "other");
      postponeCountBySubject[subj] = (postponeCountBySubject[subj] ?? 0) + 1;
    }
    const postpone_rate_by_subject: Record<string, number> = {};
    for (const subj of Object.keys(postponeCountBySubject)) {
      const total = createCountBySubject[subj] ?? 1;
      postpone_rate_by_subject[subj] = postponeCountBySubject[subj] / total;
    }

    // Completion time-of-day histogram
    const time_of_day_histogram: number[] = Array(24).fill(0) as number[];
    for (const r of completes) {
      const hour = new Date(r.occurred_at).getHours();
      time_of_day_histogram[hour] = (time_of_day_histogram[hour] ?? 0) + 1;
    }

    // Recent abandons (last 7 days)
    const sevenDaysAgo = Date.now() - 7 * 86_400_000;
    const recent_abandons = abandons
      .filter((r) => new Date(r.occurred_at).getTime() > sevenDaysAgo)
      .slice(0, 5)
      .map((r) => ({
        title: String((r.metadata as Record<string, unknown>).title ?? ""),
        subject: String((r.metadata as Record<string, unknown>).subject ?? "other"),
        age_days: Math.round(
          (Date.now() - new Date(r.occurred_at).getTime()) / 86_400_000
        ),
      }));

    const signals: BehavioralSignals = {
      completion_rate_30d: Math.round(completion_rate_30d * 100) / 100,
      median_hours_to_complete,
      postpone_rate_by_subject,
      time_of_day_histogram,
      recent_abandons,
      total_events_30d: rows.length,
    };

    cache.set(key, { signals, expiresAt: Date.now() + 3_600_000 });
    return signals;
  } catch {
    return EMPTY;
  }
}

export function formatSignalsForContext(signals: BehavioralSignals): string {
  const lines: string[] = [];

  if (signals.completion_rate_30d > 0) {
    lines.push(
      `30-day task completion rate: ${Math.round(signals.completion_rate_30d * 100)}%`
    );
  }

  const topPostpone = Object.entries(signals.postpone_rate_by_subject)
    .filter(([, rate]) => rate > 0.3)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 2)
    .map(([subj, rate]) => `${subj} (${Math.round(rate * 100)}%)`);
  if (topPostpone.length > 0) {
    lines.push(`Subjects with high postpone rate: ${topPostpone.join(", ")}`);
  }

  const notableSubjects = Object.entries(signals.median_hours_to_complete)
    .filter(([, h]) => h >= 0.5)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 2)
    .map(([subj, h]) => `${subj} (~${h < 2 ? Math.round(h * 60) + "min" : Math.round(h) + "h"})`);
  if (notableSubjects.length > 0) {
    lines.push(`Typical task duration: ${notableSubjects.join(", ")}`);
  }

  // Peak completion hour
  const peakHour = signals.time_of_day_histogram.indexOf(
    Math.max(...signals.time_of_day_histogram)
  );
  if (signals.total_events_30d > 5 && peakHour >= 0) {
    const ampm = peakHour < 12 ? "AM" : "PM";
    const h12 = peakHour % 12 === 0 ? 12 : peakHour % 12;
    lines.push(`Peak productivity hour: ${h12}${ampm}`);
  }

  if (signals.recent_abandons.length > 0) {
    const titles = signals.recent_abandons.map((a) => `"${a.title}"`).join(", ");
    lines.push(`Recently abandoned: ${titles}`);
  }

  return lines.join(". ");
}
