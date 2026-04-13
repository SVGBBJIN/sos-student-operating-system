/**
 * toolRouter — dispatches data-only tool actions directly to dataHandlers,
 * bypassing the AI pipeline for actions that don't require LLM reasoning.
 *
 * Recognized action names (matching ACTION_TOOLS in shared/ai/chat-core.js):
 *   "search_web"  → Wikipedia summary
 *   "get_weather" → Open-Meteo forecast
 *   "get_news"    → GNews search
 *
 * Returns null for unrecognised action names — caller falls through to AI pipeline.
 */

import { searchWikipedia, getWeather, getNews } from "./dataHandlers.js";

/**
 * @param {string} actionName  The tool/action name returned by the AI
 * @param {Record<string, unknown>} payload  The tool arguments
 * @returns {Promise<unknown|null>}  Resolved data, or null if not a data action
 */
export async function routeTool(actionName, payload = {}) {
  switch (actionName) {
    case "search_web":
      return searchWikipedia(String(payload.query ?? ""));

    case "get_weather":
      return getWeather(String(payload.city ?? ""));

    case "get_news":
      return getNews(String(payload.query ?? ""));

    default:
      return null;
  }
}
