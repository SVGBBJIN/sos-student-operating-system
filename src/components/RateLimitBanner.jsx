import React, { useState, useEffect, useCallback } from "react";

const AUTO_DISMISS_MS = 60_000;

/**
 * RateLimitBanner — "Charles is resting" toast.
 *
 * Listens for the custom "sos:rate-limited" event dispatched by retryAI.js
 * when Groq returns a 429. Shown fixed at the bottom centre of the screen.
 * Auto-dismisses after 60 seconds.
 */
export default function RateLimitBanner() {
  const [visible, setVisible] = useState(false);

  const show = useCallback(() => {
    setVisible(true);
  }, []);

  useEffect(() => {
    window.addEventListener("sos:rate-limited", show);
    return () => window.removeEventListener("sos:rate-limited", show);
  }, [show]);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setVisible(false), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "rgba(20, 20, 30, 0.97)",
        border: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(12px)",
        color: "#e2e8f0",
        padding: "10px 18px",
        borderRadius: 14,
        boxShadow: "0 4px 32px rgba(0,0,0,0.5)",
        fontSize: "0.85rem",
        fontWeight: 500,
        maxWidth: "90vw",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontSize: "1.1rem" }}>🐙</span>
      <span>Charles is resting — AI is temporarily unavailable</span>
      <button
        onClick={() => setVisible(false)}
        aria-label="Dismiss"
        style={{
          marginLeft: 8,
          background: "none",
          border: "none",
          color: "rgba(255,255,255,0.5)",
          cursor: "pointer",
          fontSize: "1rem",
          lineHeight: 1,
          padding: "0 2px",
        }}
      >
        ×
      </button>
    </div>
  );
}
