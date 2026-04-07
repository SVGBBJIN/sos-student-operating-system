import React, { useState, useRef, useEffect, useCallback } from 'react';
import { sb, EDGE_FN_URL, SUPABASE_ANON_KEY } from '../../lib/supabase.js';
import { getModeConfig } from '../../lib/tutorModeConfig.js';
import {
  parseSocraticResponse,
  parseInterpretationButtons,
  extractSynthesis,
  parseSessionComplete,
  createSessionTracker,
} from '../../lib/skillHubUtils.js';
import SocraticButtons from './SocraticButtons.jsx';

const PHOTO_SYSTEM_PROMPT = `A student has uploaded an image of a homework problem, equation, or document.

Step 1 — Identify what is in the image specifically. Be concrete:
"I see a quadratic equation: x² + 5x + 6 = 0"
"I see an essay prompt about the causes of World War I"
"I see a chemistry stoichiometry problem"
"I see a vocabulary list"

Step 2 — Confirm with the student:
"Is that right? If so, I'll help you work through it."

Step 3 — Once confirmed, select the tutor mode:
Math / Science / CS / equation / formula → Cause & Effect (Socratic step-by-step)
Essay / document / argument / opinion → Interpretation (intellectual sparring)
Vocabulary / dates / definitions → Study (active recall)

Step 4 — State which mode you're entering, then begin the Socratic sequence for that mode.
DO NOT solve the problem directly.

If the image is unclear: "I can't make out the problem clearly — can you retake it with better lighting, or type it below?"`;

