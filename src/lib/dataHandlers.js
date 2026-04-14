/**
 * dataHandlers — lightweight, no-auth-required data fetchers.
 *
 * SEARCH_WEB  → Wikipedia summary API
 * GET_WEATHER → Open-Meteo (geocoding + forecast)
 * GET_NEWS    → GNews (requires VITE_GNEWS_TOKEN; degrades gracefully without it)
 *
 * All handlers are async and wrapped in try/catch — they never throw to the caller.
 */

const FETCH_TIMEOUT_MS = 3000;

function withTimeout(promise, ms = FETCH_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), ms)
    ),
  ]);
}

/* ─── Wikipedia Summary ─────────────────────────────────────────────────── */

/**
 * searchWikipedia — fetches the Wikipedia summary for a search term.
 * @param {string} query
 * @returns {Promise<{title: string, extract: string, thumbnail: string|null}>}
 */
export async function searchWikipedia(query) {
  try {
    const encoded = encodeURIComponent(query.trim());
    const res = await withTimeout(
      fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`, {
        headers: { Accept: "application/json" },
      })
    );
    if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
    const data = await res.json();
    return {
      title: data.title ?? query,
      extract: data.extract ?? "No summary available.",
      thumbnail: data.thumbnail?.source ?? null,
    };
  } catch (_) {
    return { title: query, extract: "No Wikipedia article found.", thumbnail: null };
  }
}

/* ─── Open-Meteo Weather ────────────────────────────────────────────────── */

const WMO_CONDITIONS = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Foggy", 48: "Icy fog",
  51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
  61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
  71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
  77: "Snow grains",
  80: "Slight showers", 81: "Moderate showers", 82: "Violent showers",
  85: "Slight snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Heavy thunderstorm",
};

/**
 * getWeather — fetches current weather for a city using Open-Meteo (no API key).
 * @param {string} city
 * @returns {Promise<{city: string, temp_c: number, condition: string, high_c: number, low_c: number}|{error: string}>}
 */
export async function getWeather(city) {
  try {
    // Step 1 — Geocode the city name
    const geoRes = await withTimeout(
      fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
      )
    );
    if (!geoRes.ok) throw new Error(`Geocoding ${geoRes.status}`);
    const geoData = await geoRes.json();
    const location = geoData.results?.[0];
    if (!location) return { error: `Could not find weather for "${city}".` };

    const { latitude, longitude, name, country } = location;

    // Step 2 — Fetch forecast
    const forecastRes = await withTimeout(
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
          `&current=temperature_2m,weather_code` +
          `&daily=temperature_2m_max,temperature_2m_min,weather_code` +
          `&temperature_unit=celsius&timezone=auto&forecast_days=1`
      )
    );
    if (!forecastRes.ok) throw new Error(`Open-Meteo ${forecastRes.status}`);
    const wx = await forecastRes.json();

    const temp_c = Math.round(wx.current?.temperature_2m ?? 0);
    const code = wx.current?.weather_code ?? 0;
    const high_c = Math.round(wx.daily?.temperature_2m_max?.[0] ?? temp_c);
    const low_c = Math.round(wx.daily?.temperature_2m_min?.[0] ?? temp_c);
    const condition = WMO_CONDITIONS[code] ?? "Unknown";

    return {
      city: `${name}${country ? ", " + country : ""}`,
      temp_c,
      condition,
      high_c,
      low_c,
    };
  } catch (_) {
    return { error: `Weather unavailable for "${city}". Try again later.` };
  }
}

/* ─── GNews ─────────────────────────────────────────────────────────────── */

/**
 * getNews — fetches recent news articles for a query via GNews.
 * Requires VITE_GNEWS_TOKEN env variable; degrades gracefully if absent.
 * @param {string} query
 * @returns {Promise<Array<{title: string, description: string, url: string, publishedAt: string}>|{message: string}>}
 */
export async function getNews(query) {
  const token = import.meta.env.VITE_GNEWS_TOKEN;
  if (!token) {
    return { message: "News unavailable — add VITE_GNEWS_TOKEN to your .env file." };
  }
  try {
    const url =
      `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&token=${token}&max=3&lang=en`;
    const res = await withTimeout(fetch(url), 5000);
    if (!res.ok) throw new Error(`GNews ${res.status}`);
    const data = await res.json();
    return (data.articles ?? []).map((a) => ({
      title: a.title,
      description: a.description,
      url: a.url,
      publishedAt: a.publishedAt,
    }));
  } catch (_) {
    return { message: `News search failed for "${query}". Try again later.` };
  }
}
