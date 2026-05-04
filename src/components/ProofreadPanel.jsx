import { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { sb, SUPABASE_ANON_KEY, PROOFREAD_FN_URL } from '../lib/supabase.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

const SEVERITY_COLORS = {
  info:  'var(--muted-foreground)',
  warn:  'hsl(38, 78%, 58%)',
  error: 'var(--error)',
};

const BUCKET_LABEL = {
  math: 'math',
  essay: 'essay',
  worksheet: 'worksheet',
  logic: 'logic',
};

const MAX_PDF_PAGES = 20;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 12000;

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result || '';
      const idx = String(result).indexOf(',');
      resolve(idx >= 0 ? String(result).slice(idx + 1) : '');
    };
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

async function extractPdfText(file) {
  const ab = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
  const pages = [];
  for (let i = 1; i <= Math.min(pdf.numPages, MAX_PDF_PAGES); i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => item.str).join(' '));
  }
  return pages.join('\n\n').trim();
}

function ClassificationBadge({ classification }) {
  if (!classification) return null;
  const segments = classification.segments
    ? classification.segments
    : (classification.unified ? [classification.unified] : []);
  if (segments.length === 0) return null;

  const label = segments.length === 1
    ? `${BUCKET_LABEL[segments[0].bucket] || segments[0].bucket} · 1 segment`
    : `${segments.length} segments · ${segments.map(s => BUCKET_LABEL[s.bucket] || s.bucket).join(' + ')}`;

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-full)',
      background: 'var(--surface)',
      fontFamily: 'var(--font-ui)', fontSize: 11,
      color: 'var(--muted-foreground)', letterSpacing: '0.04em',
      textTransform: 'uppercase',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)' }} />
      {label}
    </div>
  );
}

function SeverityDot({ severity }) {
  return (
    <span style={{
      width: 8, height: 8, borderRadius: '50%',
      background: SEVERITY_COLORS[severity] || SEVERITY_COLORS.info,
      flexShrink: 0,
      marginTop: 6,
    }} />
  );
}

function FindingRow({ children, severity }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '8px 10px',
      borderTop: '1px solid var(--border-subtle)',
    }}>
      <SeverityDot severity={severity || 'info'} />
      <div style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.55, color: 'var(--foreground)', fontFamily: 'var(--font-ui)' }}>
        {children}
      </div>
    </div>
  );
}

function locatorLabel(bucket, finding) {
  if (bucket === 'math' || bucket === 'logic') {
    const n = Number(finding.step);
    return Number.isFinite(n) ? `step ${n}` : 'step';
  }
  if (bucket === 'worksheet') {
    const n = Number(finding.prompt_index);
    const status = finding.status ? ` · ${finding.status}` : '';
    return Number.isFinite(n) ? `q${n}${status}` : `prompt${status}`;
  }
  if (bucket === 'essay') {
    return finding.part ? String(finding.part) : 'overall';
  }
  return '';
}

function SegmentResult({ result, index, totalSegments }) {
  const { bucket, summary, findings, flow_notes, error, wordCount } = result;
  return (
    <section style={{
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
      background: 'var(--card)',
      overflow: 'hidden',
      animation: 'fadeUp .25s ease both',
    }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontFamily: 'var(--font-ui)', fontSize: 10, fontWeight: 700,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            color: 'var(--primary)',
          }}>
            {totalSegments > 1 ? `Segment ${index + 1} · ` : ''}{BUCKET_LABEL[bucket] || bucket}
          </span>
          {Number.isFinite(wordCount) && bucket === 'essay' && (
            <span style={{ fontFamily: 'var(--font-ui)', fontSize: 10, color: 'var(--muted-foreground)' }}>
              {wordCount} words
            </span>
          )}
        </div>
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: 10, color: 'var(--muted-foreground)' }}>
          {findings.length} {findings.length === 1 ? 'finding' : 'findings'}
        </span>
      </header>

      {summary && (
        <div style={{
          padding: '10px 12px',
          fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--foreground)',
          lineHeight: 1.6,
          borderBottom: findings.length > 0 || (flow_notes && flow_notes.length > 0) ? '1px solid var(--border-subtle)' : 'none',
        }}>
          {summary}
        </div>
      )}

      {findings.length > 0 ? (
        <div>
          {findings.map((f, i) => (
            <FindingRow key={i} severity={f.severity}>
              <div style={{
                fontFamily: 'var(--font-ui)', fontSize: 10, fontWeight: 700,
                letterSpacing: '0.06em', textTransform: 'uppercase',
                color: 'var(--muted-foreground)', marginBottom: 2,
              }}>
                {locatorLabel(bucket, f)}
              </div>
              <div>{f.hint || '(no hint)'}</div>
            </FindingRow>
          ))}
        </div>
      ) : (
        !error && (
          <div style={{
            padding: '12px 14px',
            fontFamily: 'var(--font-ui)', fontSize: 12,
            color: 'var(--muted-foreground)',
          }}>
            Nothing flagged here.
          </div>
        )
      )}

      {Array.isArray(flow_notes) && flow_notes.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{
            padding: '8px 12px',
            fontFamily: 'var(--font-ui)', fontSize: 10, fontWeight: 700,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            color: 'var(--muted-foreground)',
            background: 'var(--sidebar)',
          }}>
            Flow notes
          </div>
          {flow_notes.map((n, i) => (
            <FindingRow key={i} severity="info">
              <div style={{
                fontFamily: 'var(--font-ui)', fontSize: 10, fontWeight: 700,
                letterSpacing: '0.06em', textTransform: 'uppercase',
                color: 'var(--muted-foreground)', marginBottom: 2,
              }}>
                paragraph {n.paragraph || '?'}
              </div>
              <div>{n.hint || '(no hint)'}</div>
            </FindingRow>
          ))}
        </div>
      )}

      {error && (
        <div style={{
          padding: '10px 12px',
          fontFamily: 'var(--font-ui)', fontSize: 11,
          color: 'var(--error)',
          borderTop: '1px solid var(--border-subtle)',
        }}>
          Specialist failed: {error}
        </div>
      )}
    </section>
  );
}

