// Aggregate study-pack quiz performance into per-topic weak-spot signals.
// Injected as a pinned context snippet so the chat assistant can gently
// suggest review of topics the student keeps scoring low on.
// Uses fetch only — safe for both Node (Vercel) and Deno (supabase/functions).

export type TopicTrend = "improving" | "declining" | "flat";

export interface WeakTopic {
  topic: string;
  subject: string;
  attempts: number;
  avg_mastery: number;   // 0..1
  last_mastery: number;  // 0..1
  trend: TopicTrend;
}

export interface StudySignals {
  weak_topics: WeakTopic[];
}

const EMPTY: StudySignals = { weak_topics: [] };

// In-process cache: key = "userId:hourBucket", value = signals + expiry.
const cache = new Map<string, { signals: StudySignals; expiresAt: number }>();

// Wall-clock cap on the study_attempts fetch — runs before chat turns, so a
// slow REST call must never stall the request.
const STUDY_BUDGET_MS = 3000;

function hourBucket(): number {
  return Math.floor(Date.now() / 3_600_000);
}

export async function getStudySignals(
  userId: string,
  opts?: { windowDays?: number; supabaseUrl?: string; serviceKey?: string }
): Promise<StudySignals> {
  const key = `${userId}:${hourBucket()}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.signals;

  const supabaseUrl = opts?.supabaseUrl ?? (
    typeof process !== "undefined" ? process.env.SUPABASE_URL : undefined
  ) ?? "";
  const serviceKey = opts?.serviceKey ?? (
    typeof process !== "undefined" ? process.env.SUPABASE_SERVICE_ROLE_KEY : undefined
  ) ?? "";

  if (!supabaseUrl || !serviceKey) return EMPTY;

  const windowDays = opts?.windowDays ?? 60;
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`study signals timeout after ${STUDY_BUDGET_MS}ms`)),
    STUDY_BUDGET_MS
  );
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/study_attempts?user_id=eq.${encodeURIComponent(userId)}&attempted_at=gte.${encodeURIComponent(since)}&select=topic,subject,mastery,attempted_at&order=attempted_at.asc`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      }
    );
    if (!res.ok) return EMPTY;

    interface RawRow {
      topic: string | null;
      subject: string | null;
      mastery: number | string | null;
      attempted_at: string;
    }
    const rows: RawRow[] = await res.json() as RawRow[];
    if (!Array.isArray(rows) || rows.length === 0) return EMPTY;

    // Group attempts by lowercased topic key (rows already sorted ascending).
    const groups = new Map<string, { topic: string; subject: string; masteries: number[] }>();
    for (const r of rows) {
      const topic = (r.topic ?? "").trim();
      if (!topic) continue;
      const k = topic.toLowerCase();
      const m = Math.max(0, Math.min(1, Number(r.mastery) || 0));
      const g = groups.get(k);
      if (g) {
        g.masteries.push(m);
        if (!g.subject && r.subject) g.subject = String(r.subject);
      } else {
        groups.set(k, { topic, subject: String(r.subject ?? ""), masteries: [m] });
      }
    }

    const weak: WeakTopic[] = [];
    for (const g of groups.values()) {
      const attempts = g.masteries.length;
      const avg = g.masteries.reduce((a, b) => a + b, 0) / attempts;
      const first = g.masteries[0]!;
      const last = g.masteries[attempts - 1]!;
      let trend: TopicTrend = "flat";
      if (attempts >= 2) {
        if (last - first > 0.1) trend = "improving";
        else if (first - last > 0.1) trend = "declining";
      }
      const isWeak = avg < 0.6 || (attempts >= 2 && last < 0.6);
      if (isWeak) {
        weak.push({
          topic: g.topic,
          subject: g.subject,
          attempts,
          avg_mastery: Math.round(avg * 100) / 100,
          last_mastery: Math.round(last * 100) / 100,
          trend,
        });
      }
    }
    weak.sort((a, b) => a.avg_mastery - b.avg_mastery);

    const signals: StudySignals = { weak_topics: weak.slice(0, 5) };
    cache.set(key, { signals, expiresAt: Date.now() + 3_600_000 });
    return signals;
  } catch {
    return EMPTY;
  } finally {
    clearTimeout(timer);
  }
}

export function formatStudySignalsForContext(signals: StudySignals): string {
  if (!signals.weak_topics || signals.weak_topics.length === 0) return "";
  const lines = ["Topics the student is struggling with (suggest a quick review if relevant — don't nag):"];
  for (const w of signals.weak_topics) {
    const trendText = w.trend === "improving"
      ? "improving"
      : w.trend === "declining"
        ? "getting worse"
        : "not improving";
    const subj = w.subject ? ` (${w.subject})` : "";
    const plural = w.attempts === 1 ? "quiz" : "quizzes";
    lines.push(`- ${w.topic}${subj}: ${w.attempts} ${plural}, avg ${Math.round(w.avg_mastery * 100)}%, ${trendText}`);
  }
  return lines.join("\n");
}