function buildContextPrompt(tasks, notes, linkedTask) {
  const lines = [];
  if (linkedTask) {
    lines.push(`CURRENT TASK: ${linkedTask.title}${linkedTask.subject ? ` (${linkedTask.subject})` : ''}`);
    if (linkedTask.dueDate) lines.push(`DUE: ${linkedTask.dueDate}`);
  }
  const activeTasks = tasks.filter(t => t.status !== 'done').slice(0, 5);
  if (activeTasks.length) {
    lines.push('ACTIVE TASKS: ' + activeTasks.map(t => t.title).join(', '));
  }
  if (notes.length) {
    lines.push(`NOTES AVAILABLE: ${notes.map(n => n.name).join(', ')}`);
  }
  return lines.join('\n');
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function SkillHubChat({ activeMode, linkedTask, tasks, notes, user, onSessionSave }) {
  const modeConfig = getModeConfig(activeMode);

  const [messages, setMessages]       = useState([]);
  const [input, setInput]             = useState('');
  const [isLoading, setIsLoading]     = useState(false);
  const [sessionTracker]              = useState(() => createSessionTracker());
  const [sessionComplete, setSessionComplete] = useState(null);
  const [pendingPhoto, setPendingPhoto] = useState(null); // { base64, mimeType, objectUrl }

  const messagesEndRef = useRef(null);
  const textareaRef    = useRef(null);
  const fileInputRef   = useRef(null);
  const sessionStartRef = useRef(Date.now());
  const prevModeRef    = useRef(activeMode);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Clear chat on mode switch
  useEffect(() => {
    if (prevModeRef.current !== activeMode) {
      prevModeRef.current = activeMode;
      setMessages([]);
      setSessionComplete(null);
      setPendingPhoto(null);
      sessionStartRef.current = Date.now();
    }
  }, [activeMode]);

  // Auto-focus textarea
  useEffect(() => { textareaRef.current?.focus(); }, [activeMode]);

  // Add welcome message on first render or when linked task changes
  useEffect(() => {
    if (messages.length > 0) return;
    const cfg = getModeConfig(activeMode);
    let welcome = '';
    if (linkedTask) {
      welcome = `${cfg.icon} Ready to work on **${linkedTask.title}**. ${getModeWelcome(activeMode)}`;
    } else {
      welcome = `${cfg.icon} ${getModeWelcome(activeMode)}`;
    }
    setMessages([{ role: 'assistant', content: welcome, timestamp: Date.now() }]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedTask]);

  function getModeWelcome(mode) {
    if (mode === 'cause-effect') return "I'll walk you through problems step by step. What are you working on?";
    if (mode === 'interpretation') return "Bring me an argument or idea and I'll challenge it — to help you sharpen your thinking.";
    return "Tell me what to quiz you on and I'll start testing you right away.";
  }

  // ── Photo Upload ────────────────────────────────────────────────────────────
  async function handlePhotoFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => {
      const dataUrl = e.target.result;
      const base64 = dataUrl.split(',')[1];
      setPendingPhoto({ base64, mimeType: file.type, objectUrl: dataUrl });
    };
    reader.readAsDataURL(file);
  }

  // ── Send Message ────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text, photoOverride) => {
    const msgContent = (text || input).trim();
    const photo = photoOverride || pendingPhoto;
    if (!msgContent && !photo) return;
    if (isLoading) return;

    const userMsg = {
      role: 'user',
      content: msgContent,
      timestamp: Date.now(),
      photoUrl: photo?.objectUrl || null,
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setPendingPhoto(null);
    setIsLoading(true);

    const contextPrompt = buildContextPrompt(tasks, notes, linkedTask);
    const systemPrompt = photo
      ? PHOTO_SYSTEM_PROMPT
      : `${modeConfig.systemPrompt}\n\n${contextPrompt ? 'STUDENT CONTEXT:\n' + contextPrompt : ''}`;

    const history = [...messages, userMsg]
      .slice(-12)
      .map(m => ({ role: m.role, content: m.content || '' }))
      .filter(m => m.content);

    try {
      const session = await sb.auth.getSession();
      const token   = session?.data?.session?.access_token;

      const body = {
        systemPrompt,
        messages:   history,
        maxTokens:  2048,
        isContentGen: false,
        streaming:  !photo,
        ...(photo ? { imageBase64: photo.base64, imageMimeType: photo.mimeType } : {}),
      };

      const res = await fetch(EDGE_FN_URL, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + (token || SUPABASE_ANON_KEY),
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error('Request failed: ' + res.status);

      let finalContent = '';

      if (!photo && res.headers.get('content-type')?.includes('text/event-stream')) {
        // Streaming path
        const streamTs = Date.now();
        setMessages(prev => [...prev, { role: 'assistant', content: '', timestamp: streamTs, streaming: true }]);
        setIsLoading(false);

        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith('data: ')) continue;
            const raw = t.slice(6).trim();
            if (!raw) continue;
            let evt;
            try { evt = JSON.parse(raw); } catch (_) { continue; }
            if (evt.type === 'text_delta') {
              finalContent += evt.delta;
              setMessages(prev => prev.map(m =>
                m.timestamp === streamTs ? { ...m, content: finalContent } : m
              ));
            } else if (evt.type === 'done') {
              finalContent = (evt.content || finalContent).trim();
              break outer;
            }
          }
        }

        const processed = processAIResponse(finalContent, activeMode, sessionTracker);
        setMessages(prev => prev.map(m =>
          m.timestamp === streamTs ? { ...m, ...processed, streaming: false } : m
        ));
        if (processed.sessionComplete) setSessionComplete(processed.sessionComplete);
      } else {
        // Non-streaming (photos)
        const data = await res.json();
        finalContent = (data.content || data.message || '').trim();
        setIsLoading(false);
        const processed = processAIResponse(finalContent, activeMode, sessionTracker);
        setMessages(prev => [...prev, { role: 'assistant', timestamp: Date.now(), ...processed }]);
        if (processed.sessionComplete) setSessionComplete(processed.sessionComplete);
      }
    } catch (err) {
      console.error('SkillHub chat error:', err);
      setIsLoading(false);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Something went wrong. Please try again.',
        timestamp: Date.now(),
      }]);
    }
  }, [input, pendingPhoto, isLoading, messages, modeConfig, activeMode, tasks, notes, linkedTask, sessionTracker]);

  // ── Process AI Response ─────────────────────────────────────────────────────
  function processAIResponse(raw, mode, tracker) {
    if (mode === 'cause-effect') {
      const { text, socratic } = parseSocraticResponse(raw);
      return { content: text, socratic };
    }
    if (mode === 'interpretation') {
      const { text: t1, synthesis } = extractSynthesis(raw);
      const { text, buttons } = parseInterpretationButtons(t1);
      return { content: text, interpretationButtons: buttons, synthesis };
    }
    if (mode === 'study') {
      const sessionComplete = parseSessionComplete(raw);
      if (sessionComplete) {
        if (onSessionSave) {
          onSessionSave({
            mode,
            subject: linkedTask?.subject || null,
            linkedTaskId: linkedTask?.id || null,
            startedAt: new Date(sessionStartRef.current).toISOString(),
            endedAt: new Date().toISOString(),
            ...tracker.toRecord(),
          });
        }
        return { content: raw, sessionComplete };
      }
      return { content: raw };
    }
    return { content: raw };
  }

  // ── Socratic button callbacks ───────────────────────────────────────────────
  function handleMCSelect(key, isCorrect) {
    if (isCorrect) {
      sessionTracker.recordCorrect();
      sendMessage(`I selected option ${key} — correct!`);
    } else {
      sessionTracker.recordIncorrect();
      sendMessage(`I selected option ${key}.`);
    }
  }

  function handleDefendSelect(text) {
    sendMessage(text);
  }

  function handleRecallSelect(action) {
    if (action === 'got-it') {
      sessionTracker.recordCorrect();
      sendMessage("Got it — I knew that. Next question please.");
    } else {
      sessionTracker.recordIncorrect();
      sendMessage("I missed it — please explain and ask me a similar question.");
    }
  }

  function handleHint() {
    sessionTracker.recordHint();
    sendMessage("Give me a hint for this question.");
  }

  function handleAnalogy() {
    sendMessage("Can you explain that with an analogy?");
  }

  // ── Keyboard ────────────────────────────────────────────────────────────────
  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // ── Auto-resize textarea ────────────────────────────────────────────────────
  function handleInputChange(e) {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }

  // ── Render messages ─────────────────────────────────────────────────────────
  function renderMessage(msg, i) {
    const isUser = msg.role === 'user';
    return (
      <div key={i} className={`sh-msg ${isUser ? 'sh-msg-user' : 'sh-msg-ai'}`}>
        <div>
          <div className={`sh-bubble ${isUser ? 'sh-bubble-user' : 'sh-bubble-ai'}${msg.streaming ? ' streaming' : ''}`}>
            {msg.photoUrl && (
              <img src={msg.photoUrl} alt="uploaded" className="sh-bubble-photo" />
            )}
            {msg.content && <span>{msg.content}</span>}
            {!isUser && <div className="sh-bubble-time">{formatTime(msg.timestamp)}</div>}
          </div>

          {/* Synthesis card for interpretation mode */}
          {msg.synthesis && (
            <div className="sh-synthesis-card">
              <div className="sh-synthesis-label">✦ Argument evolution</div>
              <div className="sh-synthesis-text">{msg.synthesis}</div>
            </div>
          )}

          {/* Socratic interactive buttons — only on the last AI message */}
          {!isUser && !msg.streaming && i === messages.length - 1 && !sessionComplete && (
            <>
              {msg.socratic && (
                <SocraticButtons
                  mode="cause-effect"
                  socratic={msg.socratic}
                  disabled={isLoading}
                  onSelect={handleMCSelect}
                  onHint={handleHint}
                  onAnalogy={handleAnalogy}
                />
              )}
              {msg.interpretationButtons && (
                <SocraticButtons
                  mode="interpretation"
                  buttons={msg.interpretationButtons}
                  disabled={isLoading}
                  onSelect={handleDefendSelect}
                />
              )}
              {activeMode === 'study' && !msg.socratic && !msg.interpretationButtons && !sessionComplete && (
                <SocraticButtons
                  mode="study"
                  disabled={isLoading}
                  onSelect={handleRecallSelect}
                  onHint={handleHint}
                />
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="sh-tab-panel chat-panel">
      <div className="sh-chat-wrap">
        {/* Header */}
        <div className="sh-chat-header">
          {linkedTask && (
            <span className="sh-chat-subject">
              {linkedTask.title}{linkedTask.subject ? ` · ${linkedTask.subject}` : ''}
            </span>
          )}
          <span className="sh-chat-mode-badge">
            {modeConfig.icon} {modeConfig.label}
          </span>
        </div>

        {/* Messages */}
        <div className="sh-messages">
          {messages.map((msg, i) => renderMessage(msg, i))}

          {isLoading && (
            <div className="sh-msg sh-msg-ai">
              <div className="sh-bubble sh-bubble-ai">
                <div className="sh-loading-wrap">
                  <div className="sh-loading-dot" />
                  <div className="sh-loading-dot" />
                  <div className="sh-loading-dot" />
                </div>
              </div>
            </div>
          )}

          {/* Session complete summary (Study mode) */}
          {sessionComplete && (
            <div className="sh-session-complete">
              <div className="sh-session-complete-title">📊 Session complete</div>
              <div className="sh-session-score">
                <span className="sh-session-score-item">
                  <strong>{sessionComplete.correct}</strong> correct
                </span>
                <span className="sh-session-score-item">
                  <strong>{sessionComplete.missed}</strong> missed
                </span>
              </div>
              {sessionComplete.reviewTopics.length > 0 && (
                <div className="sh-review-list">
                  <div style={{ fontSize: '0.78rem', color: 'var(--sh-text-dim)', marginBottom: 6 }}>
                    Review these again:
                  </div>
                  {sessionComplete.reviewTopics.map((t, i) => (
                    <div key={i} className="sh-review-item">• {t}</div>
                  ))}
                </div>
              )}
              <div className="sh-session-actions">
                <button
                  className="sh-btn sh-btn-primary"
                  onClick={() => {
                    setSessionComplete(null);
                    setMessages([]);
                    sessionStartRef.current = Date.now();
                  }}
                >
                  New session
                </button>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Photo preview */}
        {pendingPhoto && (
          <div style={{ padding: '8px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <img
              src={pendingPhoto.objectUrl}
              alt="pending"
              style={{ height: 48, borderRadius: 6, border: '1px solid var(--sh-border)' }}
            />
            <button
              className="sh-btn"
              style={{ fontSize: '0.74rem', padding: '4px 10px' }}
              onClick={() => setPendingPhoto(null)}
            >
              ✕ Remove
            </button>
          </div>
        )}

        {/* Input */}
        <div className="sh-chat-input-wrap">
          <div className="sh-chat-input-row">
            <button
              className="sh-photo-btn"
              title="Upload photo"
              onClick={() => fileInputRef.current?.click()}
            >
              📷
            </button>
            <textarea
              ref={textareaRef}
              className="sh-chat-textarea"
              rows={1}
              value={input}
              placeholder={getPlaceholder(activeMode)}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
            />
            <button
              className="sh-send-btn"
              disabled={isLoading || (!input.trim() && !pendingPhoto)}
              onClick={() => sendMessage()}
            >
              ➤
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={e => { if (e.target.files?.[0]) handlePhotoFile(e.target.files[0]); }}
          />
        </div>
      </div>
    </div>
  );
}

function getPlaceholder(mode) {
  if (mode === 'cause-effect') return 'Paste a problem or equation…';
  if (mode === 'interpretation') return 'Share your interpretation or argument…';
  return 'Tell me what to quiz you on…';
}
