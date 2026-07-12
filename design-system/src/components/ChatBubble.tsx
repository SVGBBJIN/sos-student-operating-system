import React from 'react';

export interface UserBubbleProps {
  /** Message text. */
  text: React.ReactNode;
  /** Small timestamp shown under the bubble. */
  time?: string;
}

/** Right-aligned chat bubble for the student's own messages. */
export function UserBubble({ text, time }: UserBubbleProps) {
  return (
    <div className="sos-ds-msg-row sos-ds-msg-row--user">
      <div className="sos-ds-bubble sos-ds-bubble--user">
        {text}
        {time && <div className="sos-ds-bubble-time">{time}</div>}
      </div>
    </div>
  );
}

export interface AiBubbleProps {
  /** Message text. Ignored while `loading` is true. */
  text?: React.ReactNode;
  time?: string;
  /** Shows an animated typing indicator instead of `text`. */
  loading?: boolean;
  /** Extra content rendered below the text, e.g. an action card. */
  children?: React.ReactNode;
}

/** Left-aligned chat bubble for AI responses, with an optional loading state. */
export function AiBubble({ text, time, loading, children }: AiBubbleProps) {
  return (
    <div className="sos-ds-msg-row sos-ds-msg-row--ai">
      <div className="sos-ds-bubble sos-ds-bubble--ai">
        {loading ? (
          <div className="sos-ds-loading-dots">
            <span />
            <span />
            <span />
          </div>
        ) : (
          <>
            <div>{text}</div>
            {children && <div className="sos-ds-bubble-extra">{children}</div>}
            {time && <div className="sos-ds-bubble-time">{time}</div>}
          </>
        )}
      </div>
    </div>
  );
}

export interface HistorySeparatorProps {
  /** Label centered in the divider, e.g. "Yesterday". */
  label: React.ReactNode;
}

/** Horizontal-rule divider with a centered label, used to break up chat history by day. */
export function HistorySeparator({ label }: HistorySeparatorProps) {
  return (
    <div className="sos-ds-history-separator">
      <div className="sos-ds-history-separator-line" />
      <span className="sos-ds-history-separator-label">{label}</span>
      <div className="sos-ds-history-separator-line" />
    </div>
  );
}
