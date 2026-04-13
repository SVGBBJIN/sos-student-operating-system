/**
 * useSettings — reads and writes per-user settings from the Supabase profiles table.
 *
 * Settings are loaded once on mount and cached in state.
 * updateSetting(key, value) performs an optimistic local update then persists to Supabase.
 *
 * useAgenticMode() is a convenience hook wrapping useSettings() for the agentic_mode flag.
 */

import { useState, useEffect, useCallback } from "react";
import { sb } from "../lib/supabase.js";

const DEFAULT_SETTINGS = {
  agentic_mode: true,
  google_permissions_acknowledged: false,
};

/**
 * @returns {{ settings: Record<string, unknown>, updateSetting: Function, loading: boolean }}
 */
export function useSettings() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);

  // Resolve current user ID
  useEffect(() => {
    sb.auth.getUser().then(({ data }) => {
      setUserId(data?.user?.id ?? null);
    });
  }, []);

  // Load settings from profiles table once user is known
  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    sb.from("profiles")
      .select("agentic_mode, google_permissions_acknowledged")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) console.warn("useSettings load error:", error.message);
        if (data) {
          setSettings((prev) => ({
            ...prev,
            agentic_mode: data.agentic_mode ?? prev.agentic_mode,
            google_permissions_acknowledged:
              data.google_permissions_acknowledged ?? prev.google_permissions_acknowledged,
          }));
        }
      })
      .finally(() => setLoading(false));
  }, [userId]);

  /**
   * Optimistically updates a setting locally and persists to Supabase.
   * @param {string} key
   * @param {unknown} value
   */
  const updateSetting = useCallback(
    async (key, value) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
      if (!userId) return;
      try {
        const { error } = await sb
          .from("profiles")
          .update({ [key]: value })
          .eq("id", userId);
        if (error) throw error;
      } catch (err) {
        console.warn("useSettings persist error:", err.message);
        // Revert optimistic update on failure
        setSettings((prev) => ({ ...prev, [key]: !value }));
      }
    },
    [userId]
  );

  return { settings, updateSetting, loading };
}

/**
 * useAgenticMode — convenience hook for the agentic_mode setting.
 * @returns {{ agenticMode: boolean, setAgenticMode: (val: boolean) => void, loading: boolean }}
 */
export function useAgenticMode() {
  const { settings, updateSetting, loading } = useSettings();
  return {
    agenticMode: settings.agentic_mode ?? true,
    setAgenticMode: (val) => updateSetting("agentic_mode", Boolean(val)),
    loading,
  };
}
