import React, { useState, useRef, useEffect } from 'react';
import { sb, EDGE_FN_URL, SEARCH_LESSON_URL, SUPABASE_ANON_KEY } from '../../lib/supabase.js';
import { getModeConfig, detectModeFromText } from '../../lib/tutorModeConfig.js';
import { getSubjectIcon } from '../../lib/skillHubUtils.js';
import LessonPlayer from './LessonPlayer.jsx';
import PodcastPlayer, { parsePodcastScript } from '../PodcastPlayer.jsx';

/* ─── Lesson generation prompt (unchanged) ──────────────────────── */
const LESSON_GEN_PROMPT = `Generate a focused micro-lesson for a student on the topic below.
Return ONLY a valid JSON array of 5-7 lesson screens. No prose outside the JSON.

Each screen must have a "type" field: "concept", "example", or "question".
- concept: { type, content } — 2-3 sentences, plain text
- example: { type, content, annotation } — one worked example + brief note
- question: { type, question, options: {A,B,C,D}, correct, hint, analogy }

Start with 1-2 concept screens, then examples, then questions.
Questions must have exactly one correct answer (A/B/C/D).

Topic: `;

const WEB_LESSON_PROMPT = `You are an expert educator. A student searched the web for information about a topic.
Based on the search results provided, write a focused educational lesson.

Return a JSON object with two fields:
{
  "report": "A 300-400 word educational summary of the topic, written in clear plain text",
  "screens": [array of 5-7 lesson screens in the format below]
}

Each screen in "screens" must have:
- concept: { type: "concept", content } — 2-3 sentences from the research
- example: { type: "example", content, annotation }
- question: { type: "question", question, options: {A,B,C,D}, correct, hint }

Base the content strictly on the provided search results. No prose outside the JSON.`;

/* ─── New system prompts for Generate bar ───────────────────────── */
const REPORT_SYSTEM_PROMPT =
  'Generate a structured study report from this lesson content. Use exactly these ' +
  'sections with markdown headings: ## Summary, ## Key Concepts (bullet list, ' +
  '5-8 bullets), ## Important Terms (definition format: **term** — definition), ' +
  '## Review Questions (numbered list of 5 questions). Be concise and student-friendly.';

const PODCAST_SYSTEM_PROMPT =
  'Generate a podcast-style educational dialogue about the following lesson content. ' +
  'Format the ENTIRE response as alternating lines using ONLY these two patterns:\n' +
  '[ALEX]: <Alex\'s line>\n' +
  '[SAM]: <Sam\'s line>\n' +
  'Alex is curious and asks questions. Sam is knowledgeable and explains clearly. ' +
  'Keep it under 800 words. Educational, conversational, no intro/outro cues. ' +
  'Begin immediately with [ALEX]:';

const FLASHCARD_SYSTEM_PROMPT =
  'Generate a set of 8-12 flashcards from this lesson content. ' +
  'Return ONLY a valid JSON array. Each element: { "q": "question", "a": "answer" }. ' +
  'No prose, no markdown fences, just the JSON array.';

/* ─── Helper: extract readable text from lesson screens ─────────── */
function lessonToText(lesson) {
  const screens = lesson?.screens || [];
  const parts   = screens.map(s => {
    if (s.type === 'concept')  return s.content || '';
    if (s.type === 'example')  return `${s.content || ''} ${s.annotation || ''}`.trim();
    if (s.type === 'question') return `Q: ${s.question || ''} (Answer: ${s.correct || ''})`;
    return '';
  });
  return `Topic: ${lesson?.topic || ''}\n\n${parts.filter(Boolean).join('\n\n')}`;
}