export default function ProofreadPanel() {
  const [text, setText] = useState('');
  const [prompt, setPrompt] = useState('');
  const [photo, setPhoto] = useState(null); // { base64, mimeType, name, previewUrl }
  const [running, setRunning] = useState(false);
  const [response, setResponse] = useState(null); // { classification, results }
  const [error, setError] = useState('');
  const [rateLimited, setRateLimited] = useState(false);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  // Auto-grow textarea up to a cap.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 360) + 'px';
  }, [text]);

  useEffect(() => {
    return () => {
      if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    };
  }, [photo]);

  const canRun = useMemo(() => {
    if (running) return false;
    return Boolean((text && text.trim()) || photo);
  }, [text, photo, running]);

  function reset() {
    setText('');
    setPrompt('');
    if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    setPhoto(null);
    setResponse(null);
    setError('');
    setRateLimited(false);
  }

  async function handleAttach(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setError('');

    try {
      const lower = (file.name || '').toLowerCase();
      const isPdf = file.type === 'application/pdf' || lower.endsWith('.pdf');
      const isImage = (file.type || '').startsWith('image/');
      const isText = !isPdf && !isImage;

      if (isImage) {
        if (file.size > MAX_IMAGE_BYTES) {
          setError('Image too large — max 8MB.');
          return;
        }
        const base64 = await fileToBase64(file);
        const previewUrl = URL.createObjectURL(file);
        if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
        setPhoto({ base64, mimeType: file.type || 'image/jpeg', name: file.name, previewUrl });
      } else if (isPdf) {
        const extracted = await extractPdfText(file);
        if (!extracted) {
          setError("Couldn't extract text from that PDF — try a typed PDF or paste manually.");
          return;
        }
        setText(extracted.slice(0, MAX_TEXT_CHARS));
      } else if (isText) {
        const txt = await file.text();
        if (!txt.trim()) {
          setError('That file is empty.');
          return;
        }
        setText(txt.slice(0, MAX_TEXT_CHARS));
      }
    } catch (err) {
      console.error('Proofread attachment error:', err);
      setError("Couldn't read that file — try a PDF, image, or plain text.");
    }
  }

  async function handleRun() {
    if (!canRun) return;
    setRunning(true);
    setError('');
    setRateLimited(false);
    setResponse(null);

    try {
      const session = await sb.auth.getSession();
      const token = session?.data?.session?.access_token;

      const body = {
        text: text.trim() || '',
        prompt: prompt.trim() || '',
      };
      if (photo) {
        body.imageBase64 = photo.base64;
        body.imageMimeType = photo.mimeType;
      }

      const res = await fetch(PROOFREAD_FN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (token || SUPABASE_ANON_KEY),
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        if (res.status === 429 && errData?.rateLimited) {
          setRateLimited(true);
          return;
        }
        throw new Error(errData?.error || 'Proofread failed: ' + res.status);
      }

      const data = await res.json();
      setResponse(data);
    } catch (err) {
      console.error('Proofread run error:', err);
      setError(err?.message || 'Something went wrong. Try again.');
    } finally {
      setRunning(false);
    }
  }

  const segments = response?.classification?.segments
    ? response.classification.segments
    : (response?.classification?.unified ? [response.classification.unified] : []);

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      background: 'var(--background)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8, padding: '10px 14px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--sidebar)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, color: 'var(--primary)' }}>✦</span>
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 13, color: 'var(--foreground)' }}>
            Proofread
          </span>
          <span style={{ fontFamily: 'var(--font-ui)', fontSize: 10, color: 'var(--muted-foreground)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            no answers · just hints
          </span>
        </div>
        {(text || photo || response || error) && (
          <button
            onClick={reset}
            disabled={running}
            style={{
              background: 'transparent', border: '1px solid var(--border-subtle)',
              color: 'var(--muted-foreground)', borderRadius: 'var(--radius-sm)',
              padding: '4px 10px', fontFamily: 'var(--font-ui)', fontSize: 11,
              cursor: running ? 'not-allowed' : 'pointer',
              letterSpacing: '0.04em', textTransform: 'uppercase',
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'auto' }}>
        {/* Input area */}
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What was the prompt? (optional)"
            disabled={running}
            style={{
              width: '100%', padding: '8px 10px',
              background: 'var(--surface)', color: 'var(--foreground)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'var(--font-ui)', fontSize: 12,
              outline: 'none',
            }}
          />

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT_CHARS))}
            placeholder="Paste your work here, or attach a photo / PDF / text file."
            disabled={running}
            style={{
              width: '100%', minHeight: 120, maxHeight: 360,
              padding: '10px 12px',
              background: 'var(--surface)', color: 'var(--foreground)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'var(--font-ui)', fontSize: 12, lineHeight: 1.65,
              outline: 'none', resize: 'none',
            }}
          />

          {photo && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px',
              background: 'var(--surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
            }}>
              {photo.previewUrl && (
                <img
                  src={photo.previewUrl}
                  alt="attachment preview"
                  style={{ width: 38, height: 38, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border-subtle)' }}
                />
              )}
              <span style={{ flex: 1, fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {photo.name || 'image'}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
                  setPhoto(null);
                }}
                disabled={running}
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--muted-foreground)', cursor: 'pointer',
                  fontFamily: 'var(--font-ui)', fontSize: 11,
                }}
              >
                remove
              </button>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,.txt,text/plain,application/pdf"
              onChange={handleAttach}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={running}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-subtle)',
                color: 'var(--muted-foreground)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 10px',
                fontFamily: 'var(--font-ui)', fontSize: 11,
                cursor: running ? 'not-allowed' : 'pointer',
                letterSpacing: '0.04em', textTransform: 'uppercase',
              }}
            >
              + attach
            </button>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={handleRun}
              disabled={!canRun}
              style={{
                background: canRun ? 'var(--primary)' : 'var(--muted)',
                color: canRun ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 16px',
                fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: 700,
                cursor: canRun ? 'pointer' : 'not-allowed',
                letterSpacing: '0.04em', textTransform: 'uppercase',
              }}
            >
              {running ? 'Checking…' : 'Check my work'}
            </button>
          </div>

          {error && (
            <div style={{
              padding: '8px 10px',
              background: 'color-mix(in srgb, var(--error) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--error) 40%, transparent)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--error)',
              fontFamily: 'var(--font-ui)', fontSize: 11, lineHeight: 1.55,
            }}>
              {error}
            </div>
          )}

          {rateLimited && (
            <div style={{
              padding: '8px 10px',
              background: 'var(--surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--muted-foreground)',
              fontFamily: 'var(--font-ui)', fontSize: 11, lineHeight: 1.55,
            }}>
              you've used all 5 content generations for today — this resets at midnight EST.
            </div>
          )}
        </div>

        {/* Results */}
        <div style={{ padding: '0 14px 14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!response && !running && (
            <div style={{
              padding: '14px 12px',
              border: '1px dashed var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              fontFamily: 'var(--font-ui)', fontSize: 11, lineHeight: 1.65,
              color: 'var(--muted-foreground)',
            }}>
              Drop in your work. We'll point you at where to look — never tell you what to write.
              <br /><br />
              Math gets a step-by-step check. Essays get a completeness pass and (over 300 words) a flow review. Worksheets get per-prompt status. Logic gets inference-by-inference scrutiny.
            </div>
          )}

          {response && (
            <>
              <ClassificationBadge classification={response.classification} />
              {response.results.map((result, idx) => (
                <SegmentResult
                  key={idx}
                  result={result}
                  index={idx}
                  totalSegments={segments.length}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
