import React, { useState, useRef } from 'react';
import Icon from '../lib/icons';
import { sb, SUPABASE_ANON_KEY, EDGE_FN_URL, IMPORT_URL_ENDPOINT } from '../lib/supabase';
import { extractPdfText } from '../lib/pdf';
import { fmt } from '../lib/dateUtils';
import { mapGoogleCalItems, extractDocsText, parseDocId } from '../lib/googleImport.js';

/* ═══════════════════════════════════════════════
   GOOGLE IMPORT MODAL
   ═══════════════════════════════════════════════ */
// Parse pasted/CSV-ish flashcard text into [{q, a}]. One card per line;
// splits on the first delimiter found (tab, "|", " - ", then comma) so
// spreadsheet pastes, pipe-separated lists, and simple CSVs all work.
function parseFlashcardText(raw) {
  const delimiters = [/\t/, /\s*\|\s*/, /\s+-\s+/, /,/];
  return raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      for (const d of delimiters) {
        const parts = line.split(d);
        if (parts.length >= 2) {
          const q = parts[0].trim();
          const a = parts.slice(1).join(' ').trim();
          if (q && a) return { q, a };
        }
      }
      return null;
    })
    .filter(Boolean);
}

export default function GoogleImportModal({ googleToken, googleUser, onClose, onImportEvents, onImportDoc, onImportPdf, onImportUrl, onImportFlashcards, notes = [], onDisconnect, onConnect,
  calSyncEnabled, calSyncStatus, calSyncLastAt, calSyncCount, calSyncError, onToggleCalSync, onSyncNow }) {
  const [tab, setTab] = useState('calendar');
  // Flashcards tab state
  const [fcText, setFcText] = useState('');
  const [fcTargetNoteId, setFcTargetNoteId] = useState('__new__');
  const [fcNewTitle, setFcNewTitle] = useState('');
  const [fcLoading, setFcLoading] = useState(false);
  // URL import tab state — server-side fetch + text extraction (no headless browser)
  const [urlInput, setUrlInput] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  // Calendar tab state
  const [calEvents, setCalEvents] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [calLoading, setCalLoading] = useState(false);
  const [calFetched, setCalFetched] = useState(false);
  // Docs tab state — direct URL/ID input
  const [docInput, setDocInput] = useState('');
  const [docLoading, setDocLoading] = useState(false);
  // PDF tab state — local file upload only
  const [pdfLoading, setPdfLoading] = useState(false);
  const fileInputRef = useRef(null);
  // Audio/Video tab state
  const [audioLoading, setAudioLoading] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const audioInputRef = useRef(null);
  const videoInputRef = useRef(null);
  // Shared error
  const [err, setErr] = useState(null);

  // ── Helpers ──
  const isConnected = !!googleToken;
  function authHeader() { return { 'Authorization': 'Bearer ' + googleToken }; }

  // Converts an ISO timestamp to a friendly "X min ago" string
  function timeAgo(iso) {
    if (!iso) return null;
    const diffMs = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diffMs / 1000);
    if (s < 10) return 'just now';
    if (s < 60) return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' min ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' hr ago';
    return Math.floor(h / 24) + 'd ago';
  }

  // ── Calendar ──
  async function fetchCalEvents() {
    setCalLoading(true); setErr(null);
    try {
      const now = new Date();
      const max = new Date(now.getTime() + 14 * 86400000);
      const params = new URLSearchParams({
        timeMin: now.toISOString(), timeMax: max.toISOString(),
        singleEvents: 'true', orderBy: 'startTime', maxResults: '50'
      });
      const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?' + params, { headers: authHeader() });
      if (!res.ok) { if (res.status === 401) throw new Error('Google session expired — click Reconnect.'); throw new Error('Calendar fetch failed: ' + res.status); }
      const data = await res.json();
      const evs = mapGoogleCalItems(data.items || []);
      setCalEvents(evs);
      setSelected(new Set(evs.map((_,i) => i)));
      setCalFetched(true);
    } catch(e) { setErr(e.message); }
    finally { setCalLoading(false); }
  }

  function toggleEv(i) {
    setSelected(prev => { const n=new Set(prev); n.has(i)?n.delete(i):n.add(i); return n; });
  }

  // ── Docs ── (uses Google Docs API with direct document access)
  async function importDoc() {
    const docId = parseDocId(docInput);
    if (!docId) { setErr('Please enter a valid Google Doc URL or ID.'); return; }
    setDocLoading(true); setErr(null);
    try {
      const res = await fetch('https://docs.googleapis.com/v1/documents/' + docId, { headers: authHeader() });
      if (!res.ok) {
        if (res.status === 401) throw new Error('Google session expired — click Reconnect.');
        if (res.status === 403) throw new Error('Access denied. Try disconnecting and reconnecting Google to refresh permissions.');
        if (res.status === 404) throw new Error('Doc not found. Make sure you have access and the URL/ID is correct.');
        throw new Error('Failed to fetch doc: ' + res.status);
      }
      const doc = await res.json();
      const text = extractDocsText(doc);
      if (!text) throw new Error('Document appears to be empty.');
      const title = doc.title || 'Imported Doc';
      onImportDoc(title, text);
      setDocInput('');
    } catch(e) { setErr(e.message); }
    finally { setDocLoading(false); }
  }

  // ── PDF ──
  async function importPdf(source) {
    setPdfLoading(true); setErr(null);
    try {
      const filename = source.name ? source.name.replace(/\.pdf$/i, '') : 'Imported PDF';
      const trimmed = await extractPdfText(source);
      if (!trimmed) throw new Error('No readable text found in this PDF. Scanned/image-only PDFs cannot be parsed.');
      // Truncate very large docs with a note
      const maxChars = 50000;
      const content = trimmed.length > maxChars ? trimmed.slice(0, maxChars) + '\n\n[Truncated — PDF had more content than the notes limit]' : trimmed;
      onImportPdf(filename, content);
    } catch(e) { setErr(e.message); }
    finally { setPdfLoading(false); }
  }

  // Audio/Video transcription via Whisper
  async function transcribeFile(file, setLoading) {
    if (file.size > 25 * 1024 * 1024) { setErr('File too large — max 25MB for transcription.'); return; }
    setLoading(true); setErr(null);
    try {
      const session = await sb.auth.getSession();
      const token = session?.data?.session?.access_token;
      const arrayBuf = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const audioBase64 = btoa(binary);
      const res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (token || SUPABASE_ANON_KEY) },
        body: JSON.stringify({ mode: 'voice', audioBase64, audioMimeType: file.type || 'audio/webm' })
      });
      if (!res.ok) throw new Error('Transcription failed: ' + res.status);
      const data = await res.json();
      const transcript = (data.text || '').trim();
      if (!transcript) throw new Error('No speech detected in this file.');
      const filename = file.name.replace(/\.[^.]+$/, '') || 'Transcription';
      onImportPdf(filename, transcript);
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  // ── URL import ── (server-side fetch + readable-text extraction; no login-gated/JS-rendered pages)
  async function importUrl() {
    const trimmed = urlInput.trim();
    if (!trimmed) { setErr('Please enter a URL.'); return; }
    setUrlLoading(true); setErr(null);
    try {
      const session = await sb.auth.getSession();
      const token = session?.data?.session?.access_token;
      const res = await fetch(IMPORT_URL_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (token || SUPABASE_ANON_KEY) },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Import failed: ' + res.status);
      onImportUrl(data.title || trimmed, data.text);
      setUrlInput('');
    } catch (e) { setErr(e.message); }
    finally { setUrlLoading(false); }
  }

  // ── Flashcards ── (paste or CSV-ish text → parsed → attached as a note layer)
  function importFlashcards() {
    setErr(null);
    const cards = parseFlashcardText(fcText);
    if (cards.length === 0) { setErr('No valid cards found. Use one per line: question, answer (tab, "|", " - ", or comma also work).'); return; }
    if (fcTargetNoteId !== '__new__' && !fcNewTitle && !notes.find(n => n.id === fcTargetNoteId)) { setErr('Pick a note to add these to.'); return; }
    setFcLoading(true);
    try {
      const target = fcTargetNoteId === '__new__'
        ? { mode: 'new', title: fcNewTitle }
        : { mode: 'existing', noteId: fcTargetNoteId };
      onImportFlashcards(target, cards);
      setFcText(''); setFcNewTitle('');
    } finally { setFcLoading(false); }
  }

  async function importAudio(file) { await transcribeFile(file, setAudioLoading); }

  async function importVideo(file) {
    if (file.size > 25 * 1024 * 1024) { setErr('File too large — max 25MB for transcription.'); return; }
    setVideoLoading(true); setErr(null);
    try {
      // Try direct transcription first — Whisper handles video formats
      await transcribeFile(file, setVideoLoading);
    } catch(e) { setErr(e.message); setVideoLoading(false); }
  }

  const isLoading = calLoading || docLoading || pdfLoading || audioLoading || videoLoading || urlLoading || fcLoading;

  return (
    <>
      <div className="g-overlay" onClick={onClose}/>
      <div className="g-modal" onClick={e=>e.stopPropagation()}>
        {/* Header */}
        <div className="g-modal-hdr">
          <div className="g-modal-title"><span style={{display:'flex',color:'var(--accent)'}}>{Icon.link(18)}</span> Import</div>
          <button className="g-modal-close" onClick={onClose} disabled={isLoading}>{Icon.x(16)}</button>
        </div>

        {/* Connected account info */}
        {googleUser ? (
          <div className="g-connected">
            <span style={{color:'var(--success)',display:'flex',alignItems:'center',gap:4}}>{Icon.check(12)} {googleUser.email}</span>
            <button onClick={onDisconnect} style={{background:'transparent',border:'none',color:'var(--danger)',cursor:'pointer',fontSize:'0.78rem',fontWeight:600,padding:'0 4px'}}>Disconnect</button>
          </div>
        ) : (
          <div className="g-connected" style={{background:'rgba(108,99,255,0.08)',borderColor:'rgba(108,99,255,0.2)'}}>
            <span style={{color:'var(--text-dim)',display:'flex',alignItems:'center',gap:6}}>{Icon.link(12)} Connect Google to import Calendar events or Docs.</span>
            <button onClick={onConnect} style={{background:'transparent',border:'1px solid rgba(108,99,255,0.3)',color:'var(--accent)',cursor:'pointer',fontSize:'0.76rem',fontWeight:600,padding:'4px 8px',borderRadius:8}}>Connect</button>
          </div>
        )}

        {/* Error */}
        {err && <div className="g-err" style={{display:'flex',alignItems:'center',gap:6}}>{Icon.alertTriangle(14)} {err}</div>}

        {/* Tabs */}
        <div className="g-tabs">
          {['calendar','docs','pdf','audio','video','url','flashcards'].map(t=>(
            <button key={t} className={'g-tab'+(tab===t?' active':'')} onClick={()=>{setTab(t);setErr(null);}}>
              {t==='calendar'?<><span style={{display:'inline-flex'}}>{Icon.calendar(14)}</span> Calendar</>
              :t==='docs'?<><span style={{display:'inline-flex'}}>{Icon.fileText(14)}</span> Docs</>
              :t==='pdf'?<><span style={{display:'inline-flex'}}>{Icon.listTree(14)}</span> PDF</>
              :t==='audio'?<><span style={{display:'inline-flex'}}>{Icon.headphones(14)}</span> Audio</>
              :t==='video'?<><span style={{display:'inline-flex'}}>{Icon.video(14)}</span> Video</>
              :t==='url'?<><span style={{display:'inline-flex'}}>{Icon.link(14)}</span> Website</>
              :<><span style={{display:'inline-flex'}}>{Icon.listTree(14)}</span> Flashcards</>}
            </button>
          ))}
        </div>

        {/* ── Calendar Tab ── */}
        {tab==='calendar' && (
          <div className="g-section">
            {!isConnected ? (
              <div className="g-note" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                <span>Connect Google to import and sync calendar events.</span>
                <button className="g-hdr-btn" onClick={onConnect}>Connect</button>
              </div>
            ) : (
            <>

            {/* ── Auto-sync toggle card ── */}
            <div className={'cal-sync-card' + (calSyncEnabled ? ' on' : '') + (calSyncStatus==='error' ? ' error' : '')}>
              <div className="cal-sync-toggle">
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{display:'flex',color:'var(--accent)'}}>{calSyncStatus==='syncing'?Icon.circle(18):calSyncEnabled?Icon.checkCircle(18):Icon.calendar(18)}</span>
                  <div>
                    <div style={{fontWeight:700,fontSize:'0.88rem'}}>Auto-sync Calendar</div>
                    <div style={{fontSize:'0.72rem',color:'var(--text-dim)',marginTop:1}}>
                      {calSyncEnabled ? 'Syncing next 2 weeks every 30 min' : 'Enable to sync automatically in the background'}
                    </div>
                  </div>
                </div>
                <button className={'cal-sync-pill ' + (calSyncEnabled ? 'on' : 'off')} onClick={onToggleCalSync}>
                  {calSyncEnabled ? '● ON' : '○ OFF'}
                </button>
              </div>

              {/* Status row — only shown when enabled */}
              {calSyncEnabled && (
                <div style={{marginTop:10,paddingTop:10,borderTop:'1px solid rgba(255,255,255,0.06)',display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                  <div style={{fontSize:'0.78rem'}}>
                    {calSyncStatus==='syncing' && <span style={{color:'var(--text-dim)',display:'flex',alignItems:'center',gap:4}}>{Icon.circle(12)} Syncing now…</span>}
                    {calSyncStatus==='done' && (
                      <span style={{color:'var(--success)'}}>
                        {Icon.check(12)} Last synced {timeAgo(calSyncLastAt)}
                        {calSyncCount > 0 && <span style={{color:'var(--text-dim)',marginLeft:6}}>({calSyncCount} new event{calSyncCount!==1?'s':''})</span>}
                        {calSyncCount === 0 && <span style={{color:'var(--text-dim)',marginLeft:6}}>(no new events)</span>}
                      </span>
                    )}
                    {calSyncStatus==='error' && <span style={{color:'var(--danger)',display:'flex',alignItems:'center',gap:4}}>{Icon.alertTriangle(12)} {calSyncError}</span>}
                    {calSyncStatus==='idle' && calSyncLastAt && <span style={{color:'var(--text-dim)'}}>Last synced {timeAgo(calSyncLastAt)}</span>}
                    {calSyncStatus==='idle' && !calSyncLastAt && <span style={{color:'var(--text-dim)'}}>Starting first sync…</span>}
                  </div>
                  <button onClick={onSyncNow} disabled={calSyncStatus==='syncing'}
                    style={{background:'transparent',border:'1px solid '+(calSyncStatus==='syncing'?'var(--border)':'rgba(46,213,115,0.4)'),color:calSyncStatus==='syncing'?'var(--text-dim)':'var(--success)',borderRadius:8,padding:'4px 10px',cursor:calSyncStatus==='syncing'?'not-allowed':'pointer',fontSize:'0.75rem',fontWeight:600,transition:'all .15s',flexShrink:0}}>
                    {calSyncStatus==='syncing'?'Syncing…':'Sync now'}
                  </button>
                </div>
              )}
            </div>

            {/* ── Manual mode (shown only when auto-sync is OFF) ── */}
            {!calSyncEnabled && (
              <>
                {!calFetched ? (
                  <>
                    <p className="g-note">Or manually fetch events and choose which ones to import.</p>
                    <button className="g-btn" onClick={fetchCalEvents} disabled={calLoading}>
                      <span style={{display:'flex'}}>{calLoading?Icon.circle(16):Icon.calendar(16)}</span>
                      {calLoading ? 'Fetching events…' : 'Fetch next 2 weeks of events'}
                    </button>
                  </>
                ) : (
                  <>
                    {calEvents.length === 0 ? (
                      <div className="g-status">No events found in the next 2 weeks.</div>
                    ) : (
                      <>
                        <div style={{fontSize:'0.78rem',color:'var(--text-dim)',marginBottom:10}}>
                          {calEvents.length} events — tap to select/deselect.
                          <button onClick={()=>setSelected(s=>s.size===calEvents.length?new Set():new Set(calEvents.map((_,i)=>i)))}
                            style={{marginLeft:8,background:'transparent',border:'none',color:'var(--accent)',cursor:'pointer',fontSize:'0.78rem',fontWeight:600}}>
                            {selected.size===calEvents.length?'Deselect all':'Select all'}
                          </button>
                        </div>
                        {calEvents.map((ev,i)=>(
                          <div key={i} className="g-event-row" onClick={()=>toggleEv(i)}>
                            <div className={'g-check'+(selected.has(i)?' on':'')}>
                              {selected.has(i)&&<span style={{color:'#fff',display:'flex'}}>{Icon.check(12)}</span>}
                            </div>
                            <div style={{flex:1}}>
                              <div className="g-event-title">{ev.title}</div>
                              <div className="g-event-sub">{fmt(ev.date)}{ev.startTime?' · '+ev.startTime:' · All day'}</div>
                            </div>
                          </div>
                        ))}
                        <div className="g-action-row">
                          <button className="confirm-btn confirm-btn-yes" style={{flex:1}}
                            onClick={()=>onImportEvents(calEvents.filter((_,i)=>selected.has(i)))}
                            disabled={selected.size===0}>
                            Import {selected.size} event{selected.size!==1?'s':''}
                          </button>
                          <button className="confirm-btn confirm-btn-cancel" onClick={()=>{setCalFetched(false);setCalEvents([]);}}>
                            Re-fetch
                          </button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </>
            )}
            </>
            )}
          </div>
        )}

        {/* ── Docs Tab ── */}
        {tab==='docs' && (
          <div className="g-section">
            {!isConnected ? (
              <div className="g-note" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                <span>Connect Google to import Docs.</span>
                <button className="g-hdr-btn" onClick={onConnect}>Connect</button>
              </div>
            ) : (
            <>
            <p className="g-note">Paste a Google Doc URL or ID below. Text only; formatting won't carry over.</p>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <input type="text" value={docInput} onChange={e=>{setDocInput(e.target.value);setErr(null);}}
                placeholder="https://docs.google.com/document/d/... or Doc ID"
                style={{flex:1,background:'var(--bg)',border:'1px solid var(--border)',borderRadius:10,padding:'10px 14px',color:'var(--text)',fontSize:'0.85rem',outline:'none',transition:'border-color .2s'}}
                onFocus={e=>e.target.style.borderColor='var(--accent)'}
                onBlur={e=>e.target.style.borderColor='var(--border)'}/>
              {docInput && <button onClick={()=>{setDocInput('');setErr(null);}}
                style={{background:'transparent',border:'none',color:'var(--text-dim)',cursor:'pointer',padding:'2px 6px',display:'flex'}}>{Icon.x(14)}</button>}
            </div>
            <button className="confirm-btn confirm-btn-yes" style={{width:'100%',marginTop:8}}
              onClick={importDoc} disabled={docLoading||!docInput.trim()}>
              {docLoading?'Importing…':'Import to Notes'}
            </button>
            </>
            )}
          </div>
        )}

        {/* ── PDF Tab ── */}
        {tab==='pdf' && (
          <div className="g-section">
            <button className="g-btn" onClick={()=>fileInputRef.current?.click()} disabled={pdfLoading}>
              <span style={{display:'flex'}}>{Icon.fileText(16)}</span> {pdfLoading?'Reading PDF…':'Upload PDF from your computer'}
            </button>
            <input ref={fileInputRef} type="file" accept=".pdf" style={{display:'none'}}
              onChange={e=>{if(e.target.files?.[0]){importPdf(e.target.files[0]);e.target.value='';}}}/>

            <p className="g-note" style={{marginTop:8,display:'flex',alignItems:'flex-start',gap:6}}><span style={{display:'flex',flexShrink:0,color:'var(--warning)',marginTop:1}}>{Icon.alertTriangle(14)}</span> Scanned/photo PDFs won't work — only PDFs with real digital text can be read.</p>
          </div>
        )}

        {/* ── Audio Tab ── */}
        {tab==='audio' && (
          <div className="g-section">
            <button className="g-btn" onClick={()=>audioInputRef.current?.click()} disabled={audioLoading}>
              <span style={{display:'flex'}}>{Icon.headphones(16)}</span> {audioLoading?'Transcribing audio…':'Upload audio file to transcribe'}
            </button>
            <input ref={audioInputRef} type="file" accept=".mp3,.wav,.m4a,.ogg,.webm,.aac,.flac" style={{display:'none'}}
              onChange={e=>{if(e.target.files?.[0]){importAudio(e.target.files[0]);e.target.value='';}}}/>
            <p className="g-note" style={{marginTop:8}}>Supported: MP3, WAV, M4A, OGG, WebM, AAC, FLAC. Max 25MB. Audio will be transcribed to text and saved as a note.</p>
          </div>
        )}

        {/* ── URL Tab ── (server-side fetch + text extraction, no headless browser) */}
        {tab==='url' && (
          <div className="g-section">
            <p className="g-note">Paste a link to an article, textbook page, or study guide. We'll pull the readable text and save it as a note. JS-heavy or login-gated pages won't work.</p>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <input type="text" value={urlInput} onChange={e=>{setUrlInput(e.target.value);setErr(null);}}
                placeholder="https://example.com/article"
                style={{flex:1,background:'var(--bg)',border:'1px solid var(--border)',borderRadius:10,padding:'10px 14px',color:'var(--text)',fontSize:'0.85rem',outline:'none',transition:'border-color .2s'}}
                onFocus={e=>e.target.style.borderColor='var(--accent)'}
                onBlur={e=>e.target.style.borderColor='var(--border)'}/>
              {urlInput && <button onClick={()=>{setUrlInput('');setErr(null);}}
                style={{background:'transparent',border:'none',color:'var(--text-dim)',cursor:'pointer',padding:'2px 6px',display:'flex'}}>{Icon.x(14)}</button>}
            </div>
            <button className="confirm-btn confirm-btn-yes" style={{width:'100%',marginTop:8}}
              onClick={importUrl} disabled={urlLoading||!urlInput.trim()}>
              {urlLoading?'Fetching page…':'Import from URL'}
            </button>
          </div>
        )}

        {/* ── Video Tab ── */}
        {tab==='video' && (
          <div className="g-section">
            <button className="g-btn" onClick={()=>videoInputRef.current?.click()} disabled={videoLoading}>
              <span style={{display:'flex'}}>{Icon.video(16)}</span> {videoLoading?'Transcribing video…':'Upload video file to transcribe'}
            </button>
            <input ref={videoInputRef} type="file" accept=".mp4,.webm,.mov,.avi,.mkv" style={{display:'none'}}
              onChange={e=>{if(e.target.files?.[0]){importVideo(e.target.files[0]);e.target.value='';}}}/>
            <p className="g-note" style={{marginTop:8}}>Supported: MP4, WebM, MOV, AVI, MKV. Max 25MB. Audio from the video will be transcribed to text and saved as a note.</p>
          </div>
        )}

        {/* ── Flashcards Tab ── (paste/CSV import → attached as a layer on a note) */}
        {tab==='flashcards' && (
          <div className="g-section">
            <p className="g-note">Paste one card per line — <code>question, answer</code> (tab, "|", or " - " also work). Cards attach as a flashcards layer on the note you pick below.</p>
            <textarea
              value={fcText}
              onChange={e=>{setFcText(e.target.value);setErr(null);}}
              placeholder={'What is the capital of France? | Paris\nH2O is called what? | Water'}
              rows={6}
              style={{width:'100%',boxSizing:'border-box',background:'var(--bg)',border:'1px solid var(--border)',borderRadius:10,padding:'10px 14px',color:'var(--text)',fontSize:'0.85rem',outline:'none',resize:'vertical',fontFamily:'inherit'}}
            />
            <div style={{display:'flex',gap:8,alignItems:'center',marginTop:8}}>
              <select
                value={fcTargetNoteId}
                onChange={e=>setFcTargetNoteId(e.target.value)}
                style={{flex:1,background:'var(--bg)',border:'1px solid var(--border)',borderRadius:10,padding:'8px 10px',color:'var(--text)',fontSize:'0.85rem',outline:'none'}}
              >
                <option value="__new__">+ New note…</option>
                {notes.filter(n=>!n.is_folder).map(n=>(
                  <option key={n.id} value={n.id}>{n.name || 'Untitled'}</option>
                ))}
              </select>
            </div>
            {fcTargetNoteId === '__new__' && (
              <input type="text" value={fcNewTitle} onChange={e=>{setFcNewTitle(e.target.value);setErr(null);}}
                placeholder="New note title…"
                style={{width:'100%',boxSizing:'border-box',marginTop:8,background:'var(--bg)',border:'1px solid var(--border)',borderRadius:10,padding:'10px 14px',color:'var(--text)',fontSize:'0.85rem',outline:'none'}}/>
            )}
            <button className="confirm-btn confirm-btn-yes" style={{width:'100%',marginTop:8}}
              onClick={importFlashcards} disabled={fcLoading||!fcText.trim()}>
              {fcLoading?'Importing…':'Import flashcards'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
