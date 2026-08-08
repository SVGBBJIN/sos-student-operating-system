// Stale-while-revalidate cache for the per-user signal fetches.
//
// Both signal readers (behavioral.ts, study.ts) run on the critical path: their
// output is prompt content, so enrichDynamicContext must await them before the
// model call can start. A plain TTL cache means every expiry makes one unlucky
// turn eat the full REST round-trip (up to the 3s per-call budget) before the
// LLM even sees the request.
//
// SWR removes that: once a key has ever been populated, a request serves the
// cached value immediately and refreshes in the background. Only a genuinely
// cold key (new user, fresh function instance) waits on the fetch. Concurrent
// refreshes for the same key coalesce into one upstream call.
//
// Entries older than maxStaleMs are treated as cold rather than served — a
// week-old completion rate is worse than paying for one fetch.

interface Entry<T> {
  value: T;
  freshUntil: number;
  storedAt: number;
}

export interface SwrCache<T> {
  get(key: string, fetcher: () => Promise<T>): Promise<T>;
}

export function createSwrCache<T>(opts: {
  // Fixed TTL, or a resolver so a degraded/empty result can be cached briefly
  // (enough to absorb a burst) without pinning it for the full window.
  ttlMs: number | ((value: T) => number);
  maxStaleMs: number;
}): SwrCache<T> {
  const cache = new Map<string, Entry<T>>();
  const inflight = new Map<string, Promise<T>>();

  const ttlFor = (v: T) => (typeof opts.ttlMs === "function" ? opts.ttlMs(v) : opts.ttlMs);

  function refresh(key: string, fetcher: () => Promise<T>): Promise<T> {
    const existing = inflight.get(key);
    if (existing) return existing;
    const p = fetcher()
      .then((value) => {
        const now = Date.now();
        cache.set(key, { value, freshUntil: now + ttlFor(value), storedAt: now });
        return value;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, p);
    return p;
  }

  return {
    async get(key, fetcher) {
      const now = Date.now();
      const hit = cache.get(key);
      if (hit && hit.freshUntil > now) return hit.value;
      if (hit && now - hit.storedAt <= opts.maxStaleMs) {
        // Serve stale, refresh behind the request. A failed refresh keeps the
        // stale entry in place — it will be retried on the next turn.
        void refresh(key, fetcher).catch(() => {});
        return hit.value;
      }
      return refresh(key, fetcher);
    },
  };
}
