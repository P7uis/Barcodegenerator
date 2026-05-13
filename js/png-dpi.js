/**
 * Embeds a physical pixel-density (pHYs) chunk into a PNG data URL so the
 * exported file declares a real-world DPI. Without it, consumers like Word,
 * Pages, Keynote and most browsers fall back to ~96 DPI, which makes a QR
 * rendered at 300 DPI come out around 3.1x too big when placed at "natural"
 * size.
 *
 * Reference: https://www.w3.org/TR/PNG/#11pHYs
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const DATA_URL_PREFIX = "data:image/png;base64,";
const METRES_PER_INCH = 0.0254;

/** @type {Uint32Array | null} */
let crcTable = null;

function getCrcTable() {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/**
 * @param {Uint8Array} bytes
 * @returns {number}
 */
function crc32(bytes) {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {Uint8Array} b
 * @param {number} p
 */
function readUint32BE(b, p) {
  return ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
}

/**
 * @param {number} ppm Pixels per metre (X and Y).
 * @returns {Uint8Array} A complete pHYs chunk including length, type and CRC.
 */
function buildPhysChunk(ppm) {
  const chunk = new Uint8Array(21);
  chunk[0] = 0;
  chunk[1] = 0;
  chunk[2] = 0;
  chunk[3] = 9;
  chunk[4] = 0x70;
  chunk[5] = 0x48;
  chunk[6] = 0x59;
  chunk[7] = 0x73;
  chunk[8] = (ppm >>> 24) & 0xff;
  chunk[9] = (ppm >>> 16) & 0xff;
  chunk[10] = (ppm >>> 8) & 0xff;
  chunk[11] = ppm & 0xff;
  chunk[12] = (ppm >>> 24) & 0xff;
  chunk[13] = (ppm >>> 16) & 0xff;
  chunk[14] = (ppm >>> 8) & 0xff;
  chunk[15] = ppm & 0xff;
  chunk[16] = 1;
  const crc = crc32(chunk.subarray(4, 17));
  chunk[17] = (crc >>> 24) & 0xff;
  chunk[18] = (crc >>> 16) & 0xff;
  chunk[19] = (crc >>> 8) & 0xff;
  chunk[20] = crc & 0xff;
  return chunk;
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToBase64(bytes) {
  let s = "";
  const slice = 0x8000;
  for (let i = 0; i < bytes.length; i += slice) {
    s += String.fromCharCode.apply(null, /** @type {number[]} */ (
      Array.from(bytes.subarray(i, Math.min(i + slice, bytes.length)))
    ));
  }
  return btoa(s);
}

/**
 * Returns a PNG data URL with a pHYs chunk announcing the supplied DPI. Any
 * existing pHYs chunk is replaced. If the input does not look like a PNG data
 * URL (or decoding fails) the original string is returned unchanged so the
 * caller's download path keeps working.
 *
 * @param {string} dataUrl
 * @param {number} dpi
 * @returns {string}
 */
export function injectPngDpi(dataUrl, dpi) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(DATA_URL_PREFIX)) {
    return dataUrl;
  }
  if (!Number.isFinite(dpi) || dpi <= 0) {
    return dataUrl;
  }

  let binary;
  try {
    binary = atob(dataUrl.slice(DATA_URL_PREFIX.length));
  } catch {
    return dataUrl;
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return dataUrl;
  }

  const keepChunks = [];
  let firstIdatIndex = -1;
  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const len = readUint32BE(bytes, pos);
    const total = 12 + len;
    if (pos + total > bytes.length) break;
    const type = String.fromCharCode(
      bytes[pos + 4],
      bytes[pos + 5],
      bytes[pos + 6],
      bytes[pos + 7]
    );
    if (type !== "pHYs") {
      if (type === "IDAT" && firstIdatIndex === -1) {
        firstIdatIndex = keepChunks.length;
      }
      keepChunks.push(bytes.subarray(pos, pos + total));
    }
    pos += total;
    if (type === "IEND") break;
  }
  if (firstIdatIndex === -1) return dataUrl;

  const ppm = Math.max(1, Math.round(dpi / METRES_PER_INCH));
  const phys = buildPhysChunk(ppm);

  let totalLen = 8 + phys.length;
  for (const c of keepChunks) totalLen += c.length;

  const out = new Uint8Array(totalLen);
  out.set(bytes.subarray(0, 8), 0);
  let off = 8;
  for (let i = 0; i < keepChunks.length; i += 1) {
    if (i === firstIdatIndex) {
      out.set(phys, off);
      off += phys.length;
    }
    out.set(keepChunks[i], off);
    off += keepChunks[i].length;
  }

  return DATA_URL_PREFIX + bytesToBase64(out);
}
