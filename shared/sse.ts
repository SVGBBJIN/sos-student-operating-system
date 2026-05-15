// Tiny SSE helper that works on both Node (Vercel response) and Deno (Response
// body via ReadableStream). Encodes structured events as `data: <json>\n\n`
// frames.

export interface SSEFrame {
  event?: string;
  data: unknown;
  id?: string;
}

function formatFrame(frame: SSEFrame): string {
  const lines: string[] = [];
  if (frame.event) lines.push(`event: ${frame.event}`);
  if (frame.id) lines.push(`id: ${frame.id}`);
  const json = typeof frame.data === "string" ? frame.data : JSON.stringify(frame.data);
  for (const line of json.split("\n")) lines.push(`data: ${line}`);
  lines.push("", "");
  return lines.join("\n");
}

export interface SSEWriter {
  send(frame: SSEFrame): void;
  close(): void;
}

// Deno / Web Streams writer — returns a Response body.
export function createSSEStream(): { response: Response; writer: SSEWriter } {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
  });
  const writer: SSEWriter = {
    send(frame) {
      controller.enqueue(encoder.encode(formatFrame(frame)));
    },
    close() {
      try { controller.close(); } catch { /* already closed */ }
    },
  };
  const response = new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
  return { response, writer };
}

// Node-style writer for Vercel handlers that take (req, res).
export interface NodeResponseLike {
  setHeader(name: string, value: string): void;
  write(chunk: string): void;
  end(): void;
  flushHeaders?(): void;
}

export function createSSEWriterForNode(res: NodeResponseLike): SSEWriter {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  let closed = false;
  return {
    send(frame) {
      if (closed) return;
      res.write(formatFrame(frame));
    },
    close() {
      if (closed) return;
      closed = true;
      res.end();
    },
  };
}
