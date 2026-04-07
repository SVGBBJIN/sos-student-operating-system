import React, { useState } from 'react';
import { sb, EDGE_FN_URL, SUPABASE_ANON_KEY } from '../../lib/supabase.js';
import { getModeConfig, detectModeFromText } from '../../lib/tutorModeConfig.js';
import { getSubjectIcon } from '../../lib/skillHubUtils.js';
import LessonPlayer from './LessonPlayer.jsx';

const LESSON_GEN_PROMPT = `Generate a focused micro-lesson for a student on the topic below.
Return ONLY a valid JSON array of 5-7 lesson screens. No prose outside the JSON.

Each screen must have a "type" field: "concept", "example", or "question".
- concept: { type, content } — 2-3 sentences, plain text
- example: { type, content, annotation } — one worked example + brief note
- question: { type, question, options: {A,B,C,D}, correct, hint, analogy }

Start with 1-2 concept screens, then examples, then questions.
Questions must have exactly one correct answer (A/B/C/D).

Topic: `;

export default function SkillHubLessons({ lessons, activeMode, user, onLessonUpdate }) {
  const [activeLesson, setActiveLesson]   = useState(null);  // lesson being played
  const [generating, setGenerating]       = useState(false);
  const [generateTopic, setGenerateTopic] = useState('');
  const [showInput, setShowInput]         = useState(false);
  const [error, setError]                 = useState(null);

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
      const raw  = (data.content || data.message || '').trim();

      // Strip possible markdown fences
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      let screens;
      try { screens = JSON.parse(cleaned); }
      catch (_) {
        // Try extracting JSON array from response
        const match = cleaned.match(/\[[\s\S]*\]/);
        if (!match) throw new Error('Could not parse lesson JSON');
        screens = JSON.parse(match[0]);
      }

      if (!Array.isArray(screens) || screens.length < 2) throw new Error('Invalid lesson structure');

      // Persist to Supabase if user is logged in
      const lessonRecord = {
        topic,
        subject:           null,
        mode,
        screens,
        estimated_minutes: Math.max(2, Math.ceil(screens.length * 0.6)),
        status:            'not_started',
        current_screen:    0,
        score_correct:     0,
        score_incorrect:   0,
        source:            'manual',
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
        }
      } else {
        // Guest — store in state only
        const localLesson = { ...lessonRecord, id: 'local-' + Date.now() };
        onLessonUpdate?.([...(lessons || []), localLesson]);
        setActiveLesson(localLesson);
      }

      setShowInput(false);
      setGenerateTopic('');
    } catch (err) {
      console.error('Lesson gen error:', err);
      setError('Could not generate lesson. Try rephrasing the topic.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleLessonComplete(lessonId, score) {
    const updated = lessons.map(l =>
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
    // Update status to in_progress if not already complete
    if (lesson.status === 'not_started' && user && !lesson.id.startsWith('local-')) {
      await sb.from('lessons').update({ status: 'in_progress' }).eq('id', lesson.id);
      const updated = lessons.map(l => l.id === lesson.id ? { ...l, status: 'in_progress' } : l);
      onLessonUpdate?.(updated);
    }
    setActiveLesson(lesson);
  }

  const sortedLessons = [...(lessons || [])].sort((a, b) => {
    // incomplete first, then by created_at desc
    const order = { not_started: 0, in_progress: 1, complete: 2 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });

  return (
    <div className="sh-tab-panel">
      {/* Fullscreen lesson player */}
      {activeLesson && (
        <LessonPlayer
          lesson={activeLesson}
          initialScreen={activeLesson.current_screen || 0}
          onClose={() => setActiveLesson(null)}
          onComplete={handleLessonComplete}
        />
      )}

      <div className="sh-lessons-header">
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--sh-text)' }}>
          📖 Lessons
        </h2>
        <button
          className="sh-generate-btn"
          onClick={() => setShowInput(v => !v)}
          disabled={generating}
        >
          {generating ? '⏳ Generating…' : '+ New lesson'}
        </button>
      </div>

      {/* Topic input */}
      {showInput && (
        <div style={{
          marginBottom: 20, padding: '14px 16px',
          background: 'var(--sh-surface)',
          border: '1px solid var(--sh-border-mid)',
          borderRadius: 'var(--sh-radius)',
          animation: 'shTabIn 0.2s ease',
        }}>
          <div style={{ fontSize: '0.82rem', color: 'var(--sh-text-dim)', marginBottom: 8 }}>
            What topic should the lesson cover?
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={generateTopic}
              onChange={e => setGenerateTopic(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') generateLesson(generateTopic); }}
              placeholder="e.g. Quadratic factoring, Metaphase, American Dream in Gatsby…"
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
              onClick={() => generateLesson(generateTopic)}
            >
              Generate
            </button>
          </div>
          {error && (
            <div style={{ fontSize: '0.78rem', color: 'var(--sh-wrong)', marginTop: 8 }}>{error}</div>
          )}
        </div>
      )}

      {/* Lesson grid */}
      {sortedLessons.length === 0 ? (
        <div className="sh-empty-state">
          <div className="sh-empty-state-icon">📖</div>
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
              onClick={() => handleLessonOpen(lesson)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LessonCard({ lesson, onClick }) {
  const screens = lesson.screens || [];
  const done    = lesson.current_screen || 0;
  const total   = screens.length;
  const pct     = total > 0 ? Math.round((done / total) * 100) : 0;
  const icon    = getSubjectIcon(lesson.topic + ' ' + (lesson.subject || ''));
  const cfg     = getModeConfig(lesson.mode);

  return (
    <div className="sh-lesson-card" onClick={onClick}>
      <div className="sh-lesson-card-header">
        <span className="sh-lesson-card-icon">{icon}</span>
        <div style={{ flex: 1 }}>
          <div className="sh-lesson-card-title">{lesson.topic}</div>
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
      </div>
      <div className="sh-progress-bar">
        <div className="sh-progress-fill" style={{ width: pct + '%' }} />
      </div>
      <div className="sh-lesson-card-meta">
        {done}/{total} screens
        {lesson.estimated_minutes ? ` · ~${lesson.estimated_minutes} min` : ''}
      </div>
    </div>
  );
}
