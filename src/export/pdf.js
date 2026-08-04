/**
 * Minimal single-page PDF writer: one full-bleed JPEG on one page.
 *
 * Why hand-rolled instead of jsPDF/pdf-lib: this app is a static site with zero
 * dependencies and no build step, so anyone can open index.html from disk or
 * drop the folder on GitHub Pages and it just works. Pulling in a PDF library
 * would mean a bundler, a lockfile and ~300 kB of code to emit a document that
 * is barely 400 bytes of structure around the JPEG we already have. A PDF whose
 * only content is one DCTDecode image is small enough to write by hand, and
 * doing so keeps the print path completely auditable.
 *
 * The output is PDF 1.4 with a classic xref table, correct MediaBox/TrimBox/
 * BleedBox geometry, and the JPEG embedded verbatim (no re-encoding), which is
 * what a print shop expects to receive.
 */

const encoder = new TextEncoder();

/** PDF user space is points: 72 per inch, 25.4 mm per inch. */
function mmToPt(mm) {
  return (mm / 25.4) * 72;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

/** Formats a number for the PDF body: fixed at 4 decimals, no exponent form. */
function num(value) {
  const rounded = round4(value);
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function pdfDate(date) {
  const p = (n, width = 2) => String(n).padStart(width, '0');
  return (
    `D:${p(date.getFullYear(), 4)}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

/**
 * Builds a one-page PDF containing a single full-bleed JPEG.
 *
 * @param {object} options
 * @param {Uint8Array} options.jpegBytes complete baseline JPEG, RGB
 * @param {number} options.pixelWidth pixel width of that JPEG
 * @param {number} options.pixelHeight pixel height of that JPEG
 * @param {number} options.widthMm full page width INCLUDING bleed
 * @param {number} options.heightMm full page height INCLUDING bleed
 * @param {number} [options.trimMm=0] bleed margin on each of the four sides
 * @returns {Uint8Array} the complete PDF file
 */
export function buildPdf({ jpegBytes, pixelWidth, pixelHeight, widthMm, heightMm, trimMm = 0 }) {
  const wPt = round4(mmToPt(widthMm));
  const hPt = round4(mmToPt(heightMm));
  const tPt = round4(mmToPt(Math.max(0, trimMm)));

  // The trim box is the page inset by the bleed on all four sides. Only emit it
  // when it is both requested and geometrically sane.
  const trimX1 = round4(wPt - tPt);
  const trimY1 = round4(hPt - tPt);
  const hasTrim = tPt > 0 && trimX1 > tPt && trimY1 > tPt;

  // The file is assembled as binary segments with a running byte offset. It is
  // never a JS string: the JPEG payload would not survive a string round-trip.
  const parts = [];
  let offset = 0;

  const push = (chunk) => {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
    parts.push(bytes);
    offset += bytes.length;
  };

  // Offsets of `N 0 obj` for objects 1..6, filled in as we go.
  const objectOffsets = new Array(7).fill(0);
  const beginObject = (n) => {
    objectOffsets[n] = offset;
    push(`${n} 0 obj\n`);
  };
  const endObject = () => push('endobj\n');

  push('%PDF-1.4\n');
  // Binary marker comment: '%' plus four bytes >= 128 so transfer tools and
  // viewers treat the file as binary rather than text.
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  // 1: Catalog
  beginObject(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\n');
  endObject();

  // 2: Page tree
  beginObject(2);
  push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n');
  endObject();

  // 3: Page
  let boxes = `/MediaBox [0 0 ${num(wPt)} ${num(hPt)}]`;
  if (hasTrim) {
    const inset = `[${num(tPt)} ${num(tPt)} ${num(trimX1)} ${num(trimY1)}]`;
    boxes +=
      ` /BleedBox [0 0 ${num(wPt)} ${num(hPt)}]` + ` /TrimBox ${inset}` + ` /ArtBox ${inset}`;
  }
  beginObject(3);
  push(
    `<< /Type /Page /Parent 2 0 R ${boxes}` +
      ' /Resources << /XObject << /Im0 4 0 R >> >>' +
      ' /Contents 5 0 R >>\n',
  );
  endObject();

  // 4: The image itself, embedded as-is via DCTDecode.
  beginObject(4);
  push(
    '<< /Type /XObject /Subtype /Image' +
      ` /Width ${Math.round(pixelWidth)} /Height ${Math.round(pixelHeight)}` +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode' +
      ` /Length ${jpegBytes.length} >>\nstream\n`,
  );
  push(jpegBytes);
  push('\nendstream\n');
  endObject();

  // 5: Content stream. The `cm` matrix scales the unit image square up to the
  // full page, so the JPEG covers the media box edge to edge.
  const content = `q ${num(wPt)} 0 0 ${num(hPt)} 0 0 cm /Im0 Do Q\n`;
  const contentBytes = encoder.encode(content);
  beginObject(5);
  push(`<< /Length ${contentBytes.length} >>\nstream\n`);
  push(contentBytes);
  push('endstream\n');
  endObject();

  // 6: Info
  beginObject(6);
  push(
    `<< /Producer (Vision Board Studio) /CreationDate (${pdfDate(new Date())}) >>\n`,
  );
  endObject();

  // Classic xref table. Every entry is exactly 20 bytes including its EOL, and
  // the trailing space before the newline is part of the format, not a typo.
  const xrefOffset = offset;
  let xref = 'xref\n0 7\n0000000000 65535 f \n';
  for (let n = 1; n <= 6; n++) {
    xref += `${String(objectOffsets[n]).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);

  push('trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\n');
  push(`startxref\n${xrefOffset}\n%%EOF\n`);

  const out = new Uint8Array(offset);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