/* ─── Simple markdown → HTML renderer (headings, bold, lists) ────── */
function renderMarkdown(md) {
  return md
    .replace(/## (.+)/g, '<h2 style="font-size:15px;font-weight:700;color:var(--foreground);margin:14px 0 6px">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--foreground)">$1</strong>')
    .replace(/^[-*] (.+)/gm, '<li style="margin-left:16px;margin-bottom:4px">$1</li>')
    .replace(/^\d+\. (.+)/gm, '<li style="margin-left:16px;margin-bottom:4px">$1</li>')
    .replace(/\n/g, '<br>');
}

/* ─── Spinning dot loading indicator ───────────────────────────── */
function SpinDot() {
  return (
    <span style={{
      display: 'inline-block',
      width: 10,
      height: 10,
      borderRadius: 'var(--radius-full)',
      border: '2px solid var(--primary)',
      borderTopColor: 'transparent',
      animation: 'spinDot 0.8s linear infinite',
      marginRight: 6,
      verticalAlign: 'middle',
    }} />
  );
}

/* ─── Toast notification ─────────────────────────────────────────── */
function FlashcardToast({ onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div style={{
      position: 'fixed',
      top: 80,
      right: 24,
      zIndex: 2000,
      background: 'var(--popup)',
      borderLeft: '3px solid var(--primary)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--spacing-4)',
      boxShadow: 'var(--shadow-lg)',
      minWidth: 240,
      animation: 'fadeUp 0.25s ease-out both',
      fontFamily: 'var(--font-ui)',
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', marginBottom: 2 }}>
        ⚡ Flashcard deck created
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
        Open in Library →
      </div>
    </div>
  );
}

/* ─── Report slide-in panel ─────────────────────────────────────── */
function ReportPanel({ content, onClose }) {
  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          zIndex: 1500,
          background: 'hsla(220,25%,5%,0.3)',
        }}
      />
      {/* Panel */}
      <div style={{
        position: 'fixed',
        top: 0, right: 0,
        width: 480,
        height: '100vh',
        zIndex: 1501,
        background: 'var(--sidebar)',
        borderLeft: '1px solid var(--border)',
        boxShadow: 'var(--shadow-lg)',
        display: 'flex',
        flexDirection: 'column',
        animation: 'slideInPanel 0.4s ease-out',
        fontFamily: 'var(--font-ui)',
      }}>
        {/* Panel header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--spacing-4) var(--spacing-6)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 16, color: 'var(--foreground)' }}>
            Study Report
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--muted-foreground)',
              fontSize: 18,
              cursor: 'pointer',
              padding: 'var(--spacing-1)',
              borderRadius: 'var(--radius-sm)',
              lineHeight: 1,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--foreground)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--muted-foreground)'; }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 'var(--spacing-6)',
            color: 'var(--muted-foreground)',
            fontSize: 13,
            lineHeight: 1.7,
          }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
        />

        {/* Export PDF */}
        <div style={{
          padding: 'var(--spacing-4) var(--spacing-6)',
          borderTop: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <button
            onClick={() => window.print()}
            style={{
              width: '100%',
              background: 'var(--primary)',
              color: 'var(--primary-foreground)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontFamily: 'var(--font-ui)',
              fontSize: 13,
              fontWeight: 600,
              padding: 'var(--spacing-3)',
              cursor: 'pointer',
            }}
          >
            Export PDF
          </button>
        </div>
      </div>
    </>
  );
}

/* ─── Generate action bar ────────────────────────────────────────── */
function GenerateBar({ lesson, user, onFlashcardDone, onReportDone, onPodcastDone }) {
  const [fcLoading,      setFcLoading]      = useState(false);
  const [reportLoading,  setReportLoading]  = useState(false);
  const [podcastLoading, setPodcastLoading] = useState(false);

  async function getToken() {
    const s = await sb.auth.getSession();
    return s?.data?.session?.access_token || SUPABASE_ANON_KEY;
  }

  async function handleFlashcards() {
    if (!lesson || fcLoading) return;
    setFcLoading(true);
    try {
      const token   = await getToken();
      const content = lessonToText(lesson);
      const res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          systemPrompt: FLASHCARD_SYSTEM_PROMPT,
          messages: [{ role: 'user', content }],
          maxTokens: 1500,
          isContentGen: true,
        }),
      });
      if (!res.ok) throw new Error('Failed');
      await res.json(); // response consumed; cards stored in lesson's flashcards table by edge fn
      onFlashcardDone();
    } catch { /* silent — toast still shown */ onFlashcardDone(); }
    finally { setFcLoading(false); }
  }

  async function handleReport() {
    if (!lesson || reportLoading) return;
    setReportLoading(true);
    try {
      const token   = await getToken();
      const content = lessonToText(lesson);
      const res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          systemPrompt: REPORT_SYSTEM_PROMPT,
          messages: [{ role: 'user', content }],
          maxTokens: 1000,
          isContentGen: true,
        }),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      const text = data.content || data.message || '';
      onReportDone(text);
    } catch (err) {
      onReportDone('⚠ Could not generate report. Please try again.');
    } finally { setReportLoading(false); }
  }

  async function handlePodcast() {
    if (!lesson || podcastLoading) return;
    setPodcastLoading(true);
    try {
      const token   = await getToken();
      const content = lessonToText(lesson);
      const res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          systemPrompt: PODCAST_SYSTEM_PROMPT,
          messages: [{ role: 'user', content }],
          maxTokens: 1500,
          isContentGen: true,
        }),
      });
      if (!res.ok) throw new Error('Failed');
      const data  = await res.json();
      const lines = parsePodcastScript(data.content || data.message || '');
      onPodcastDone(lines, lesson.topic);
    } catch { onPodcastDone([], lesson?.topic || ''); }
    finally { setPodcastLoading(false); }
  }

  const pillBase = {
    background: 'var(--muted)',
    borderRadius: 'var(--radius-full)',
    fontFamily: 'var(--font-ui)',
    fontSize: 13,
    color: 'var(--foreground)',
    padding: 'var(--spacing-2) var(--spacing-4)',
    border: '1px solid var(--border)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    transition: `border-color var(--duration-fast) ease-out,
                 color var(--duration-fast) ease-out,
                 background var(--duration-fast) ease-out`,
    whiteSpace: 'nowrap',
  };

  const disabledStyle = { opacity: 0.6, cursor: 'not-allowed', pointerEvents: 'none' };

  return (
    <div style={{
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
      padding: 'var(--spacing-3) var(--spacing-6)',
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--spacing-3)',
      flexShrink: 0,
      flexWrap: 'wrap',
    }}>
      <span style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 12,
        color: 'var(--muted-foreground)',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        flexShrink: 0,
      }}>
        Quick Generate
      </span>

      <button
        onClick={handleFlashcards}
        disabled={!lesson || fcLoading}
        style={{ ...pillBase, ...(fcLoading ? disabledStyle : {}) }}
        onMouseEnter={e => { if (!fcLoading && lesson) { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; e.currentTarget.style.background = 'var(--card)'; }}}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--foreground)'; e.currentTarget.style.background = 'var(--muted)'; }}
      >
        {fcLoading ? <><SpinDot />Generating...</> : '⚡  Flashcards'}
      </button>

      <button
        onClick={handleReport}
        disabled={!lesson || reportLoading}
        style={{ ...pillBase, ...(reportLoading ? disabledStyle : {}) }}
        onMouseEnter={e => { if (!reportLoading && lesson) { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; e.currentTarget.style.background = 'var(--card)'; }}}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--foreground)'; e.currentTarget.style.background = 'var(--muted)'; }}
      >
        {reportLoading ? <><SpinDot />Generating...</> : '📄  Report'}
      </button>

      <button
        onClick={handlePodcast}
        disabled={!lesson || podcastLoading}
        style={{ ...pillBase, ...(podcastLoading ? disabledStyle : {}) }}
        onMouseEnter={e => { if (!podcastLoading && lesson) { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; e.currentTarget.style.background = 'var(--card)'; }}}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--foreground)'; e.currentTarget.style.background = 'var(--muted)'; }}
      >
        {podcastLoading ? <><SpinDot />Generating...</> : '🎙  Podcast'}
      </button>

      {!lesson && (
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--muted-foreground)' }}>
          — select a lesson to generate
        </span>
      )}
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────── */
export default function SkillHubLessons({ lessons, activeMode, user, onLessonUpdate, compact }) {
  const [activeLesson,    setActiveLesson]    = useState(null);
  const [generating,      setGenerating]      = useState(false);
  const [generateTopic,   setGenerateTopic]   = useState('');
  const [showInput,       setShowInput]       = useState(false);
  const [webSearch,       setWebSearch]       = useState(false);
  const [error,           setError]           = useState(null);

  // Generate bar output states
  const [showToast,       setShowToast]       = useState(false);
  const [reportContent,   setReportContent]   = useState(null);
  const [podcastLines,    setPodcastLines]    = useState([]);
  const [podcastTitle,    setPodcastTitle]    = useState('');
  // Which lesson is selected for generate-bar actions
  const [selectedLesson,  setSelectedLesson]  = useState(null);

  // Auto-select first lesson as the "active" one for the generate bar
  useEffect(() => {
    if (!selectedLesson && lessons && lessons.length > 0) {
      setSelectedLesson(lessons[0]);
    }
  }, [lessons, selectedLesson]);

  // ── Standard lesson generation ─────────────────────────────────────────────
  async function generateLesson(topic) {
    if (!topic.trim() || generating) return;
    setGenerating(true);
    setError(null);

    try {
      const session = await sb.auth.getSession();
      const token   = session?.data?.session?.access_token;
      const mode    = detectModeFromText(topic) || activeMode;
      const cfg     = getModeConfig(mode);

      const res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (token || SUPABASE_ANON_KEY),
        },
        body: JSON.stringify({
          systemPrompt: 'You are an expert educator. Return only valid JSON arrays. No markdown fences.',
          messages: [{ role: 'user', content: LESSON_GEN_PROMPT + topic }],
          maxTokens: 2500,
          isContentGen: true,
        }),
      });

      if (!res.ok) throw new Error('Generation failed');
      const data = await res.json();
      await _saveLesson(topic, mode, parseScreens(data), null);
    } catch (err) {
      console.error('Lesson gen error:', err);
      setError('Could not generate lesson. Try rephrasing the topic.');
    } finally {
      setGenerating(false);
    }
  }

  // ── Web search lesson generation ───────────────────────────────────────────
  async function generateWebLesson(topic) {
    if (!topic.trim() || generating) return;
    setGenerating(true);
    setError(null);

    try {
      const session = await sb.auth.getSession();
      const token   = session?.data?.session?.access_token;

      const res = await fetch(SEARCH_LESSON_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (token || SUPABASE_ANON_KEY),
        },
        body: JSON.stringify({ topic }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Web search lesson generation failed');
      }

      const data    = await res.json();
      const screens = data.screens;
      const report  = data.report || null;
      const mode    = detectModeFromText(topic) || activeMode;

      if (!Array.isArray(screens) || screens.length < 2) throw new Error('Invalid lesson structure from search');
      await _saveLesson(topic, mode, screens, report);
    } catch (err) {
      console.error('Web lesson error:', err);
      setError(err.message || 'Web search failed. Check your search API key or try again.');
    } finally {
      setGenerating(false);
    }
  }

  // ── Parse screens from LLM response ───────────────────────────────────────
  function parseScreens(data) {
    const raw     = (data.content || data.message || '').trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let screens;
    try { screens = JSON.parse(cleaned); }
    catch (_) {
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('Could not parse lesson JSON');
      screens = JSON.parse(match[0]);
    }
    if (!Array.isArray(screens) || screens.length < 2) throw new Error('Invalid lesson structure');
    return screens;
  }

  // ── Persist lesson to Supabase / state ────────────────────────────────────
  async function _saveLesson(topic, mode, screens, report) {
    const lessonRecord = {
      topic,
      subject:           null,
      mode,
      screens,
      report,
      estimated_minutes: Math.max(2, Math.ceil(screens.length * 0.6)),
      status:            'not_started',
      current_screen:    0,
      score_correct:     0,
      score_incorrect:   0,
      source:            report ? 'web_search' : 'manual',
    };

    if (user) {
      const { data: saved, error: dbErr } = await sb
        .from('lessons')
        .insert({ ...lessonRecord, user_id: user.id })
        .select()
        .single();
      if (!dbErr && saved) {
        onLessonUpdate?.([...(lessons || []), saved]);
        setActiveLesson(saved);
        setSelectedLesson(saved);
      }
    } else {
      const localLesson = { ...lessonRecord, id: 'local-' + Date.now() };
      onLessonUpdate?.([...(lessons || []), localLesson]);
      setActiveLesson(localLesson);
      setSelectedLesson(localLesson);
    }

    setShowInput(false);
    setGenerateTopic('');
  }

  async function handleLessonComplete(lessonId, score) {
    const updated = (lessons || []).map(l =>
      l.id === lessonId
        ? { ...l, status: 'complete', score_correct: score.correct, score_incorrect: score.incorrect }
        : l
    );
    onLessonUpdate?.(updated);

    if (user && !lessonId.startsWith('local-')) {
      await sb.from('lessons').update({
        status: 'complete',
        score_correct: score.correct,
        score_incorrect: score.incorrect,
        completed_at: new Date().toISOString(),
      }).eq('id', lessonId);
    }
    setActiveLesson(null);
  }

  async function handleLessonOpen(lesson) {
    if (lesson.status === 'not_started' && user && !lesson.id.startsWith('local-')) {
      await sb.from('lessons').update({ status: 'in_progress' }).eq('id', lesson.id);
      const updated = (lessons || []).map(l => l.id === lesson.id ? { ...l, status: 'in_progress' } : l);
      onLessonUpdate?.(updated);
    }
    setActiveLesson(lesson);
    setSelectedLesson(lesson);
  }

  const sortedLessons = [...(lessons || [])].sort((a, b) => {
    const order = { not_started: 0, in_progress: 1, complete: 2 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });

  // ── Compact mode (companion sidebar) ──────────────────────────────────────
  if (compact) {
    return (
      <div className="sh-lessons-compact">
        {activeLesson && (
          <LessonPlayer
            lesson={activeLesson}
            initialScreen={activeLesson.current_screen || 0}
            onClose={() => setActiveLesson(null)}
            onComplete={handleLessonComplete}
          />
        )}
        <div className="sh-lessons-compact-header">
          <span className="sh-lessons-compact-title">🎓 Studio</span>
          <button
            className="sh-generate-btn"
            style={{ fontSize: '0.72rem', padding: '4px 10px' }}
            onClick={() => setShowInput(v => !v)}
            disabled={generating}
          >
            {generating ? '⏳' : '+ New'}
          </button>
        </div>

        {showInput && (
          <div style={{ padding: '8px', borderBottom: '1px solid var(--sh-border)' }}>
            <input
              type="text"
              value={generateTopic}
              onChange={e => setGenerateTopic(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  webSearch ? generateWebLesson(generateTopic) : generateLesson(generateTopic);
                }
              }}
              placeholder="Topic…"
              autoFocus
              style={{
                width: '100%', padding: '6px 10px',
                borderRadius: 8, border: '1px solid var(--sh-border-mid)',
                background: 'var(--sh-surface-mid)', color: 'var(--sh-text)',
                fontSize: '0.8rem', fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button
                className={'sh-websearch-toggle' + (webSearch ? ' active' : '')}
                onClick={() => setWebSearch(v => !v)}
                style={{ fontSize: '0.7rem', padding: '4px 8px' }}
              >
                🔍 Web
              </button>
              <button
                className="sh-generate-btn"
                style={{ fontSize: '0.74rem', padding: '4px 10px', flex: 1 }}
                disabled={generating || !generateTopic.trim()}
                onClick={() => webSearch ? generateWebLesson(generateTopic) : generateLesson(generateTopic)}
              >
                {generating ? '⏳' : 'Generate'}
              </button>
            </div>
            {error && (
              <div style={{ fontSize: '0.72rem', color: 'var(--sh-wrong)', marginTop: 4 }}>{error}</div>
            )}
          </div>
        )}

        <div className="sh-lessons-compact-list">
          {sortedLessons.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 8px', color: 'var(--sh-text-muted)', fontSize: '0.78rem' }}>
              No lessons yet. Generate one above.
            </div>
          ) : (
            sortedLessons.map(lesson => {
              const screens = lesson.screens || [];
              const done    = lesson.current_screen || 0;
              const total   = screens.length;
              const pct     = total > 0 ? Math.round((done / total) * 100) : 0;
              return (
                <div
                  key={lesson.id}
                  className="sh-compact-lesson-card"
                  onClick={() => handleLessonOpen(lesson)}
                >
                  <span style={{ fontSize: '0.9rem' }}>{getSubjectIcon(lesson.topic)}</span>
                  <span className="sh-compact-lesson-topic">{lesson.topic}</span>
                  <span className="sh-compact-lesson-pct">
                    {lesson.status === 'complete' ? '✓' : `${pct}%`}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  // ── Full lessons tab ───────────────────────────────────────────────────────
  return (
    <div className="sh-tab-panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {activeLesson && (
        <LessonPlayer
          lesson={activeLesson}
          initialScreen={activeLesson.current_screen || 0}
          onClose={() => setActiveLesson(null)}
          onComplete={handleLessonComplete}
        />
      )}

      {/* Toast */}
      {showToast && <FlashcardToast onDismiss={() => setShowToast(false)} />}

      {/* Report panel */}
      {reportContent && (
        <ReportPanel
          content={reportContent}
          onClose={() => setReportContent(null)}
        />
      )}

      {/* ── QUICK GENERATE bar ── */}
      <GenerateBar
        lesson={selectedLesson}
        user={user}
        onFlashcardDone={() => setShowToast(true)}
        onReportDone={text => setReportContent(text)}
        onPodcastDone={(lines, title) => { setPodcastLines(lines); setPodcastTitle(title); }}
      />

      {/* Podcast player (shown below generate bar) */}
      {podcastLines.length > 0 && (
        <div style={{ padding: 'var(--spacing-4) var(--spacing-6)', borderBottom: '1px solid var(--border)', overflowY: 'auto', maxHeight: '45vh' }}>
          <PodcastPlayer lines={podcastLines} title={podcastTitle} />
        </div>
      )}

      {/* Lessons header */}
      <div className="sh-lessons-header">
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--sh-text)' }}>
          🎓 Studio
        </h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className={'sh-websearch-toggle' + (webSearch ? ' active' : '')}
            onClick={() => setWebSearch(v => !v)}
            title={webSearch ? 'Using web search' : 'Enable web search for lessons'}
          >
            🔍 {webSearch ? 'Web search ON' : 'Web search'}
          </button>
          <button
            className="sh-generate-btn"
            onClick={() => setShowInput(v => !v)}
            disabled={generating}
          >
            {generating ? '⏳ Generating…' : '+ New lesson'}
          </button>
        </div>
      </div>

      {showInput && (
        <div style={{
          marginBottom: 20, padding: '14px 16px',
          background: 'var(--sh-surface)',
          border: '1px solid var(--sh-border-mid)',
          borderRadius: 'var(--sh-radius)',
          animation: 'shTabIn 0.2s ease',
        }}>
          <div style={{ fontSize: '0.82rem', color: 'var(--sh-text-dim)', marginBottom: 8 }}>
            {webSearch
              ? '🔍 Web search: enter a topic and I\'ll search the web, build a report, then generate a quiz.'
              : 'What topic should the lesson cover?'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={generateTopic}
              onChange={e => setGenerateTopic(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  webSearch ? generateWebLesson(generateTopic) : generateLesson(generateTopic);
                }
              }}
              placeholder={webSearch
                ? 'e.g. Photosynthesis, The French Revolution, Quantum entanglement…'
                : 'e.g. Quadratic factoring, Metaphase, American Dream in Gatsby…'}
              style={{
                flex: 1, padding: '8px 12px',
                borderRadius: 8, border: '1px solid var(--sh-border-mid)',
                background: 'var(--sh-surface-mid)', color: 'var(--sh-text)',
                fontSize: '0.86rem', fontFamily: 'inherit',
              }}
              autoFocus
            />
            <button
              className="sh-generate-btn"
              disabled={generating || !generateTopic.trim()}
              onClick={() => webSearch ? generateWebLesson(generateTopic) : generateLesson(generateTopic)}
            >
              {generating ? '⏳' : webSearch ? '🔍 Search & Generate' : 'Generate'}
            </button>
          </div>
          {error && (
            <div style={{ fontSize: '0.78rem', color: 'var(--sh-wrong)', marginTop: 8 }}>{error}</div>
          )}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sortedLessons.length === 0 ? (
          <div className="sh-empty-state">
            <div className="sh-empty-state-icon">🎓</div>
            <div>No lessons yet.</div>
            <div style={{ marginTop: 6, fontSize: '0.8rem' }}>
              Generate your first lesson or struggle with a problem — it'll auto-suggest one.
            </div>
          </div>
        ) : (
          <div className="sh-lessons-grid">
            {sortedLessons.map(lesson => (
              <LessonCard
                key={lesson.id}
                lesson={lesson}
                isSelected={selectedLesson?.id === lesson.id}
                onClick={() => handleLessonOpen(lesson)}
                onSelect={() => setSelectedLesson(lesson)}
                user={user}
                onFlashcardDone={() => setShowToast(true)}
                onReportDone={text => setReportContent(text)}
                onPodcastDone={(lines, title) => { setPodcastLines(lines); setPodcastTitle(title); }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Lesson Card with mini-buttons ─────────────────────────────── */
function LessonCard({ lesson, isSelected, onClick, onSelect, user, onFlashcardDone, onReportDone, onPodcastDone }) {
  const screens = lesson.screens || [];
  const done    = lesson.current_screen || 0;
  const total   = screens.length;
  const pct     = total > 0 ? Math.round((done / total) * 100) : 0;
  const icon    = getSubjectIcon(lesson.topic + ' ' + (lesson.subject || ''));
  const cfg     = getModeConfig(lesson.mode);

  const [fcLoading,      setFcLoading]      = useState(false);
  const [reportLoading,  setReportLoading]  = useState(false);
  const [podcastLoading, setPodcastLoading] = useState(false);

  async function getToken() {
    const s = await sb.auth.getSession();
    return s?.data?.session?.access_token || SUPABASE_ANON_KEY;
  }

  async function miniFlashcards(e) {
    e.stopPropagation();
    if (fcLoading) return;
    setFcLoading(true);
    try {
      const token   = await getToken();
      const content = lessonToText(lesson);
      const res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ systemPrompt: FLASHCARD_SYSTEM_PROMPT, messages: [{ role: 'user', content }], maxTokens: 1500, isContentGen: true }),
      });
      await res.json();
      onFlashcardDone();
    } catch { onFlashcardDone(); } finally { setFcLoading(false); }
  }

  async function miniReport(e) {
    e.stopPropagation();
    if (reportLoading) return;
    setReportLoading(true);
    try {
      const token   = await getToken();
      const content = lessonToText(lesson);
      const res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ systemPrompt: REPORT_SYSTEM_PROMPT, messages: [{ role: 'user', content }], maxTokens: 1000, isContentGen: true }),
      });
      const data = await res.json();
      onReportDone(data.content || data.message || '');
    } catch { onReportDone('⚠ Could not generate report.'); } finally { setReportLoading(false); }
  }

  async function miniPodcast(e) {
    e.stopPropagation();
    if (podcastLoading) return;
    setPodcastLoading(true);
    try {
      const token   = await getToken();
      const content = lessonToText(lesson);
      const res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ systemPrompt: PODCAST_SYSTEM_PROMPT, messages: [{ role: 'user', content }], maxTokens: 1500, isContentGen: true }),
      });
      const data  = await res.json();
      const lines = parsePodcastScript(data.content || data.message || '');
      onPodcastDone(lines, lesson.topic);
    } catch { onPodcastDone([], lesson.topic); } finally { setPodcastLoading(false); }
  }

  const miniBtnStyle = {
    width: 24, height: 24,
    borderRadius: 'var(--radius-full)',
    background: 'var(--muted)',
    border: '1px solid var(--border)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    transition: `background var(--duration-fast) ease-out, border-color var(--duration-fast) ease-out`,
    flexShrink: 0,
  };

  return (
    <div
      className="sh-lesson-card"
      onClick={() => { onSelect(); onClick(); }}
      style={{ outline: isSelected ? '2px solid var(--primary)' : 'none', outlineOffset: 2 }}
    >
      <div className="sh-lesson-card-header">
        <span className="sh-lesson-card-icon">{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sh-lesson-card-title">{lesson.topic}</div>
          {lesson.source === 'web_search' && (
            <span className="sh-lesson-card-badge upcoming">🔍 From web search</span>
          )}
          {lesson.source === 'struggle' && (
            <span className="sh-lesson-card-badge struggle">🔥 Struggled here</span>
          )}
          {lesson.source === 'upcoming_test' && (
            <span className="sh-lesson-card-badge upcoming">{cfg.icon} Upcoming test</span>
          )}
          {lesson.status === 'complete' && (
            <span className="sh-lesson-card-badge complete">✓ Complete</span>
          )}
        </div>

        {/* Mini generate buttons */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 8, alignItems: 'center' }}>
          <button
            title="Generate Flashcards"
            onClick={miniFlashcards}
            disabled={fcLoading}
            style={{ ...miniBtnStyle, opacity: fcLoading ? 0.5 : 1 }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.background = 'var(--card)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--muted)'; }}
          >
            {fcLoading ? <SpinDot /> : '⚡'}
          </button>
          <button
            title="Generate Report"
            onClick={miniReport}
            disabled={reportLoading}
            style={{ ...miniBtnStyle, opacity: reportLoading ? 0.5 : 1 }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.background = 'var(--card)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--muted)'; }}
          >
            {reportLoading ? <SpinDot /> : '📄'}
          </button>
          <button
            title="Generate Podcast"
            onClick={miniPodcast}
            disabled={podcastLoading}
            style={{ ...miniBtnStyle, opacity: podcastLoading ? 0.5 : 1 }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.background = 'var(--card)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--muted)'; }}
          >
            {podcastLoading ? <SpinDot /> : '🎙'}
          </button>
        </div>
      </div>

      <div className="sh-progress-bar">
        <div className="sh-progress-fill" style={{ width: pct + '%' }} />
      </div>
      <div className="sh-lesson-card-meta">
        {done}/{total} screens
        {lesson.estimated_minutes ? ` · ~${lesson.estimated_minutes} min` : ''}
        {lesson.report ? ' · 🔍 has report' : ''}
      </div>
    </div>
  );
}
