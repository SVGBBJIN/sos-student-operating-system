// SSE consumer for the Gemini-backed /api/chat (and Supabase sos-chat) endpoints.
//
// Streams `delta`, `tool_call`, `usage`, `grounding`, `error`, `done` events from
// the server. Always resolves with the final aggregated payload that the rest
// of App.jsx expects (same shape the non-streaming endpoint used to return).
//
// Usage:
//   const payload = await streamChat({
//     url, body, token, signal,
//     onDelta: text => updateLive(text),
//     onToolCall: tc => updateToolPreview(tc),
//   });

const TEXT_DECODER = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

function parseSSEFrame(frame) {
  // A frame is a CRLF-delimited block. Lines starting with `event:` set the
  // event name; `data:` lines are concatenated with a newline separator and
  // JSON-parsed. Unknown fields are ignored.
  const lines = frame.split('\n');
  let event = 'message';
  const dataLines = [];
  for (const raw of lines) {
    if (!raw || raw.startsWith(':')) continue;
    const idx = raw.indexOf(':');
    if (idx === -1) continue;
    const field = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  const text = dataLines.join('\n');
  try {
    return { event, data: JSON.parse(text) };
  } catch {
    return { event, data: text };
  }
}

export async function streamChat({ url, body, token, signal, onDelta, onToolCall, onUsage, onGrounding } = {}) {
  if (!url) throw new Error('streamChat: url is required');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || {}),
    signal,
  });

  // Server might fall back to JSON (legacy mode, rate-limit refusal, error). In
  // that case the response is regular JSON or an error — handle the same way
  // the old call site did.
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    if (!res.ok) {
      const errPayload = await res.json().catch(() => ({}));
      const err = new Error(errPayload?.error || `AI request failed: ${res.status}`);
      err.status = res.status;
      err.payload = errPayload;
      throw err;
    }
    return await res.json();
  }

  if (!res.body || !TEXT_DECODER) {
    throw new Error('streamChat: streaming not supported in this runtime');
  }

  const reader = res.body.getReader();
  let buffer = '';
  let final = null;
  let aggregated = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += TEXT_DECODER.decode(value, { stream: true });
    let sepIdx;
    while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      const parsed = parseSSEFrame(frame);
      if (!parsed) continue;
      const { event, data } = parsed;
      if (event === 'delta') {
        const text = data?.text ?? '';
        if (text) {
          aggregated += text;
          onDelta && onDelta(text, aggregated);
        }
      } else if (event === 'tool_call') {
        onToolCall && onToolCall(data);
      } else if (event === 'usage') {
        onUsage && onUsage(data);
      } else if (event === 'grounding') {
        onGrounding && onGrounding(data);
      } else if (event === 'done') {
        final = data;
      } else if (event === 'error') {
        const err = new Error(data?.message || 'AI streaming error');
        err.payload = data;
        throw err;
      }
    }
  }

  // Flush any trailing buffer (server should always send a `done` frame, but
  // be lenient with intermediate proxies that buffer incompletely).
  if (!final && aggregated) {
    final = { content: aggregated, actions: [], clarifications: [] };
  }
  return final ?? { content: '', actions: [], clarifications: [] };
}
