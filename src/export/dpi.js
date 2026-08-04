/**
 * DPI metadata injection for canvas-encoded PNG and JPEG bytes.
 *
 * Why this exists: `canvas.toBlob()` writes pixels and nothing else. Neither the
 * PNG `pHYs` chunk nor the JPEG JFIF density fields are emitted by any browser,
 * so a board rendered at 300 DPI arrives as a file with *no* physical
 * resolution. Photoshop, Illustrator, InDesign and every RIP then fall back to
 * 72 DPI and report the artwork as a gigantic 2000 mm poster instead of the
 * A3 the user asked for. Print shops reject those files, or worse, print them
 * scaled. These two functions patch the density metadata straight into the
 * encoded bytes after the fact, which is the only way to do it from a browser.
 *
 * Both functions are pure, DOM-free, and defensive: if the input does not look
 * like the format we expect, the original bytes are returned untouched. A
 * failed tag is a cosmetic problem; a corrupted export destroys the user's work.
 */

/* ------------------------------------------------------------------ *
 * CRC32 (PNG / zlib polynomial 0xEDB88320), table-driven, lazily built
 * ------------------------------------------------------------------ */

let crcTable = null;

function getCrcTable() {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** CRC32 over one or more byte ranges, concatenated in argument order. */
function crc32(...ranges) {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (const range of ranges) {
    for (let i = 0; i < range.length; i++) {
      c = table[(c ^ range[i]) & 0xff] ^ (c >>> 8);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ *
 * Shared byte helpers
 * ------------------------------------------------------------------ */

function readU32BE(bytes, at) {
  return (
    ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
  );
}

function writeU32BE(bytes, at, value) {
  const v = value >>> 0;
  bytes[at] = (v >>> 24) & 0xff;
  bytes[at + 1] = (v >>> 16) & 0xff;
  bytes[at + 2] = (v >>> 8) & 0xff;
  bytes[at + 3] = v & 0xff;
}

function concatBytes(parts) {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * PNG
 * ------------------------------------------------------------------ */

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function hasPngSignature(bytes) {
  if (!bytes || bytes.length < PNG_SIGNATURE.length) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

function chunkType(bytes, chunkStart) {
  // Type is the 4 ASCII bytes that follow the 4-byte length field.
  return String.fromCharCode(
    bytes[chunkStart + 4],
    bytes[chunkStart + 5],
    bytes[chunkStart + 6],
    bytes[chunkStart + 7],
  );
}

/** A complete pHYs chunk: length + type + 9 data bytes + CRC = 21 bytes. */
function buildPhysChunk(pixelsPerMetre) {
  const chunk = new Uint8Array(21);
  writeU32BE(chunk, 0, 9); // data length
  chunk[4] = 0x70; // 'p'
  chunk[5] = 0x48; // 'H'
  chunk[6] = 0x59; // 'Y'
  chunk[7] = 0x73; // 's'
  writeU32BE(chunk, 8, pixelsPerMetre); // pixels per unit, X axis
  writeU32BE(chunk, 12, pixelsPerMetre); // pixels per unit, Y axis
  chunk[16] = 1; // unit specifier: 1 = metre
  // The CRC covers the TYPE bytes plus the DATA bytes, never the length field.
  writeU32BE(chunk, 17, crc32(chunk.subarray(4, 17)));
  return chunk;
}

/**
 * Rewrites a PNG so it declares a physical resolution of `dpi`.
 *
 * Any pre-existing pHYs chunk is dropped and a fresh one is inserted directly
 * before the first IDAT (pHYs must precede the image data per the spec).
 *
 * @param {Uint8Array} bytes complete PNG file
 * @param {number} dpi dots per inch to advertise
 * @returns {Uint8Array} new PNG bytes, or the input unchanged if unparseable
 */
export function withPngDpi(bytes, dpi) {
  if (!hasPngSignature(bytes)) return bytes;

  const pixelsPerMetre = Math.round(dpi / 0.0254);
  if (!Number.isFinite(pixelsPerMetre) || pixelsPerMetre <= 0) return bytes;

  const chunks = [];
  let tail = null;
  let sawIdat = false;
  let sawIend = false;
  let at = PNG_SIGNATURE.length;

  while (at + 12 <= bytes.length) {
    const dataLength = readU32BE(bytes, at);
    const chunkEnd = at + 12 + dataLength; // length(4) + type(4) + data + crc(4)
    if (dataLength > 0x7fffffff || chunkEnd > bytes.length) return bytes; // truncated
    const type = chunkType(bytes, at);

    // Existing density chunks are discarded; everything else passes through
    // byte-for-byte so we never disturb a chunk we do not understand.
    if (type !== 'pHYs') chunks.push({ type, raw: bytes.subarray(at, chunkEnd) });
    if (type === 'IDAT') sawIdat = true;

    at = chunkEnd;

    if (type === 'IEND') {
      sawIend = true;
      if (at < bytes.length) tail = bytes.subarray(at);
      break;
    }
  }

  // Anything we could not fully account for is left alone rather than rebuilt.
  if (!sawIdat || !sawIend) return bytes;

  const parts = [bytes.subarray(0, PNG_SIGNATURE.length)];
  let inserted = false;
  for (const chunk of chunks) {
    if (!inserted && chunk.type === 'IDAT') {
      parts.push(buildPhysChunk(pixelsPerMetre));
      inserted = true;
    }
    parts.push(chunk.raw);
  }
  if (tail) parts.push(tail);

  return concatBytes(parts);
}

/* ------------------------------------------------------------------ *
 * JPEG
 * ------------------------------------------------------------------ */

/*
 * Byte layout of a JFIF APP0 segment, with offsets stated relative to the 0xFF
 * that opens the marker, because that is where the ambiguity usually bites:
 *
 *   marker + 0      0xFF
 *   marker + 1      0xE0                 APP0
 *   marker + 2..3   segment length, big-endian. Counts the two length bytes
 *                   themselves but NOT the two marker bytes. Standard JFIF
 *                   without a thumbnail is 0x0010 = 16, so the whole segment
 *                   occupies 18 bytes.
 *   marker + 4      first payload byte  -> payload offset 0
 *
 * Payload-relative offsets (payload begins at marker + 4):
 *   payload 0..4    "JFIF\0"
 *   payload 5       version major
 *   payload 6       version minor
 *   payload 7       units          1 = dots per inch, 2 = dots per cm
 *   payload 8..9    Xdensity, big-endian
 *   payload 10..11  Ydensity, big-endian
 *   payload 12      thumbnail width
 *   payload 13      thumbnail height
 */
const APP0_PAYLOAD_OFFSET = 4; // from the marker's 0xFF byte
const JFIF_UNITS_IN_PAYLOAD = 7;
const JFIF_MIN_PAYLOAD = 12; // through the end of Ydensity

function isJfifIdentifier(bytes, payloadStart, payloadLength) {
  if (payloadLength < 5) return false;
  return (
    bytes[payloadStart] === 0x4a && // J
    bytes[payloadStart + 1] === 0x46 && // F
    bytes[payloadStart + 2] === 0x49 && // I
    bytes[payloadStart + 3] === 0x46 && // F
    bytes[payloadStart + 4] === 0x00
  );
}

/**
 * Walks the marker segments looking for the JFIF APP0.
 * @returns {{ start: number, payloadLength: number } | null}
 */
function findJfifApp0(bytes) {
  let at = 2; // skip SOI
  while (at + 3 < bytes.length) {
    if (bytes[at] !== 0xff) return null; // not on a marker boundary; give up
    const marker = bytes[at + 1];

    if (marker === 0xff) {
      at++; // fill byte, marker may be padded with 0xFF
      continue;
    }
    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    // Entropy-coded data starts here; no more parseable segments.
    if (marker === 0xda || marker === 0xd9) return null;

    const segmentLength = (bytes[at + 2] << 8) | bytes[at + 3];
    if (segmentLength < 2 || at + 2 + segmentLength > bytes.length) return null;

    const payloadStart = at + APP0_PAYLOAD_OFFSET;
    const payloadLength = segmentLength - 2;
    if (marker === 0xe0 && isJfifIdentifier(bytes, payloadStart, payloadLength)) {
      return { start: at, payloadLength };
    }
    at += 2 + segmentLength;
  }
  return null;
}

/** A complete 18-byte JFIF APP0 segment declaring `dpi` in both axes. */
function buildJfifApp0(dpi) {
  const segment = new Uint8Array(18);
  segment[0] = 0xff;
  segment[1] = 0xe0;
  segment[2] = 0x00; // length high byte
  segment[3] = 0x10; // length low byte: 16 = 18 - the 2 marker bytes
  segment[4] = 0x4a; // J
  segment[5] = 0x46; // F
  segment[6] = 0x49; // I
  segment[7] = 0x46; // F
  segment[8] = 0x00;
  segment[9] = 0x01; // version major
  segment[10] = 0x01; // version minor
  segment[11] = 0x01; // units: 1 = dots per inch
  segment[12] = (dpi >>> 8) & 0xff; // Xdensity
  segment[13] = dpi & 0xff;
  segment[14] = (dpi >>> 8) & 0xff; // Ydensity
  segment[15] = dpi & 0xff;
  segment[16] = 0x00; // thumbnail width
  segment[17] = 0x00; // thumbnail height
  return segment;
}

/**
 * Rewrites a JPEG so its JFIF APP0 declares a density of `dpi` DPI.
 *
 * When the encoder already emitted a JFIF APP0 (Chrome and Firefox do) the
 * units/Xdensity/Ydensity fields are overwritten in place. Otherwise a complete
 * 18-byte JFIF APP0 is spliced in directly after the SOI marker, which is where
 * the JFIF specification requires it to live.
 *
 * @param {Uint8Array} bytes complete JPEG file
 * @param {number} dpi dots per inch to advertise
 * @returns {Uint8Array} new JPEG bytes, or the input unchanged if unparseable
 */
export function withJpegDpi(bytes, dpi) {
  if (!bytes || bytes.length < 4) return bytes;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes; // no SOI

  // Xdensity / Ydensity are unsigned 16-bit fields.
  const density = Math.max(1, Math.min(65535, Math.round(dpi)));
  if (!Number.isFinite(density)) return bytes;

  const found = findJfifApp0(bytes);

  if (found) {
    // A JFIF APP0 too short to hold the density fields is malformed; leave it be
    // rather than writing past the end of the segment.
    if (found.payloadLength < JFIF_MIN_PAYLOAD) return bytes;

    const out = bytes.slice(); // never mutate the caller's buffer
    const units = found.start + APP0_PAYLOAD_OFFSET + JFIF_UNITS_IN_PAYLOAD;
    out[units] = 1; // dots per inch
    out[units + 1] = (density >>> 8) & 0xff; // Xdensity high
    out[units + 2] = density & 0xff; // Xdensity low
    out[units + 3] = (density >>> 8) & 0xff; // Ydensity high
    out[units + 4] = density & 0xff; // Ydensity low
    return out;
  }

  return concatBytes([
    bytes.subarray(0, 2), // SOI
    buildJfifApp0(density),
    bytes.subarray(2),
  ]);
}
