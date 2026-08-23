// Unit tests for the context-source extraction primitives — the pure, testable
// half of the Canvas / attachments / calendar pipeline.
//
//   npm run test:context-sources
//
// These cover the parts that fail silently in production if they regress:
// PDF text extraction (compressed and not), HTML-to-text, link classification,
// and chunking. Network-facing adapter code is not covered here.

import zlib from 'node:zlib';
import { extractPdfText } from '../shared/lms/attachments/pdf.ts';
import { htmlToText, extractLinks } from '../shared/lms/html.ts';
import { classifyLink } from '../shared/lms/attachments/extract.ts';
import { chunkText } from '../shared/lms/embed.ts';

// Build a small PDF with a Flate-compressed content stream, the normal case.
function buildPdf(content, { compress = true } = {}) {
  const body = compress ? zlib.deflateSync(Buffer.from(content, 'latin1')) : Buffer.from(content, 'latin1');
  const filter = compress ? '/Filter /FlateDecode ' : '';
  const head = Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n2 0 obj\n<< ${filter}/Length ${body.length} >>\nstream\n`,
    'latin1'
  );
  const tail = Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1');
  return new Uint8Array(Buffer.concat([head, body, tail]));
}

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

console.log('\n── PDF: compressed literal strings ──');
{
  const stream = `BT /F1 12 Tf 72 720 Td (Unit 3 Exam) Tj 0 -20 Td (Covers chapters 4 through 7.) Tj ET`;
  const r = await extractPdfText(buildPdf(stream));
  console.log('  text:', JSON.stringify(r.text));
  check('finds title', r.text.includes('Unit 3 Exam'));
  check('finds body', r.text.includes('Covers chapters 4 through 7.'));
  check('not flagged scanned', r.likelyScanned === false);
}

console.log('\n── PDF: TJ arrays with kerning ──');
{
  const stream = `BT [(Read) -300 (pages) -300 (12-40)] TJ ET`;
  const r = await extractPdfText(buildPdf(stream));
  console.log('  text:', JSON.stringify(r.text));
  check('kerning becomes spaces', r.text.includes('Read pages 12-40'));
}

console.log('\n── PDF: hex strings + escapes ──');
{
  const stream = `BT <48656C6C6F> Tj (A\\(B\\) \\101) Tj ET`;
  const r = await extractPdfText(buildPdf(stream));
  console.log('  text:', JSON.stringify(r.text));
  check('hex decoded', r.text.includes('Hello'));
  check('escapes decoded', r.text.includes('A(B) A'));
}

console.log('\n── PDF: uncompressed stream ──');
{
  const r = await extractPdfText(buildPdf(`BT (Plain stream works) Tj ET`, { compress: false }));
  console.log('  text:', JSON.stringify(r.text));
  check('uncompressed handled', r.text.includes('Plain stream works'));
}

console.log('\n── PDF: scanned (no text layer) ──');
{
  const r = await extractPdfText(buildPdf(`q 612 0 0 792 0 0 cm /Im0 Do Q`));
  check('flagged as scanned', r.likelyScanned === true, `got text=${JSON.stringify(r.text)}`);
}

console.log('\n── PDF: not a PDF ──');
{
  let threw = false;
  try { await extractPdfText(new TextEncoder().encode('hello world')); } catch { threw = true; }
  check('rejects non-PDF', threw);
}

console.log('\n── htmlToText ──');
{
  const html = `<div><h2>Syllabus</h2><p>Late work: <b>-10%</b>/day.</p><ul><li>Quiz Friday</li></ul><script>x()</script></div>`;
  const t = htmlToText(html);
  console.log('  text:', JSON.stringify(t));
  check('drops tags', !t.includes('<'));
  check('drops script body', !t.includes('x()'));
  check('keeps content', t.includes('Late work: -10%/day.') && t.includes('Quiz Friday'));
  check('entities decoded', htmlToText('<p>A &amp; B &nbsp;&mdash; C</p>').includes('A & B'));
}

console.log('\n── extractLinks ──');
{
  const links = extractLinks(`<a href="/files/1.pdf">Worksheet</a> <a href='https://x.test/a'>X</a> <a href="#top">skip</a> <a href="mailto:t@s.edu">mail</a>`);
  console.log('  links:', JSON.stringify(links));
  check('finds both real links', links.length === 2);
  check('keeps label', links[0]?.title === 'Worksheet');
  check('drops anchor + mailto', !links.some(l => l.url.startsWith('#') || l.url.startsWith('mailto')));
}

console.log('\n── classifyLink ──');
{
  const gdoc = classifyLink('https://docs.google.com/document/d/ABC123_x-y/edit?usp=sharing');
  console.log('  gdoc:', JSON.stringify(gdoc));
  check('google doc rewritten to text export', gdoc.fetchUrl === 'https://docs.google.com/document/d/ABC123_x-y/export?format=txt');
  check('sheet rewritten to csv', classifyLink('https://docs.google.com/spreadsheets/d/ZZ9/edit').fetchUrl?.endsWith('export?format=csv'));
  check('pdf classified', classifyLink('https://s.edu/hw.pdf').kind === 'pdf');
  check('relative resolved', classifyLink('/files/1.pdf', 'https://school.instructure.com/courses/5/assignments/9').fetchUrl === 'https://school.instructure.com/files/1.pdf');
  check('youtube denied', classifyLink('https://www.youtube.com/watch?v=1').follow === false);
  check('mp4 denied', classifyLink('https://s.edu/lecture.mp4').follow === false);
  check('non-http denied', classifyLink('ftp://s.edu/x').follow === false);
  check('unparseable denied', classifyLink('not a url').follow === false);
}

console.log('\n── chunkText ──');
{
  check('short text single chunk', chunkText('hello').length === 1);
  check('empty text no chunks', chunkText('   ').length === 0);
  const long = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} with some filler text to add length.`).join('\n\n');
  const chunks = chunkText(long);
  console.log(`  ${chunks.length} chunks from ${long.length} chars`);
  check('long text splits', chunks.length > 1);
  check('chunks bounded', chunks.every(c => c.length <= 1900));
  check('no empty chunks', chunks.every(c => c.trim().length > 0));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
