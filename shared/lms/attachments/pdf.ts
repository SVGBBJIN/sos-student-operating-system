// Minimal PDF text extractor — Web APIs only, so Deno Edge runs it unchanged.
//
// Scope is deliberate: this reads the text layer of digitally-generated PDFs,
// which is what teachers actually upload (exported slide decks, worksheets,
// syllabi). It does NOT do OCR, so a scanned handout comes back empty and the
// caller marks it 'unsupported' rather than 'failed' — that's the camera-roll
// OCR source's job, not this one's.
//
// How it works: PDF content streams are usually Flate-compressed. We inflate
// them with DecompressionStream (a Web API present in both Node 18+ and Deno),
// then read the text-showing operators — Tj, TJ, ' and " — out of the resulting
// page description language.

/** Guard against a pathological file eating the whole function budget. */
const MAX_STREAMS = 400;
const MAX_TEXT_CHARS = 400_000;

export interface PdfExtractResult {
  text: string;
  /** True when the file parsed but carried no text layer — i.e. it's scanned. */
  likelyScanned: boolean;
}

function isPdf(bytes: Uint8Array): boolean {
  // %PDF- may sit a few bytes in on files with a junk preamble.
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

async function inflate(bytes: Uint8Array, format: "deflate" | "deflate-raw"): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(
      new DecompressionStream(format)
    );
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/**
 * Walk `stream ... endstream` pairs. We work on latin1 text rather than parsing
 * the xref table: the object graph is irrelevant when all we want is the union
 * of every content stream's text.
 */
function findStreams(raw: string): Array<{ dictionary: string; start: number; end: number }> {
  const out: Array<{ dictionary: string; start: number; end: number }> = [];
  const marker = /stream\r?\n?/g;
  let m: RegExpExecArray | null;

  while ((m = marker.exec(raw)) !== null && out.length < MAX_STREAMS) {
    const bodyStart = m.index + m[0].length;
    const bodyEnd = raw.indexOf("endstream", bodyStart);
    if (bodyEnd === -1) break;
    // The stream's dictionary is the object header immediately before it.
    const dictStart = raw.lastIndexOf("<<", m.index);
    const dictionary = dictStart === -1 ? "" : raw.slice(dictStart, m.index);
    out.push({ dictionary, start: bodyStart, end: bodyEnd });
    marker.lastIndex = bodyEnd;
  }
  return out;
}

/** Unescape a PDF literal string: \n, \(, \), octal escapes, line continuations. */
function unescapeLiteral(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = input[++i];
    if (next === undefined) break;
    switch (next) {
      case "n": out += "\n"; break;
      case "r": out += "\r"; break;
      case "t": out += "\t"; break;
      case "b": out += "\b"; break;
      case "f": out += "\f"; break;
      case "(": out += "("; break;
      case ")": out += ")"; break;
      case "\\": out += "\\"; break;
      case "\r":
        // Line continuation — swallow an immediately following \n too.
        if (input[i + 1] === "\n") i++;
        break;
      case "\n": break;
      default:
        if (next >= "0" && next <= "7") {
          let octal = next;
          while (octal.length < 3) {
            const peek = input[i + 1];
            if (peek === undefined || peek < "0" || peek > "7") break;
            octal += peek;
            i++;
          }
          out += String.fromCharCode(parseInt(octal, 8));
        } else {
          out += next;
        }
    }
  }
  return out;
}

/** Decode a hex string operand, e.g. <48656C6C6F>. */
function decodeHexString(input: string): string {
  const hex = input.replace(/[^0-9a-fA-F]/g, "");
  let out = "";
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    if (!Number.isNaN(code) && code !== 0) out += String.fromCharCode(code);
  }
  return out;
}

/**
 * Pull show-text operands out of a decoded content stream.
 *
 * TJ takes an array mixing strings and kerning numbers; a sufficiently negative
 * kern is how PDFs render a space, so we reinstate one rather than running the
 * words together.
 */
