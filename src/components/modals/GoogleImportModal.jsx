import { useState, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import Icon from '../../lib/icons';
import { fmt } from '../../lib/dateUtils';
import { sb, SUPABASE_ANON_KEY, EDGE_FN_URL } from '../../lib/supabase';
import { mapGoogleCalItems, parseDocId, extractDocsText } from '../../lib/googleUtils';

// Worker must be configured in the module that actually uses pdfjsLib
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export default function GoogleImportModal({ googleToken, googleUser, onClose, onImportEvents, onImportDoc, onImportPdf, onDisconnect, onConnect,
  calSyncEnabled, calSyncStatus, calSyncLastAt, calSyncCount, calSyncError, onToggleCalSync, onSyncNow }) {
  const [tab, setTab] = useState('calendar');
  const [calEvents, setCalEvents] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [calLoading, setCalLoading] = useState(false);
  const [calFetched, setCalFetched] = useState(false);
  const [docInput, setDocInput] = useState('');
  const [docLoading, setDocLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const fileInputRef = useRef(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const audioInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const [err, setErr] = useState(null);

  const isConnected = !!googleToken;
  function authHeader() { return { 'Authorization': 'Bearer ' + googleToken }; }

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

  async function importPdf(source) {
    setPdfLoading(true); setErr(null);
    try {
      const lib = pdfjsLib;
      if (!lib) throw new Error('PDF library is still loading — wait a moment and try again.');
      let filename = source.name ? source.name.replace(/\.pdf$/i, '') : 'Imported PDF';
      const buf = await source.arrayBuffer();
      const loadingTask = lib.getDocument({ data: buf });
      const pdf = await loadingTask.promise;
      let full = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        full += tc.items.map(item => item.str).join(' ') + '\n\n';
      }
      const trimmed = full.trim();
      if (!trimmed) throw new Error('No readable text found in this PDF. Scanned/image-only PDFs cannot be parsed.');
      const maxChars = 50000;
      const content = trimmed.length > maxChars ? trimmed.slice(0, maxChars) + '\n\n[Truncated — PDF had more content than the notes limit]' : trimmed;
      onImportPdf(filename, content);
    } catch(e) { setErr(e.message); }
    finally { setPdfLoading(false); }
  }

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

  async function importAudio(file) { await transcribeFile(file, setAudioLoading); }

  async function importVideo(file) {
    if (file.size > 25 * 1024 * 1024) { setErr('File too large — max 25MB for transcription.'); return; }
    setVideoLoading(true); setErr(null);
    try {
      await transcribeFile(file, setVideoLoading);
    } catch(e) { setErr(e.message); setVideoLoading(false); }
  }

  const isLoading = calLoading || docLoading || pdfLoading || audioLoading || videoLoading;

  return (
    <>
      <div className="g-overlay" onClick={onClose}/>
      <div className="g-modal" onClick={e=>e.stopPropagation()}>
        <div className="g-modal-hdr">
          <div className="g-modal-title"><span style={{display:'flex',color:'var(--accent)'}}>{Icon.link(18)}</span> Import</div>
          <button className="g-modal-close" onClick={onClose} disabled={isLoading}>{Icon.x(16)}</button>
        </div>

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

        {err && <div className="g-err" style={{display:'flex',alignItems:'center',gap:6}}>{Icon.alertTriangle(14)} {err}</div>}

        <div className="g-tabs">
          {['calendar','docs','pdf','audio','video'].map(t=>(
            <button key={t} className={'g-tab'+(tab===t?' active':'')} onClick={()=>{setTab(t);setErr(null);}}>
              {t==='calendar'?<><span style={{display:'inline-flex'}}>{Icon.calendar(14)}</span> Calendar</>
              :t==='docs'?<><span style={{display:'inline-flex'}}>{Icon.fileText(14)}</span> Docs</>
              :t==='pdf'?<><span style={{display:'inline-flex'}}>{Icon.listTree(14)}</span> PDF</>
              :t==='audio'?<><span style={{display:'inline-flex'}}>{Icon.headphones(14)}</span> Audio</>
              :<><span style={{display:'inline-flex'}}>{Icon.video(14)}</span> Video</>}
            </button>
          ))}
        </div>

        {tab==='calendar' && (
          <div className="g-section">
            {!isConnected ? (
              <div className="g-note" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                <span>Connect Google to import and sync calendar events.</span>
                <button className="g-hdr-btn" onClick={onConnect}>Connect</button>
              </div>
            ) : (
            <>
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
      </div>
    </>
  );
}
