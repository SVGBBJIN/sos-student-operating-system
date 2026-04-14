import React from "react";
import { sb } from "../lib/supabase.js";

const PERMISSIONS = [
  {
    icon: "📅",
    label: "Calendar",
    description: "We read your events to help you plan",
  },
  {
    icon: "📁",
    label: "Drive",
    description: "We can access files you share with us",
  },
  {
    icon: "👤",
    label: "Profile",
    description: "Your name and photo for your account",
  },
];

/**
 * GooglePermissionSummary — shown once after first Google sign-in.
 *
 * Props:
 *   show (boolean)         — whether to render the card
 *   onDismiss (function)   — called after the user taps "Got it"
 */
export default function GooglePermissionSummary({ show, onDismiss }) {
  if (!show) return null;

  async function handleDismiss() {
    try {
      const {
        data: { user },
      } = await sb.auth.getUser();
      if (user?.id) {
        await sb
          .from("profiles")
          .update({ google_permissions_acknowledged: true })
          .eq("id", user.id);
      }
    } catch (_) {}
    onDismiss?.();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Google permissions summary"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(6px)",
        animation: "overlayIn .2s ease",
      }}
    >
      <div
        style={{
          background: "var(--card, #1a1a2e)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 18,
          padding: "28px 28px 22px",
          maxWidth: 340,
          width: "90vw",
          boxShadow: "0 8px 48px rgba(0,0,0,0.6)",
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        <div>
          <div
            style={{
              fontWeight: 700,
              fontSize: "1rem",
              marginBottom: 4,
              color: "var(--text, #e2e8f0)",
            }}
          >
            Google connected
          </div>
          <div style={{ fontSize: "0.82rem", color: "var(--text-dim, #94a3b8)" }}>
            Here's what SOS can access with your permission:
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {PERMISSIONS.map(({ icon, label, description }) => (
            <div
              key={label}
              style={{ display: "flex", alignItems: "center", gap: 12 }}
            >
              <span style={{ fontSize: "1.3rem", flexShrink: 0 }}>{icon}</span>
              <div>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    color: "var(--text, #e2e8f0)",
                  }}
                >
                  {label}
                </div>
                <div
                  style={{ fontSize: "0.78rem", color: "var(--text-dim, #94a3b8)" }}
                >
                  {description}
                </div>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={handleDismiss}
          style={{
            marginTop: 4,
            padding: "10px 0",
            borderRadius: 10,
            border: "none",
            background: "var(--accent, #6c63ff)",
            color: "#fff",
            fontWeight: 600,
            fontSize: "0.9rem",
            cursor: "pointer",
            width: "100%",
          }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}