function textFromContentStream(content: string): string {
  let out = "";
  // Matches: (literal) Tj | <hex> Tj | [ ... ] TJ | (literal) ' | (literal) "
  const shows = /(?:\[((?:[^\][\\]|\\.)*)\]\s*TJ)|(?:\(((?:[^()\\]|\\.)*)\)\s*(?:Tj|'|"))|(?:<([0-9a-fA-F\s]*)>\s*Tj)/g;
  const operand = /(?:\(((?:[^()\\]|\\.)*)\))|(?:<([0-9a-fA-F\s]*)>)|(-?\d+(?:\.\d+)?)/g;

  let m: RegExpExecArray | null;
  while ((m = shows.exec(content)) !== null) {
    if (m[1] !== undefined) {
      operand.lastIndex = 0;
      let piece: RegExpExecArray | null;
      while ((piece = operand.exec(m[1])) !== null) {
        if (piece[1] !== undefined) out += unescapeLiteral(piece[1]);
        else if (piece[2] !== undefined) out += decodeHexString(piece[2]);
        else if (piece[3] !== undefined && parseFloat(piece[3]) <= -100) out += " ";
      }
    } else if (m[2] !== undefined) {
      out += unescapeLiteral(m[2]);
    } else if (m[3] !== undefined) {
      out += decodeHexString(m[3]);
    }
    out += "\n";
    if (out.length > MAX_TEXT_CHARS) break;
  }
  return out;
}

export async function extractPdfText(bytes: Uint8Array): Promise<PdfExtractResult> {
  if (!isPdf(bytes)) throw new Error("Not a PDF");

  const raw = new TextDecoder("latin1").decode(bytes);
  const streams = findStreams(raw);
  const chunks: string[] = [];

  for (const s of streams) {
    // Skip streams that clearly aren't page content: images, fonts, metadata.
    if (/\/Subtype\s*\/(?:Image|Type1C|TrueType|CIDFontType\d)/.test(s.dictionary)) continue;
    if (/\/Type\s*\/(?:XObject|Font|Metadata)\b/.test(s.dictionary) &&
        !/\/Subtype\s*\/Form/.test(s.dictionary)) continue;

    // PDF writers put an EOL between the stream data and the `endstream`
    // keyword. DecompressionStream treats those bytes as trailing garbage and
    // fails the whole stream, so trim them before inflating.
    let end = s.end;
    while (end > s.start) {
      const ch = raw.charCodeAt(end - 1);
      if (ch === 0x0a || ch === 0x0d) end--;
      else break;
    }
    let content: string | null = null;

    if (/\/Filter[^>]*\/FlateDecode/.test(s.dictionary)) {
      // Slice the ORIGINAL bytes, never the decoded string: TextDecoder's
      // "latin1" is an alias for windows-1252, which remaps 0x80–0x9F to other
      // codepoints, so a string→byte roundtrip silently corrupts compressed
      // data. Offsets are still valid here because that decode is 1 byte →
      // 1 character throughout.
      const bin = bytes.subarray(s.start, end);
      const inflated = (await inflate(bin, "deflate")) ?? (await inflate(bin, "deflate-raw"));
      if (inflated) content = new TextDecoder("latin1").decode(inflated);
    } else if (!/\/Filter\b/.test(s.dictionary)) {
      // Uncompressed content stream. Decoding as windows-1252 is right rather
      // than merely tolerable: PDF text commonly uses WinAnsiEncoding, which
      // is exactly that character set.
      content = raw.slice(s.start, end);
    }
    // Any other filter (DCTDecode, JPXDecode, LZW…) is an image or unsupported.

    if (!content) continue;
    const text = textFromContentStream(content);
    if (text.trim()) chunks.push(text);
    if (chunks.reduce((n, c) => n + c.length, 0) > MAX_TEXT_CHARS) break;
  }

  const text = chunks
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);

  // A PDF that parsed but yielded nothing is almost always page images.
  return { text, likelyScanned: text.length < 20 };
}
