const JSONP_TIMEOUT_MS = 18000;

function loadJsonp(url, callbackName) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Shortening request timed out."));
    }, JSONP_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      delete window[callbackName];
      script.removeEventListener("error", onScriptError);
      script.remove();
    }

    function onScriptError() {
      cleanup();
      reject(new Error("Could not reach shortening service."));
    }

    window[callbackName] = (data) => {
      cleanup();
      if (data && typeof data.errorcode === "number") {
        reject(new Error(data.errormessage || "Shortening failed."));
        return;
      }
      if (data && data.shorturl) {
        resolve(String(data.shorturl).trim());
        return;
      }
      reject(new Error("Unexpected response from shortening service."));
    };

    script.async = true;
    script.addEventListener("error", onScriptError);
    script.src = url;
    document.body.appendChild(script);
  });
}

function shortenWithProvider(longUrl, provider) {
  const base = provider === "vgd" ? "https://v.gd" : "https://is.gd";
  const cb = `qrLinkShort_cb_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  const url = `${base}/create.php?format=json&url=${encodeURIComponent(longUrl)}&callback=${encodeURIComponent(cb)}`;
  return loadJsonp(url, cb);
}

async function shortenUrlAuto(longUrl) {
  try {
    return await shortenWithProvider(longUrl, "isgd");
  } catch (e1) {
    try {
      return await shortenWithProvider(longUrl, "vgd");
    } catch (e2) {
      const a = e1 instanceof Error ? e1.message : String(e1);
      const b = e2 instanceof Error ? e2.message : String(e2);
      throw new Error(`${a} (${b})`);
    }
  }
}

function loadQrModule() {
  if (!window.QRCode || typeof window.QRCode.create !== "function") {
    return Promise.reject(new Error("Could not load the local QR code library."));
  }
  return Promise.resolve(window.QRCode);
}

function loadJsPdf() {
  const jsPDF = window.jspdf && window.jspdf.jsPDF;
  if (typeof jsPDF !== "function") {
    return Promise.reject(new Error("Could not load the local jsPDF library."));
  }
  return Promise.resolve(jsPDF);
}

function loadJsBarcodeLib() {
  if (typeof window.JsBarcode !== "function") {
    return Promise.reject(new Error("Could not load the local JsBarcode library."));
  }
  return Promise.resolve(window.JsBarcode);
}

// --- PNG pHYs (physical pixel density) injection -----------------------------
// Browser canvases export PNGs without any DPI metadata, which makes Word,
// Pages, Keynote and most viewers fall back to ~96 DPI when placing the image
// "at natural size". For a QR rendered at 300 DPI that produces an image
// roughly 3.1x too big. Splicing a pHYs chunk in front of IDAT pins the file
// to the requested DPI so it lands at the correct physical size.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const METRES_PER_INCH = 0.0254;

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

function crc32(bytes) {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function readUint32BE(b, p) {
  return ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
}

function buildPhysChunk(ppm) {
  const chunk = new Uint8Array(21);
  chunk[0] = 0; chunk[1] = 0; chunk[2] = 0; chunk[3] = 9;
  chunk[4] = 0x70; chunk[5] = 0x48; chunk[6] = 0x59; chunk[7] = 0x73;
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

function bytesToBase64(bytes) {
  let s = "";
  const slice = 0x8000;
  for (let i = 0; i < bytes.length; i += slice) {
    s += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, Math.min(i + slice, bytes.length)))
    );
  }
  return btoa(s);
}

function injectPngDpi(dataUrl, dpi) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    return dataUrl;
  }
  if (!Number.isFinite(dpi) || dpi <= 0) return dataUrl;

  let binary;
  try {
    binary = atob(dataUrl.slice(PNG_DATA_URL_PREFIX.length));
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
      bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]
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

  return PNG_DATA_URL_PREFIX + bytesToBase64(out);
}

function fillRoundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, rr);
  } else {
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
  }
  ctx.closePath();
  ctx.fill();
}

function fillCircle(ctx, cx, cy, radius) {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
}

function getLogoGeometry(canvasEl, img, logoSidePx) {
  const w = canvasEl.width;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (!iw || !ih || !logoSidePx) return null;

  const maxSide = Math.max(1, Math.round(logoSidePx));
  const scale = Math.min(maxSide / iw, maxSide / ih);
  const lw = Math.max(1, Math.round(iw * scale));
  const lh = Math.max(1, Math.round(ih * scale));
  return {
    x: Math.round((w - lw) / 2),
    y: Math.round((w - lh) / 2),
    width: lw,
    height: lh,
  };
}

function drawCenterLogo(canvasEl, img, logoSidePx) {
  const ctx = canvasEl.getContext("2d");
  if (!ctx) return;
  const geom = getLogoGeometry(canvasEl, img, logoSidePx);
  if (!geom) return;

  ctx.save();
  ctx.drawImage(img, geom.x, geom.y, geom.width, geom.height);
  ctx.restore();
}

function isDark(qrModules, x, y) {
  if (!qrModules) return false;
  if (typeof qrModules.get === "function") return Boolean(qrModules.get(x, y));
  if (Array.isArray(qrModules.data) && typeof qrModules.size === "number") {
    return Boolean(qrModules.data[y * qrModules.size + x]);
  }
  return false;
}

function isInFinder(x, y, size) {
  return (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);
}

function drawModule(ctx, px, py, unit, shape) {
  if (shape === "dots") {
    fillCircle(ctx, px + unit / 2, py + unit / 2, unit * 0.38);
    return;
  }
  if (shape === "rounded") {
    fillRoundRect(ctx, px, py, unit, unit, unit * 0.32);
    return;
  }
  ctx.fillRect(px, py, unit, unit);
}

function drawFinder(ctx, left, top, unit, finderShape) {
  const outer = unit * 7;
  const innerCut = unit * 5;
  const center = unit * 3;
  const outerRadius = finderShape === "square" ? 0 : unit * 1.2;
  const centerRadius = finderShape === "square" ? 0 : unit * 0.9;
  const innerRadius = Math.max(0, outerRadius - unit * 0.45);

  // Paint the inner ring with opaque white instead of erasing it via
  // destination-out, otherwise the saved PNG ends up with transparent rings
  // where the white quiet-zone of each finder square should be.
  fillRoundRect(ctx, left, top, outer, outer, outerRadius);
  ctx.save();
  ctx.fillStyle = "#ffffff";
  fillRoundRect(ctx, left + unit, top + unit, innerCut, innerCut, innerRadius);
  ctx.restore();
  fillRoundRect(ctx, left + unit * 2, top + unit * 2, center, center, centerRadius);
}

function createLogoMask(canvasEl, img, logoSidePx) {
  const geom = getLogoGeometry(canvasEl, img, logoSidePx);
  if (!geom) return null;
  const mask = document.createElement("canvas");
  mask.width = canvasEl.width;
  mask.height = canvasEl.height;
  const maskCtx = mask.getContext("2d", { willReadFrequently: true });
  if (!maskCtx) return null;
  maskCtx.clearRect(0, 0, mask.width, mask.height);
  maskCtx.drawImage(img, geom.x, geom.y, geom.width, geom.height);
  return {
    data: maskCtx.getImageData(0, 0, mask.width, mask.height).data,
    width: mask.width,
    bounds: geom,
  };
}

function rectIntersectsLogoMask(mask, left, top, right, bottom) {
  if (!mask) return false;
  if (right <= mask.bounds.x || left >= mask.bounds.x + mask.bounds.width) return false;
  if (bottom <= mask.bounds.y || top >= mask.bounds.y + mask.bounds.height) return false;

  const x0 = Math.max(mask.bounds.x, Math.floor(left));
  const y0 = Math.max(mask.bounds.y, Math.floor(top));
  const x1 = Math.min(mask.bounds.x + mask.bounds.width, Math.ceil(right));
  const y1 = Math.min(mask.bounds.y + mask.bounds.height, Math.ceil(bottom));
  for (let y = y0; y < y1; y += 1) {
    let idx = (y * mask.width + x0) * 4 + 3;
    for (let x = x0; x < x1; x += 1) {
      if (mask.data[idx] > LOGO_ALPHA_THRESHOLD) return true;
      idx += 4;
    }
  }
  return false;
}

function paintStyledQr(canvasEl, qrData, width, margin, shape, logoImage, logoSidePx) {
  const modules = qrData.modules;
  const size = modules.size;
  const fullCount = size + margin * 2;
  const unit = width / fullCount;
  const ctx = canvasEl.getContext("2d");
  if (!ctx) throw new Error("Unable to get 2D canvas context.");

  canvasEl.width = width;
  canvasEl.height = width;
  ctx.clearRect(0, 0, width, width);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, width);
  ctx.fillStyle = "#000000";
  const logoMask = logoImage ? createLogoMask(canvasEl, logoImage, logoSidePx) : null;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!isDark(modules, x, y) || isInFinder(x, y, size)) continue;
      const px = (x + margin) * unit;
      const py = (y + margin) * unit;
      if (rectIntersectsLogoMask(logoMask, px, py, px + unit, py + unit)) continue;
      drawModule(ctx, px, py, unit, shape);
    }
  }

  const finderShape = shape === "dots" ? "rounded" : shape;
  drawFinder(ctx, margin * unit, margin * unit, unit, finderShape);
  drawFinder(ctx, (margin + size - 7) * unit, margin * unit, unit, finderShape);
  drawFinder(ctx, margin * unit, (margin + size - 7) * unit, unit, finderShape);
}

function renderQrToCanvas(canvasEl, text, QRCode, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const logo = options.logoImage && options.logoImage.complete ? options.logoImage : null;
      const qrData = QRCode.create(text, { errorCorrectionLevel: logo ? "H" : "M" });
      const logoSidePx = logo ? options.logoSizePx || Math.round((options.width || 256) * 0.22) : 0;
      paintStyledQr(canvasEl, qrData, options.width || 256, options.margin || 2, options.moduleShape || "square", logo, logoSidePx);
      if (logo && logo.naturalWidth > 0) {
        drawCenterLogo(canvasEl, logo, logoSidePx);
      }
      resolve();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/**
 * Renders a 1D barcode (Code 128, EAN, UPC, etc.) onto the supplied canvas.
 * JsBarcode chooses the bar count + size on its own, so we first let it draw
 * to an offscreen canvas and then resample onto the visible canvas at the
 * requested pixel width, preserving aspect ratio. Nearest-neighbour scaling
 * keeps bar edges crisp.
 *
 * @param {HTMLCanvasElement} canvasEl
 * @param {string} text
 * @param {Function} JsBarcode
 * @param {{ format: string, widthPx: number }} options
 * @returns {Promise<void>}
 */
function renderBarcodeToCanvas(canvasEl, text, JsBarcode, options) {
  return new Promise((resolve, reject) => {
    try {
      const off = document.createElement("canvas");
      let invalid = null;
      JsBarcode(off, text, {
        format: options.format,
        width: 3,
        height: 100,
        displayValue: true,
        background: "#ffffff",
        lineColor: "#000000",
        // margin: 0 keeps the chosen "outer size" === the measured barcode
        // width. The surrounding white paper/page typically provides the
        // scan-quiet-zone.
        margin: 0,
        textMargin: 4,
        fontSize: 20,
        font: "system-ui, sans-serif",
        valid: (ok) => {
          if (!ok) invalid = true;
        },
      });
      if (invalid || !off.width || !off.height) {
        reject(new Error(`Value is not valid for ${options.format}.`));
        return;
      }
      const aspect = off.height / off.width;
      const w = Math.max(64, Math.round(options.widthPx));
      const h = Math.max(16, Math.round(w * aspect));
      canvasEl.width = w;
      canvasEl.height = h;
      const ctx = canvasEl.getContext("2d");
      if (!ctx) {
        reject(new Error("Unable to get 2D canvas context."));
        return;
      }
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(off, 0, 0, w, h);
      resolve();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

const THEME_KEY = "barcode-creator-theme";
const LANG_KEY = "barcode-creator-lang";
const CAL_KEY = "barcode-creator-cmcalibration";
const CAL_BAR_TARGET_CM = 5;
const PRINT_DPI = 300;
const CM_PER_INCH = 2.54;
const PX_PER_CM = PRINT_DPI / CM_PER_INCH;
// Per CSS spec, 1in = 96 CSS px → 1cm ≈ 37.795 CSS px. This is only correct
// on a "reference" 96 PPI display; on Retina / hi-DPI screens at non-default
// scaling the browser still uses this constant, so the user calibrates it
// against a physical ruler once and we store the result per device.
const DEFAULT_PX_PER_CM_DISPLAY = 96 / CM_PER_INCH;
const MIN_QR_CM = 1;
const MAX_QR_CM = 1000;
const QR_SLIDER_MIN_CM = 2;
const QR_SLIDER_MAX_CM = 10;
const MAX_PDF_QR_MM = 200;
const MIN_LOGO_CM = 0.3;
const MAX_LOGO_SIDE_FRACTION = 0.28;
const LOGO_ALPHA_THRESHOLD = 8;

// Barcode-type -> JsBarcode format + content guidance. "qr" uses the existing
// QRCode pipeline; everything else routes through JsBarcode.
const BARCODE_TYPES = {
  qr: { kind: "qr" },
  code128: { kind: "1d", jsbFormat: "CODE128", placeholder: "ABC-1234" },
  ean13: { kind: "1d", jsbFormat: "EAN13", placeholder: "5901234123457" },
  ean8: { kind: "1d", jsbFormat: "EAN8", placeholder: "96385074" },
  upca: { kind: "1d", jsbFormat: "UPC", placeholder: "036000291452" },
  code39: { kind: "1d", jsbFormat: "CODE39", placeholder: "ABC1234" },
  itf: { kind: "1d", jsbFormat: "ITF", placeholder: "12345678" },
  codabar: { kind: "1d", jsbFormat: "codabar", placeholder: "A1234B" },
};

const input = document.getElementById("payload");
const sizeInput = document.getElementById("qr-size-cm");
const sizeSlider = document.getElementById("qr-size-slider");
const sizeValue = document.getElementById("qr-size-value");
const barcodeTypeSelect = document.getElementById("barcode-type");
const modeSelect = document.getElementById("mode-select");
const shapeSelect = document.getElementById("shape-select");
const langButtons = Array.from(document.querySelectorAll(".lang-switcher [data-lang]"));
const chkShorten = document.getElementById("opt-shorten");
const chkLogo = document.getElementById("opt-logo");
const logoFile = document.getElementById("logo-file");
const logoUrlInput = document.getElementById("logo-url");
const logoSizeInput = document.getElementById("logo-size");
const logoSizeValue = document.getElementById("logo-size-value");
const themeButtons = Array.from(document.querySelectorAll(".theme-btn[data-theme-pref]"));
const btnGen = document.getElementById("generate");
const btnDl = document.getElementById("download");
const btnPdf = document.getElementById("download-pdf");
const errEl = document.getElementById("error");
const preview = document.getElementById("preview");
const canvas = document.getElementById("qr-canvas");
const encodedEl = document.getElementById("encoded-text");
const qrOnlyElements = Array.from(document.querySelectorAll(".qr-only"));
const generatorOnlyElements = Array.from(document.querySelectorAll(".generator-only"));
const scannerOnlyElements = Array.from(document.querySelectorAll(".scanner-only"));
const calBar = document.getElementById("calibrate-bar");
const calTrack = document.getElementById("calibrate-track");

// Scanner-related DOM refs (all may be null if scanner UI is omitted by a fork).
const scannerVideo = /** @type {HTMLVideoElement|null} */ (document.getElementById("scanner-video"));
const scannerStatus = document.getElementById("scanner-status");
const scannerStartBtn = document.getElementById("scanner-start");
const scannerStopBtn = document.getElementById("scanner-stop");
const scannerCopyBtn = document.getElementById("scanner-copy");
const scannerAgainBtn = document.getElementById("scanner-again");
const scannerOpenLink = /** @type {HTMLAnchorElement|null} */ (document.getElementById("scanner-open"));
const scannerResult = document.getElementById("scanner-result");
const scannerResultText = document.getElementById("scanner-result-text");
const scannerResultFormat = document.getElementById("scanner-result-format");

// Browser BarcodeDetector format list to request. We intersect with the set
// the browser actually supports at runtime (Chromium ≥ 87 covers most of
// these; Safari 17+ covers the common ones; Firefox is unsupported).
const SCAN_FORMATS = [
  "qr_code",
  "code_128",
  "code_39",
  "code_93",
  "codabar",
  "ean_13",
  "ean_8",
  "itf",
  "upc_a",
  "upc_e",
  "data_matrix",
  "pdf417",
  "aztec",
];
const SCAN_BELL_DURATION_MS = 1550;
const SCAN_BELL_STRIKE_GAP_MS = 280;
const SCAN_BELL_VOLUME = 1.0;
const SCAN_BELL_PARTIALS = [
  { frequency: 880, gain: 1, drift: 0.96, decay: 0.9 },
  { frequency: 1320, gain: 0.74, drift: 0.965, decay: 0.78 },
  { frequency: 1760, gain: 0.56, drift: 0.97, decay: 0.66 },
  { frequency: 2440, gain: 0.34, drift: 0.975, decay: 0.48 },
  { frequency: 3320, gain: 0.2, drift: 0.98, decay: 0.26 },
];

let scannerRunning = false;
/** @type {MediaStream|null} */ let scannerStream = null;
/** @type {any} */ let barcodeDetector = null;
let scannerRafId = 0;
/** @type {AudioContext|null} */ let scannerAudioContext = null;

// Lazy-loaded jsQR polyfill (QR-only) used when the browser does not ship a
// native BarcodeDetector. Loaded on demand from `vendor/jsqr.js`.
/** @type {((data: Uint8ClampedArray, width: number, height: number) => any)|null} */
let jsQrFn = null;
let jsQrLoading = null;
/** @type {HTMLCanvasElement|null} */
let jsQrSampleCanvas = null;

function loadJsQrLib() {
  if (jsQrFn) return Promise.resolve(jsQrFn);
  if (typeof window !== "undefined" && typeof window.jsQR === "function") {
    jsQrFn = window.jsQR;
    return Promise.resolve(jsQrFn);
  }
  if (jsQrLoading) return jsQrLoading;
  jsQrLoading = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-jsqr="1"]');
    const handle = (script) => {
      script.addEventListener("load", () => {
        if (typeof window.jsQR === "function") {
          jsQrFn = window.jsQR;
          resolve(jsQrFn);
        } else {
          reject(new Error("jsQR did not register a global"));
        }
      });
      script.addEventListener("error", () => reject(new Error("Failed to load jsQR polyfill")));
    };
    if (existing) {
      handle(existing);
    } else {
      const s = document.createElement("script");
      s.src = "./vendor/jsqr.js";
      s.async = true;
      s.dataset.jsqr = "1";
      handle(s);
      document.head.appendChild(s);
    }
  });
  return jsQrLoading;
}

/** @type {string | null} */
let lastEncodedPayload = null;
let lastQrSizeCm = 4;
/** Aspect ratio (height / width) of the last successful render. QR = 1.0,
 *  1D barcodes are wider than they are tall. Used for PDF placement. */
let lastCanvasAspect = 1;
let currentBarcodeType = "qr";

/**
 * Number of CSS px that represent one physical centimetre on the user's
 * screen. Loaded from localStorage; falls back to the CSS-spec assumption
 * of 96 DPI (≈37.795 px/cm) on first visit.
 */
let cmPxFactor = loadCalibration();

function loadCalibration() {
  try {
    const v = parseFloat(localStorage.getItem(CAL_KEY));
    if (Number.isFinite(v) && v >= 10 && v <= 200) return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_PX_PER_CM_DISPLAY;
}

function persistCalibration(pxPerCm) {
  try {
    localStorage.setItem(CAL_KEY, String(pxPerCm));
  } catch {
    /* ignore */
  }
}

/** @type {HTMLImageElement | null} */
let logoImageFromFile = null;

/** @type {"en" | "nl" | "de"} */
let currentLanguage = "en";

const I18N = {
  en: {
    pageTitle: "Barcode Creator Tool",
    headerTitle: "Barcode Creator Tool",
    lead:
      "Generate a QR code or a common 1D barcode (Code 128, EAN, UPC, Code 39, ITF, Codabar). QR codes also support a center logo and link shortening.",
    languageLabel: "Language",
    themeLabel: "Theme",
    themeAutoAria: "Auto theme",
    themeLightAria: "Light theme",
    themeDarkAria: "Dark theme",
    themeAuto: "Auto",
    themeLight: "Light",
    themeDark: "Dark",
    barcodeTypeLabel: "Barcode type",
    modeLabel: "Content type",
    modeUrl: "Web link",
    modeText: "Plain text",
    payloadLabelUrl: "Web address",
    payloadPlaceholderUrl: "https://example.com/page",
    payloadLabelText: "Text content",
    payloadPlaceholderText: "Type any text you want to encode",
    payloadLabelBarcode: "Barcode value",
    shapeLabel: "QR style",
    shapeSquare: "Square",
    shapeRounded: "Rounded",
    shapeDots: "Dots",
    sizeLabel: "Outer size (cm)",
    calibrateHint:
      "Line up the bar's left edge with 0 on a physical ruler, then drag its right edge to exactly 5\u00a0cm. Saved for next visit.",
    shortenLabel: "Shorten link first (is.gd, then v.gd)",
    shortenHint: "Shorten your link so a smaller QR code works better.",
    logoLabel: "Center logo on the QR",
    logoHint:
      "Uses high error correction. QR dots under visible logo pixels are removed. Remote logos require CORS headers for PNG export.",
    logoUrlLabel: "Logo image URL (https, optional)",
    logoUrlPlaceholder: "https://example.com/logo.png",
    logoFileLabel: "Or local file",
    logoSizeLabel: "Center logo max side (cm)",
    generate: "Generate",
    working: "Working...",
    download: "Download PNG",
    downloadPdf: "Download A4 PDF",
    hint:
      "If a web address has no scheme, https:// is assumed. QR / barcode / PDF libraries are bundled locally; link shortening uses is.gd/v.gd.",
    encodedPrefix: "Encoded:",
    errEnterAddress: "Enter a web address.",
    errInvalidAddress: "That does not look like a valid http(s) link.",
    errEnterText: "Enter some text to encode.",
    errEnterBarcodeValue: "Enter a value for the barcode.",
    errInvalidBarcodeValue: "That value is not valid for the selected barcode type.",
    errLogoRead: "Could not read that image file.",
    errLogoUrlInvalid: "Logo URL must be a valid http(s) address.",
    errLogoMissing: "Add a logo URL and/or local logo file, or turn off the logo option.",
    errGenerateFirst: "Generate a barcode first.",
    errDownloadFailed:
      "Download failed (canvas may be tainted). Try a logo file instead of URL, or a CORS-enabled logo URL.",
    errInvalidSize: "Enter a valid size between 1 and 1000 cm.",
    errPdfTooLarge: "For A4 export, choose a size up to 20 cm.",
    scannerOption: "Barcode scanner",
    scannerShortcut: "Scan a code",
    scannerShortcutAria: "Switch to barcode scanner",
    scannerTitle: "Camera scanner",
    leadScanner:
      "Point your camera at a QR code or 1D barcode (Code 128, EAN, UPC, Code 39, ITF, Codabar, Data Matrix, PDF417, Aztec). The result appears below.",
    scannerStartHelp: "Click Start to scan with your camera.",
    scannerStart: "Start scan",
    scannerStop: "Stop",
    scannerScanning: "Scanning... point at a code.",
    scannerScanningQrOnly: "Scanning for QR codes... (1D barcodes need a browser with native barcode detection).",
    scannerLoadingFallback: "Loading QR fallback...",
    scannerScanAgain: "Scan again",
    scannerCopy: "Copy",
    scannerCopied: "Copied!",
    scannerOpenLink: "Open link",
    scannerStopped: "Scanner stopped.",
    scannerNotSupported:
      "Your browser does not support barcode scanning. Try Chrome, Edge, or Safari 17+.",
    scannerNeedsHttps:
      "Camera access requires an https:// page or localhost. Open this app from a web server, not from a file:// URL.",
    scannerPermissionDenied:
      "Camera permission denied. Allow camera access in your browser settings and try again.",
    scannerNoCamera: "No camera was found on this device.",
    scannerCameraError: "Could not start the camera.",
  },
  nl: {
    pageTitle: "Barcode Maker Tool",
    headerTitle: "Barcode Maker Tool",
    lead:
      "Genereer een QR-code of een veelgebruikte 1D-barcode (Code 128, EAN, UPC, Code 39, ITF, Codabar). QR-codes ondersteunen ook een centraal logo en linkverkorting.",
    languageLabel: "Taal",
    themeLabel: "Thema",
    themeAutoAria: "Automatisch thema",
    themeLightAria: "Licht thema",
    themeDarkAria: "Donker thema",
    themeAuto: "Auto",
    themeLight: "Licht",
    themeDark: "Donker",
    barcodeTypeLabel: "Barcodetype",
    modeLabel: "Inhoudstype",
    modeUrl: "Weblink",
    modeText: "Tekst",
    payloadLabelUrl: "Webadres",
    payloadPlaceholderUrl: "https://voorbeeld.nl/pagina",
    payloadLabelText: "Tekstinhoud",
    payloadPlaceholderText: "Typ tekst die je wilt coderen",
    payloadLabelBarcode: "Barcodewaarde",
    shapeLabel: "QR-stijl",
    shapeSquare: "Vierkant",
    shapeRounded: "Afgerond",
    shapeDots: "Punten",
    sizeLabel: "Buitenmaat (cm)",
    calibrateHint:
      "Leg de linkerrand van de balk op 0 van een echte liniaal en sleep de rechterrand naar exact 5\u00a0cm. Wordt bewaard voor je volgende bezoek.",
    shortenLabel: "Link eerst inkorten (is.gd, daarna v.gd)",
    shortenHint: "Laat je Link inkorten zodat een kleinere QR code beter werkt.",
    logoLabel: "Centraal logo op de QR",
    logoHint:
      "Gebruikt hoge foutcorrectie. QR-punten onder zichtbare logopixels worden verwijderd. Externe logo's vereisen CORS-headers voor PNG-export.",
    logoUrlLabel: "URL van logo-afbeelding (https, optioneel)",
    logoUrlPlaceholder: "https://voorbeeld.nl/logo.png",
    logoFileLabel: "Of lokaal bestand",
    logoSizeLabel: "Maximale logozijde (cm)",
    generate: "Genereer",
    working: "Bezig...",
    download: "Download PNG",
    downloadPdf: "Download A4-PDF",
    hint:
      "Als een webadres geen schema heeft, wordt https:// toegevoegd. QR-/barcode-/PDF-bibliotheken zijn lokaal gebundeld; inkorten gebruikt is.gd/v.gd.",
    encodedPrefix: "Gecodeerd:",
    errEnterAddress: "Vul een webadres in.",
    errInvalidAddress: "Dit lijkt geen geldige http(s)-url.",
    errEnterText: "Vul tekst in om te coderen.",
    errEnterBarcodeValue: "Vul een waarde in voor de barcode.",
    errInvalidBarcodeValue: "Deze waarde is niet geldig voor het gekozen barcodetype.",
    errLogoRead: "Kon dit afbeeldingsbestand niet lezen.",
    errLogoUrlInvalid: "De logo-URL moet een geldige http(s)-url zijn.",
    errLogoMissing: "Voeg een logo-URL en/of lokaal logo toe, of zet logo uit.",
    errGenerateFirst: "Genereer eerst een barcode.",
    errDownloadFailed:
      "Download mislukt (canvas is mogelijk vervuild). Gebruik een lokaal logo of een URL met CORS.",
    errInvalidSize: "Vul een geldige grootte in tussen 1 en 1000 cm.",
    errPdfTooLarge: "Kies voor A4-export een grootte van maximaal 20 cm.",
    scannerOption: "Barcode-scanner",
    scannerShortcut: "Scan een code",
    scannerShortcutAria: "Wissel naar barcode-scanner",
    scannerTitle: "Camerascanner",
    leadScanner:
      "Richt je camera op een QR-code of 1D-barcode (Code 128, EAN, UPC, Code 39, ITF, Codabar, Data Matrix, PDF417, Aztec). Het resultaat verschijnt hieronder.",
    scannerStartHelp: "Klik op Start om met je camera te scannen.",
    scannerStart: "Start scan",
    scannerStop: "Stop",
    scannerScanning: "Bezig met scannen... richt op een code.",
    scannerScanningQrOnly: "Bezig met scannen voor QR-codes... (1D-barcodes vereisen een browser met ingebouwde barcode-detectie).",
    scannerLoadingFallback: "QR-fallback wordt geladen...",
    scannerScanAgain: "Opnieuw scannen",
    scannerCopy: "Kopieer",
    scannerCopied: "Gekopieerd!",
    scannerOpenLink: "Open link",
    scannerStopped: "Scanner gestopt.",
    scannerNotSupported:
      "Je browser ondersteunt geen barcode-scannen. Probeer Chrome, Edge of Safari 17+.",
    scannerNeedsHttps:
      "Cameratoegang vereist een https://-pagina of localhost. Open deze app via een webserver, niet via een file://-URL.",
    scannerPermissionDenied:
      "Geen toestemming voor camera. Sta camera-toegang toe in je browser en probeer opnieuw.",
    scannerNoCamera: "Er is geen camera gevonden op dit apparaat.",
    scannerCameraError: "Kon de camera niet starten.",
  },
  de: {
    pageTitle: "Barcode-Generator",
    headerTitle: "Barcode-Generator",
    lead:
      "Erstelle einen QR-Code oder eine gaengige 1D-Barcode (Code 128, EAN, UPC, Code 39, ITF, Codabar). QR-Codes unterstuetzen zusaetzlich ein zentrales Logo und Link-Kuerzung.",
    languageLabel: "Sprache",
    themeLabel: "Design",
    themeAutoAria: "Automatisches Design",
    themeLightAria: "Helles Design",
    themeDarkAria: "Dunkles Design",
    themeAuto: "Auto",
    themeLight: "Hell",
    themeDark: "Dunkel",
    barcodeTypeLabel: "Barcode-Typ",
    modeLabel: "Inhaltstyp",
    modeUrl: "Weblink",
    modeText: "Text",
    payloadLabelUrl: "Webadresse",
    payloadPlaceholderUrl: "https://beispiel.de/seite",
    payloadLabelText: "Textinhalt",
    payloadPlaceholderText: "Beliebigen Text eingeben",
    payloadLabelBarcode: "Barcode-Wert",
    shapeLabel: "QR-Stil",
    shapeSquare: "Quadratisch",
    shapeRounded: "Abgerundet",
    shapeDots: "Punkte",
    sizeLabel: "Aussenmass (cm)",
    calibrateHint:
      "Richte die linke Kante des Balkens an 0 auf einem echten Lineal aus und ziehe die rechte Kante exakt auf 5\u00a0cm. Wird fuer den naechsten Besuch gespeichert.",
    shortenLabel: "Link zuerst kuerzen (is.gd, dann v.gd)",
    shortenHint: "Kuerze deinen Link, damit ein kleinerer QR-Code besser funktioniert.",
    logoLabel: "Zentrales Logo auf dem QR",
    logoHint:
      "Verwendet eine hohe Fehlerkorrektur. QR-Punkte unter sichtbaren Logo-Pixeln werden entfernt. Externe Logos benoetigen CORS-Header fuer den PNG-Export.",
    logoUrlLabel: "URL des Logo-Bildes (https, optional)",
    logoUrlPlaceholder: "https://beispiel.de/logo.png",
    logoFileLabel: "Oder lokale Datei",
    logoSizeLabel: "Maximale Logo-Seite (cm)",
    generate: "Erstellen",
    working: "Wird erstellt...",
    download: "PNG herunterladen",
    downloadPdf: "A4-PDF herunterladen",
    hint:
      "Wenn eine Webadresse kein Schema hat, wird https:// angenommen. QR-, Barcode- und PDF-Bibliotheken sind lokal gebuendelt; Kuerzen nutzt is.gd/v.gd.",
    encodedPrefix: "Kodiert:",
    errEnterAddress: "Bitte eine Webadresse eingeben.",
    errInvalidAddress: "Das sieht nicht wie eine gueltige http(s)-URL aus.",
    errEnterText: "Bitte Text zum Kodieren eingeben.",
    errEnterBarcodeValue: "Bitte einen Wert fuer den Barcode eingeben.",
    errInvalidBarcodeValue: "Dieser Wert ist fuer den gewaehlten Barcode-Typ ungueltig.",
    errLogoRead: "Die Bilddatei konnte nicht gelesen werden.",
    errLogoUrlInvalid: "Die Logo-URL muss eine gueltige http(s)-Adresse sein.",
    errLogoMissing: "Bitte eine Logo-URL und/oder eine lokale Datei hinzufuegen oder die Logo-Option deaktivieren.",
    errGenerateFirst: "Zuerst einen Barcode erzeugen.",
    errDownloadFailed:
      "Download fehlgeschlagen (Canvas moeglicherweise \"tainted\"). Verwende eine lokale Datei oder eine CORS-faehige URL.",
    errInvalidSize: "Bitte eine gueltige Groesse zwischen 1 und 1000 cm eingeben.",
    errPdfTooLarge: "Fuer den A4-Export bitte eine Groesse bis maximal 20 cm waehlen.",
    scannerOption: "Barcode-Scanner",
    scannerShortcut: "Code scannen",
    scannerShortcutAria: "Zum Barcode-Scanner wechseln",
    scannerTitle: "Kamerascanner",
    leadScanner:
      "Richte die Kamera auf einen QR-Code oder 1D-Barcode (Code 128, EAN, UPC, Code 39, ITF, Codabar, Data Matrix, PDF417, Aztec). Das Ergebnis erscheint unten.",
    scannerStartHelp: "Klicke auf Start, um mit deiner Kamera zu scannen.",
    scannerStart: "Scan starten",
    scannerStop: "Stopp",
    scannerScanning: "Wird gescannt... auf einen Code richten.",
    scannerScanningQrOnly: "Suche nach QR-Codes... (1D-Barcodes benoetigen einen Browser mit nativer Barcode-Erkennung).",
    scannerLoadingFallback: "QR-Fallback wird geladen...",
    scannerScanAgain: "Erneut scannen",
    scannerCopy: "Kopieren",
    scannerCopied: "Kopiert!",
    scannerOpenLink: "Link oeffnen",
    scannerStopped: "Scanner gestoppt.",
    scannerNotSupported:
      "Dein Browser unterstuetzt das Scannen von Barcodes nicht. Probiere Chrome, Edge oder Safari 17+.",
    scannerNeedsHttps:
      "Kamerazugriff erfordert eine https://-Seite oder localhost. Oeffne diese App ueber einen Webserver, nicht via file://.",
    scannerPermissionDenied:
      "Kamerazugriff verweigert. Erlaube den Kamerazugriff in den Browsereinstellungen und versuche es erneut.",
    scannerNoCamera: "Auf diesem Geraet wurde keine Kamera gefunden.",
    scannerCameraError: "Die Kamera konnte nicht gestartet werden.",
  },
};

function t(key) {
  return I18N[currentLanguage][key] || I18N.en[key] || key;
}

function detectInitialLanguage() {
  const saved = (() => {
    try {
      return localStorage.getItem(LANG_KEY);
    } catch {
      return null;
    }
  })();
  if (saved && I18N[saved]) return saved;

  const langs =
    navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language || "en"];
  for (const raw of langs) {
    const code = String(raw).slice(0, 2).toLowerCase();
    if (I18N[code]) return code;
  }
  return "en";
}

function setError(msg) {
  errEl.textContent = msg || "";
}

function setBusy(busy) {
  btnGen.disabled = busy;
  if (busy) {
    btnDl.disabled = true;
  } else {
    btnDl.disabled = !lastEncodedPayload;
    btnPdf.disabled = !lastEncodedPayload;
  }
  input.disabled = busy;
  sizeInput.disabled = busy;
  sizeSlider.disabled = busy;
  chkLogo.disabled = busy;
  barcodeTypeSelect.disabled = busy;
  modeSelect.disabled = busy;
  shapeSelect.disabled = busy;
  for (const btn of langButtons) btn.disabled = busy;
  for (const btn of themeButtons) btn.disabled = busy;
  syncBarcodeTypeUi();
  syncLogoInputs(busy);
  btnGen.textContent = busy ? t("working") : t("generate");
}

function parseQrSizeCm() {
  const raw = String(sizeInput.value || "").replace(",", ".").trim();
  const num = Number.parseFloat(raw);
  if (!Number.isFinite(num) || num < MIN_QR_CM || num > MAX_QR_CM) {
    return { ok: false, message: t("errInvalidSize") };
  }
  return { ok: true, cm: Math.round(num * 10) / 10 };
}

function formatCm(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Sizes the visible canvas so the bitmap displays at exactly `lastQrSizeCm`
 * (and `lastQrSizeCm * lastCanvasAspect` tall) at 100% browser zoom — i.e.
 * the on-screen preview matches the physical size the user picked. If the
 * preview container is too small, the canvas is uniformly scaled down so it
 * still fits, preserving aspect ratio. The underlying bitmap (used for
 * PNG/PDF export) is untouched.
 *
 * Per CSS spec, 1in = 96 CSS px, so 1cm = 96/2.54 CSS px ≈ 37.795 px. On
 * standard monitors at 100% zoom this maps closely to one physical
 * centimetre; on hi-DPI screens the OS keeps that mapping stable.
 */
function applyPreviewDisplaySize() {
  if (preview.classList.contains("hidden")) return;
  if (!canvas.width || !canvas.height) return;

  const previewBox = preview.getBoundingClientRect();
  if (previewBox.width === 0 || previewBox.height === 0) return;

  const previewStyle = window.getComputedStyle(preview);
  const padPreviewX =
    parseFloat(previewStyle.paddingLeft) + parseFloat(previewStyle.paddingRight);
  const padPreviewY =
    parseFloat(previewStyle.paddingTop) + parseFloat(previewStyle.paddingBottom);

  const availW = Math.max(0, previewBox.width - padPreviewX);
  const availH = Math.max(0, previewBox.height - padPreviewY);
  if (availW <= 0 || availH <= 0) return;

  // The canvas itself has no padding (see css/app.css), so its border-box
  // equals its content-box equals the bitmap display area. That means a
  // chosen cm maps directly to `cm * cmPxFactor` CSS px — exactly the same
  // mapping used by the calibration bar above the preview.
  const aspect = canvas.height / canvas.width;
  const cm = Math.max(0.1, lastQrSizeCm);
  const desiredW = cm * cmPxFactor;
  const desiredH = desiredW * aspect;
  if (desiredW <= 0 || desiredH <= 0) return;

  const scale = Math.min(1, availW / desiredW, availH / desiredH);
  canvas.style.width = `${desiredW * scale}px`;
  canvas.style.height = `${desiredH * scale}px`;
}

function calibrationBounds() {
  if (!calTrack) return { min: 80, max: 900 };
  return {
    min: parseInt(calTrack.getAttribute("aria-valuemin") || "80", 10),
    max: parseInt(calTrack.getAttribute("aria-valuemax") || "900", 10),
  };
}

function currentCalibrationPx() {
  return Math.max(1, Math.round(cmPxFactor * CAL_BAR_TARGET_CM));
}

/** Reflects `cmPxFactor` into the calibration bar. */
function syncCalibrationUi(explicitPx) {
  if (!calBar || !calTrack) return;
  const { min, max } = calibrationBounds();
  const px = Math.max(min, Math.min(max, explicitPx ?? currentCalibrationPx()));
  calBar.style.width = `${px}px`;
  calTrack.setAttribute("aria-valuenow", String(px));
}

function applyCalibrationPx(px) {
  const { min, max } = calibrationBounds();
  const clamped = Math.max(min, Math.min(max, Math.round(px)));
  cmPxFactor = clamped / CAL_BAR_TARGET_CM;
  syncCalibrationUi(clamped);
  persistCalibration(cmPxFactor);
  applyPreviewDisplaySize();
}

/** Converts a pointer's client X into a desired bar width (px from the
 *  track's left edge), so dragging the bar's right edge follows the mouse
 *  one CSS pixel at a time. */
function pointerToCalibrationPx(clientX) {
  if (!calTrack) return currentCalibrationPx();
  const rect = calTrack.getBoundingClientRect();
  return clientX - rect.left;
}

let calibratingPointerId = null;

function onCalibrateTrackPointerDown(e) {
  if (!calTrack) return;
  if (e.button !== undefined && e.button !== 0) return;
  calibratingPointerId = e.pointerId;
  if (typeof calTrack.setPointerCapture === "function") {
    try {
      calTrack.setPointerCapture(e.pointerId);
    } catch {
      /* some browsers reject capture on touch */
    }
  }
  e.preventDefault();
  applyCalibrationPx(pointerToCalibrationPx(e.clientX));
  calTrack.focus({ preventScroll: true });
}

function onCalibrateTrackPointerMove(e) {
  if (calibratingPointerId !== e.pointerId) return;
  applyCalibrationPx(pointerToCalibrationPx(e.clientX));
}

function onCalibrateTrackPointerUp(e) {
  if (calibratingPointerId !== e.pointerId) return;
  calibratingPointerId = null;
  if (calTrack && typeof calTrack.releasePointerCapture === "function") {
    try {
      calTrack.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }
}

function onCalibrateTrackKeydown(e) {
  if (!calTrack) return;
  const step = e.shiftKey ? 10 : 1;
  let px = currentCalibrationPx();
  const { min, max } = calibrationBounds();
  switch (e.key) {
    case "ArrowLeft":
    case "ArrowDown":
      px -= step;
      break;
    case "ArrowRight":
    case "ArrowUp":
      px += step;
      break;
    case "Home":
      px = min;
      break;
    case "End":
      px = max;
      break;
    default:
      return;
  }
  e.preventDefault();
  applyCalibrationPx(px);
}

function syncQrSizeUi(source) {
  const parsed = parseQrSizeCm();
  const cm = parsed.ok ? parsed.cm : Math.max(MIN_QR_CM, Math.min(MAX_QR_CM, lastQrSizeCm || 4));
  if (sizeValue) sizeValue.textContent = `${formatCm(cm)} CM`;
  if (source !== "number" && sizeInput) sizeInput.value = String(cm);
  if (sizeSlider) {
    const sliderValue = Math.max(QR_SLIDER_MIN_CM, Math.min(QR_SLIDER_MAX_CM, cm));
    if (source !== "slider") sizeSlider.value = String(Math.round(sliderValue * 2) / 2);
  }
  syncLogoSizeLimits();
}

function normalizeHttpUrl(raw) {
  const s = (raw || "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
  } catch {
    /* continue */
  }
  try {
    const u2 = new URL("https://" + s.replace(/^\/+/, ""));
    if (u2.hostname) return u2.href;
  } catch {
    /* ignore */
  }
  return null;
}

function validateAndNormalize(raw, mode) {
  const s = (raw || "").trim();
  if (mode === "barcode") {
    if (!s) return { ok: false, message: t("errEnterBarcodeValue") };
    return { ok: true, payload: s };
  }
  if (!s) {
    return { ok: false, message: mode === "url" ? t("errEnterAddress") : t("errEnterText") };
  }
  if (mode === "text") return { ok: true, payload: s };
  const href = normalizeHttpUrl(s);
  if (!href) return { ok: false, message: t("errInvalidAddress") };
  return { ok: true, payload: href };
}

function syncLogoInputs(busy) {
  const on = chkLogo.checked;
  logoFile.disabled = busy || !on;
  logoUrlInput.disabled = busy || !on;
  logoSizeInput.disabled = busy || !on;
  if (!on) {
    logoImageFromFile = null;
    logoFile.value = "";
  }
  syncLogoSizeLimits();
}

function getCurrentQrSizeCm() {
  const parsed = parseQrSizeCm();
  if (parsed.ok) return parsed.cm;
  return Math.max(MIN_QR_CM, Math.min(MAX_QR_CM, lastQrSizeCm || 4));
}

function getMaxLogoSizeCm(qrSizeCm = getCurrentQrSizeCm()) {
  return Math.max(MIN_LOGO_CM, Math.round(qrSizeCm * MAX_LOGO_SIDE_FRACTION * 10) / 10);
}

function getLogoSizeCm() {
  const max = getMaxLogoSizeCm();
  const raw = Number.parseFloat(String(logoSizeInput.value || ""));
  const fallback = Math.min(0.9, max);
  const safe = Number.isFinite(raw) ? Math.max(MIN_LOGO_CM, Math.min(max, raw)) : fallback;
  return Math.round(safe * 10) / 10;
}

function syncLogoSizeLimits() {
  const max = getMaxLogoSizeCm();
  logoSizeInput.min = String(MIN_LOGO_CM);
  logoSizeInput.max = String(max);
  logoSizeInput.step = "0.1";
  const size = getLogoSizeCm();
  if (String(logoSizeInput.value) !== String(size)) {
    logoSizeInput.value = String(size);
  }
  syncLogoSizeLabel();
}

function syncLogoSizeLabel() {
  logoSizeValue.textContent = `${getLogoSizeCm().toFixed(1)} cm`;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function syncBarcodeTypeUi() {
  const selected = barcodeTypeSelect.value;
  const isScanner = selected === "scanner";
  currentBarcodeType = isScanner
    ? "scanner"
    : BARCODE_TYPES[selected]
    ? selected
    : "qr";
  const def = isScanner ? null : BARCODE_TYPES[currentBarcodeType];
  const isQr = !isScanner && def.kind === "qr";

  for (const el of qrOnlyElements) {
    el.classList.toggle("is-hidden", !isQr);
  }
  for (const el of generatorOnlyElements) {
    el.classList.toggle("is-hidden", isScanner);
  }
  for (const el of scannerOnlyElements) {
    el.classList.toggle("is-hidden", !isScanner);
  }

  // Always stop the camera before switching to a new mode. If we are
  // entering scanner mode, that is a clean no-op; if we are leaving it,
  // it ensures the LED turns off and the stream is released.
  stopScanner({ keepResult: isScanner });

  setText("lead-copy", isScanner ? t("leadScanner") : t("lead"));

  if (isScanner) {
    setText("scanner-status", t("scannerStartHelp"));
    if (scannerStatus) scannerStatus.removeAttribute("data-tone");
    if (scannerStartBtn) scannerStartBtn.disabled = false;
    if (scannerStopBtn) scannerStopBtn.disabled = true;
    return;
  }

  const payloadLabel = document.getElementById("payload-label");

  if (isQr) {
    const isUrlMode = modeSelect.value === "url";
    if (payloadLabel) {
      payloadLabel.textContent = isUrlMode ? t("payloadLabelUrl") : t("payloadLabelText");
    }
    input.type = isUrlMode ? "url" : "text";
    input.placeholder = isUrlMode ? t("payloadPlaceholderUrl") : t("payloadPlaceholderText");
    chkShorten.disabled = btnGen.disabled || !isUrlMode;
    if (!isUrlMode) chkShorten.checked = false;
  } else {
    if (payloadLabel) payloadLabel.textContent = t("payloadLabelBarcode");
    input.type = "text";
    input.placeholder = def.placeholder || "";
    chkShorten.disabled = true;
    chkShorten.checked = false;
  }
}

function applyTranslations() {
  document.documentElement.lang = currentLanguage;
  document.title = t("pageTitle");
  setText("lead-copy", t("lead"));
  setText("language-label", t("languageLabel"));
  setText("theme-label", t("themeLabel"));
  const autoBtn = document.getElementById("theme-opt-auto");
  const lightBtn = document.getElementById("theme-opt-light");
  const darkBtn = document.getElementById("theme-opt-dark");
  if (autoBtn) autoBtn.setAttribute("aria-label", t("themeAutoAria"));
  if (lightBtn) lightBtn.setAttribute("aria-label", t("themeLightAria"));
  if (darkBtn) darkBtn.setAttribute("aria-label", t("themeDarkAria"));
  setText("barcode-type-label", t("barcodeTypeLabel"));
  setText("mode-label", t("modeLabel"));
  setText("mode-opt-url", t("modeUrl"));
  setText("mode-opt-text", t("modeText"));
  setText("shape-label", t("shapeLabel"));
  setText("shape-opt-square", t("shapeSquare"));
  setText("shape-opt-rounded", t("shapeRounded"));
  setText("shape-opt-dots", t("shapeDots"));
  setText("size-label", t("sizeLabel"));
  setText("calibrate-hint", t("calibrateHint"));
  setText("opt-shorten-label", t("shortenLabel"));
  setText("shorten-hint", t("shortenHint"));
  setText("opt-logo-label", t("logoLabel"));
  setText("logo-hint", t("logoHint"));
  setText("logo-url-label", t("logoUrlLabel"));
  setText("logo-file-label", t("logoFileLabel"));
  setText("logo-size-label", t("logoSizeLabel"));
  setText("generate", t("generate"));
  setText("download", t("download"));
  setText("download-pdf", t("downloadPdf"));
  setText("bt-opt-scanner", t("scannerOption"));
  setText("open-scanner-label", t("scannerShortcut"));
  const openScannerBtn = document.getElementById("open-scanner");
  if (openScannerBtn) openScannerBtn.setAttribute("aria-label", t("scannerShortcutAria"));
  setText("scanner-title", t("scannerTitle"));
  setText("scanner-start", t("scannerStart"));
  setText("scanner-stop", t("scannerStop"));
  setText("scanner-copy", t("scannerCopy"));
  setText("scanner-again", t("scannerScanAgain"));
  if (scannerOpenLink) scannerOpenLink.textContent = t("scannerOpenLink");
  logoUrlInput.placeholder = t("logoUrlPlaceholder");
  paintLanguageButtons();
  paintThemeButtons();
  syncBarcodeTypeUi();
}

function paintLanguageButtons() {
  for (const btn of langButtons) {
    const lang = btn.getAttribute("data-lang");
    const selected = lang === currentLanguage;
    btn.classList.toggle("active", selected);
    btn.setAttribute("aria-pressed", selected ? "true" : "false");
  }
}

function paintThemeButtons() {
  const current = themePreference;
  for (const btn of themeButtons) {
    const theme = btn.getAttribute("data-theme-pref");
    const selected = theme === current;
    btn.classList.toggle("active", selected);
    btn.setAttribute("aria-pressed", selected ? "true" : "false");
  }
}

let themePreference = "auto";

function getSystemPrefersDark() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveEffectiveTheme() {
  if (themePreference === "light") return "light";
  if (themePreference === "dark") return "dark";
  return getSystemPrefersDark() ? "dark" : "light";
}

function applyEffectiveTheme() {
  const eff = resolveEffectiveTheme();
  document.documentElement.classList.remove("mc-theme-light", "mc-theme-dark");
  document.documentElement.classList.add(eff === "dark" ? "mc-theme-dark" : "mc-theme-light");
  document.documentElement.style.colorScheme = eff === "dark" ? "dark" : "light";
}

function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch {
    saved = null;
  }
  if (saved === "light" || saved === "dark" || saved === "auto") {
    themePreference = saved;
  } else {
    themePreference = "auto";
  }
  applyEffectiveTheme();
  paintThemeButtons();
  const mql = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  if (mql && typeof mql.addEventListener === "function") {
    mql.addEventListener("change", () => {
      if (themePreference === "auto") applyEffectiveTheme();
    });
  }
}

function initLanguage() {
  currentLanguage = detectInitialLanguage();
  applyTranslations();
}

chkLogo.addEventListener("change", () => {
  syncLogoInputs(btnGen.disabled);
});

modeSelect.addEventListener("change", syncBarcodeTypeUi);
sizeInput.addEventListener("input", () => syncQrSizeUi("number"));
sizeSlider.addEventListener("input", () => {
  sizeInput.value = sizeSlider.value;
  syncQrSizeUi("slider");
});

logoFile.addEventListener("change", () => {
  const f = logoFile.files && logoFile.files[0];
  logoImageFromFile = null;
  if (!f || !f.type.startsWith("image/")) return;

  const blobUrl = URL.createObjectURL(f);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(blobUrl);
    logoImageFromFile = img;
  };
  img.onerror = () => {
    URL.revokeObjectURL(blobUrl);
    setError(t("errLogoRead"));
  };
  img.src = blobUrl;
});

logoSizeInput.addEventListener("input", syncLogoSizeLabel);

for (const btn of themeButtons) {
  btn.addEventListener("click", () => {
    const candidate = btn.getAttribute("data-theme-pref");
    if (candidate !== "light" && candidate !== "dark" && candidate !== "auto") return;
    themePreference = candidate;
    applyEffectiveTheme();
    paintThemeButtons();
    try {
      localStorage.setItem(THEME_KEY, candidate);
    } catch {
      /* ignore */
    }
  });
}

for (const btn of langButtons) {
  btn.addEventListener("click", () => {
    const candidate = btn.getAttribute("data-lang");
    if (!candidate || !I18N[candidate]) return;
    currentLanguage = candidate;
    try {
      localStorage.setItem(LANG_KEY, candidate);
    } catch {
      /* ignore */
    }
    applyTranslations();
  });
}

/**
 * @param {string} href
 * @returns {Promise<HTMLImageElement>}
 */
function loadLogoImageFromUrl(href) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const tmr = window.setTimeout(() => {
      img.onload = null;
      img.onerror = null;
      reject(new Error("Logo image load timed out."));
    }, 25000);

    img.onload = () => {
      window.clearTimeout(tmr);
      if (!img.naturalWidth) {
        reject(new Error("Logo image has no dimensions."));
        return;
      }
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(tmr);
      reject(
        new Error(
          "Could not load logo from that URL. Prefer https; the image host must send CORS headers so PNG export is not blocked."
        )
      );
    };
    img.src = href;
  });
}

/**
 * @returns {Promise<HTMLImageElement | null>}
 */
async function resolveLogoForRender() {
  if (!chkLogo.checked) return null;

  const urlTrim = logoUrlInput.value.trim();
  if (urlTrim) {
    const href = normalizeHttpUrl(urlTrim);
    if (!href) {
      throw new Error(t("errLogoUrlInvalid"));
    }
    return loadLogoImageFromUrl(href);
  }

  if (logoImageFromFile && logoImageFromFile.complete && logoImageFromFile.naturalWidth) {
    return logoImageFromFile;
  }

  throw new Error(t("errLogoMissing"));
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

async function onGenerate() {
  setError("");
  lastEncodedPayload = null;
  if (encodedEl) encodedEl.textContent = "";
  preview.classList.add("hidden");
  btnDl.disabled = true;
  btnPdf.disabled = true;

  const def = BARCODE_TYPES[currentBarcodeType] || BARCODE_TYPES.qr;
  const isQr = def.kind === "qr";

  const mode = isQr ? (modeSelect.value === "text" ? "text" : "url") : "barcode";
  const v = validateAndNormalize(input.value, mode);
  if (!v.ok) {
    setError(v.message);
    return;
  }
  const qrSize = parseQrSizeCm();
  if (!qrSize.ok) {
    setError(qrSize.message);
    return;
  }

  setBusy(true);
  let payload = v.payload;

  try {
    const renderPx = Math.max(128, Math.min(4096, Math.round(qrSize.cm * PX_PER_CM)));

    if (isQr) {
      if (mode === "url" && chkShorten.checked) {
        payload = await shortenUrlAuto(v.payload);
      }
      const logoForQr = await resolveLogoForRender();
      const selectedShape = shapeSelect.value;
      const moduleShape =
        selectedShape === "rounded" || selectedShape === "dots" ? selectedShape : "square";
      const QRCode = await loadQrModule();

      await renderQrToCanvas(canvas, payload, QRCode, {
        // margin: 0 means the bitmap === the visible QR pattern. The chosen
        // "outer size" therefore equals what the user actually measures with
        // a ruler. The surrounding paper / screen background still provides
        // the scan-quiet-zone in practice.
        width: renderPx,
        margin: 0,
        logoImage: logoForQr,
        logoSizePx: logoForQr ? Math.round(getLogoSizeCm() * PX_PER_CM) : 0,
        moduleShape,
      });
      lastCanvasAspect = 1;
    } else {
      const JsBarcode = await loadJsBarcodeLib();
      try {
        await renderBarcodeToCanvas(canvas, payload, JsBarcode, {
          format: def.jsbFormat,
          widthPx: renderPx,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // JsBarcode throws messages like "..." for invalid values; surface a
        // translated, user-friendly error and keep the raw cause for context.
        throw new Error(`${t("errInvalidBarcodeValue")} (${msg})`);
      }
      lastCanvasAspect = canvas.width > 0 ? canvas.height / canvas.width : 1;
    }

    lastEncodedPayload = payload;
    lastQrSizeCm = qrSize.cm;
    if (encodedEl) {
      if (mode === "url") {
        encodedEl.innerHTML = `<strong>${escapeHtml(t("encodedPrefix"))}</strong> <a href="${escapeAttr(payload)}" rel="noopener noreferrer" target="_blank">${escapeHtml(payload)}</a>`;
      } else {
        encodedEl.innerHTML = `<strong>${escapeHtml(t("encodedPrefix"))}</strong> ${escapeHtml(payload)}`;
      }
    }
    preview.classList.remove("hidden");
    applyPreviewDisplaySize();
    btnDl.disabled = false;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setError(msg || "Something went wrong.");
  } finally {
    setBusy(false);
  }
}

function downloadBaseName() {
  return currentBarcodeType === "qr" ? "qrcode" : `barcode-${currentBarcodeType}`;
}

function onDownload() {
  if (!lastEncodedPayload) {
    setError(t("errGenerateFirst"));
    return;
  }
  try {
    // Derive the embedded DPI from the actual rendered pixel size so the
    // saved PNG truly represents `lastQrSizeCm` cm at whatever pixel count
    // we ended up with (the 128/4096 px clamps in onGenerate can otherwise
    // drift the effective DPI for very small or very large requests).
    const cm = Math.max(0.1, lastQrSizeCm || MIN_QR_CM);
    const dpi = (canvas.width / cm) * CM_PER_INCH;
    const dataUrl = injectPngDpi(canvas.toDataURL("image/png"), dpi);
    const a = document.createElement("a");
    a.download = `${downloadBaseName()}.png`;
    a.href = dataUrl;
    a.click();
  } catch {
    setError(t("errDownloadFailed"));
  }
}

async function onDownloadPdf() {
  if (!lastEncodedPayload) {
    setError(t("errGenerateFirst"));
    return;
  }
  const qrSize = parseQrSizeCm();
  if (!qrSize.ok) {
    setError(qrSize.message);
    return;
  }
  const widthMm = qrSize.cm * 10;
  if (widthMm > MAX_PDF_QR_MM) {
    setError(t("errPdfTooLarge"));
    return;
  }
  const heightMm = widthMm * (lastCanvasAspect > 0 ? lastCanvasAspect : 1);
  try {
    const jsPDF = await loadJsPdf();
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = 210;
    const pageH = 297;
    const x = (pageW - widthMm) / 2;
    const y = (pageH - heightMm) / 2;
    const img = canvas.toDataURL("image/png");
    pdf.addImage(img, "PNG", x, y, widthMm, heightMm, undefined, "FAST");
    pdf.save(`${downloadBaseName()}-a4.pdf`);
  } catch {
    setError(t("errDownloadFailed"));
  }
}

function setScannerStatus(message, tone) {
  if (!scannerStatus) return;
  scannerStatus.textContent = message;
  if (tone) scannerStatus.setAttribute("data-tone", tone);
  else scannerStatus.removeAttribute("data-tone");
}

function getScannerAudioContext() {
  const AudioCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (typeof AudioCtor !== "function") return null;
  if (!scannerAudioContext || scannerAudioContext.state === "closed") {
    try {
      scannerAudioContext = new AudioCtor();
    } catch {
      return null;
    }
  }
  return scannerAudioContext;
}

function primeScanSuccessBell() {
  const ctx = getScannerAudioContext();
  if (!ctx || ctx.state !== "suspended") return;
  void ctx.resume().catch(() => {
    /* Audio feedback is best-effort. */
  });
}

function playScanSuccessBell() {
  const ctx = getScannerAudioContext();
  if (!ctx) return;

  const scheduleBell = () => {
    try {
      const now = ctx.currentTime;
      const end = now + SCAN_BELL_DURATION_MS / 1000;
      const master = ctx.createGain();
      const compressor =
        typeof ctx.createDynamicsCompressor === "function"
          ? ctx.createDynamicsCompressor()
          : null;
      const activeNodes = [master];

      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(SCAN_BELL_VOLUME, now + 0.006);
      master.gain.setValueAtTime(SCAN_BELL_VOLUME, end - 0.05);
      master.gain.exponentialRampToValueAtTime(0.0001, end);

      if (compressor) {
        compressor.threshold.setValueAtTime(-12, now);
        compressor.knee.setValueAtTime(18, now);
        compressor.ratio.setValueAtTime(5, now);
        compressor.attack.setValueAtTime(0.002, now);
        compressor.release.setValueAtTime(0.14, now);
        activeNodes.push(compressor);
      }

      const scheduleStrike = (strikeAt, scale) => {
        for (const partial of SCAN_BELL_PARTIALS) {
          const osc = ctx.createOscillator();
          const partialGain = ctx.createGain();
          const partialEnd = strikeAt + partial.decay;
          osc.type = "sine";
          osc.frequency.setValueAtTime(partial.frequency, strikeAt);
          osc.frequency.exponentialRampToValueAtTime(partial.frequency * partial.drift, partialEnd);
          partialGain.gain.setValueAtTime(0.0001, strikeAt);
          partialGain.gain.exponentialRampToValueAtTime(partial.gain * scale, strikeAt + 0.005);
          partialGain.gain.exponentialRampToValueAtTime(0.0001, partialEnd);
          osc.connect(partialGain);
          partialGain.connect(master);
          activeNodes.push(osc, partialGain);
          osc.start(strikeAt);
          osc.stop(partialEnd + 0.04);
        }
      };

      scheduleStrike(now, 1);
      scheduleStrike(now + SCAN_BELL_STRIKE_GAP_MS / 1000, 0.96);

      if (compressor) {
        master.connect(compressor);
        compressor.connect(ctx.destination);
      } else {
        master.connect(ctx.destination);
      }
      const cleanup = () => {
        for (const node of activeNodes) {
          try { node.disconnect(); } catch { /* ignore */ }
        }
      };
      window.setTimeout(cleanup, SCAN_BELL_DURATION_MS + 80);
    } catch {
      /* ignore */
    }
  };

  if (ctx.state === "suspended") {
    void ctx.resume().then(scheduleBell).catch(() => {
      /* ignore */
    });
    return;
  }
  scheduleBell();
}

function getBarcodeDetectorClass() {
  return typeof globalThis.BarcodeDetector === "function"
    ? globalThis.BarcodeDetector
    : null;
}

async function getSupportedScanFormats(Detector) {
  try {
    if (Detector && typeof Detector.getSupportedFormats === "function") {
      const supported = await Detector.getSupportedFormats();
      const set = new Set(supported);
      const filtered = SCAN_FORMATS.filter((f) => set.has(f));
      if (filtered.length > 0) return filtered;
    }
  } catch {
    /* fall through */
  }
  return SCAN_FORMATS;
}

function isSecureCameraContext() {
  if (typeof window === "undefined") return false;
  if (window.isSecureContext) return true;
  // getUserMedia is also allowed on localhost.
  const host = window.location && window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

async function startScanner() {
  if (scannerRunning) return;
  if (!scannerVideo) return;

  if (!isSecureCameraContext()) {
    setScannerStatus(t("scannerNeedsHttps"), "error");
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    // eslint-disable-next-line no-console
    console.error(
      "[scanner] navigator.mediaDevices.getUserMedia is unavailable.",
      "isSecureContext=", window.isSecureContext,
      "location=", window.location && window.location.href,
    );
    setScannerStatus(t("scannerNotSupported"), "error");
    return;
  }
  primeScanSuccessBell();

  if (scannerStartBtn) scannerStartBtn.disabled = true;
  if (scannerStopBtn) scannerStopBtn.disabled = false;
  if (scannerResult) scannerResult.classList.add("is-hidden");

  // Decide on a backend before we even ask for the camera so we can show a
  // single sensible error message if neither is available.
  const Detector = getBarcodeDetectorClass();
  let usingFallback = false;
  try {
    if (Detector) {
      const formats = await getSupportedScanFormats(Detector);
      try {
        barcodeDetector = new Detector({ formats });
      } catch {
        // Some Chromium builds (e.g. Edge on Windows) expose BarcodeDetector
        // but reject the format list. Try without an explicit formats list,
        // and if that also fails fall back to jsQR.
        try { barcodeDetector = new Detector(); }
        catch { barcodeDetector = null; }
      }
    } else {
      barcodeDetector = null;
    }

    if (!barcodeDetector) {
      // eslint-disable-next-line no-console
      console.info(
        "[scanner] Native BarcodeDetector unavailable on this browser/OS — loading jsQR polyfill from ./vendor/jsqr.js",
      );
      setScannerStatus(t("scannerLoadingFallback"));
      await loadJsQrLib();
      usingFallback = true;
    }

    setScannerStatus(usingFallback ? t("scannerScanningQrOnly") : t("scannerScanning"));

    scannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    scannerVideo.srcObject = scannerStream;
    await scannerVideo.play().catch(() => {
      /* play() can reject on some autoplay policies; the stream still flows */
    });
    scannerRunning = true;
    scanFrameLoop();
  } catch (err) {
    scannerRunning = false;
    if (scannerStartBtn) scannerStartBtn.disabled = false;
    if (scannerStopBtn) scannerStopBtn.disabled = true;
    const name = err && err.name;
    if (name === "NotAllowedError" || name === "SecurityError") {
      setScannerStatus(t("scannerPermissionDenied"), "error");
    } else if (name === "NotFoundError" || name === "OverconstrainedError") {
      setScannerStatus(t("scannerNoCamera"), "error");
    } else if (err && err.message && err.message.indexOf("jsQR") !== -1) {
      // eslint-disable-next-line no-console
      console.error(
        "[scanner] jsQR polyfill failed to load. Make sure ./vendor/jsqr.js is reachable.",
        err,
      );
      setScannerStatus(t("scannerNotSupported"), "error");
    } else {
      const msg = err && err.message ? `${t("scannerCameraError")} (${err.message})` : t("scannerCameraError");
      setScannerStatus(msg, "error");
    }
  }
}

function stopScanner(opts = {}) {
  scannerRunning = false;
  if (scannerRafId) {
    cancelAnimationFrame(scannerRafId);
    scannerRafId = 0;
  }
  if (scannerStream) {
    for (const track of scannerStream.getTracks()) {
      try { track.stop(); } catch { /* ignore */ }
    }
    scannerStream = null;
  }
  if (scannerVideo) scannerVideo.srcObject = null;
  if (scannerStartBtn) scannerStartBtn.disabled = false;
  if (scannerStopBtn) scannerStopBtn.disabled = true;
  if (!opts.keepResult && scannerResult) scannerResult.classList.add("is-hidden");
}

function jsQrScanCurrentFrame() {
  if (!jsQrFn || !scannerVideo) return null;
  const w = scannerVideo.videoWidth;
  const h = scannerVideo.videoHeight;
  if (!w || !h) return null;
  if (!jsQrSampleCanvas) jsQrSampleCanvas = document.createElement("canvas");
  if (jsQrSampleCanvas.width !== w) jsQrSampleCanvas.width = w;
  if (jsQrSampleCanvas.height !== h) jsQrSampleCanvas.height = h;
  const ctx = jsQrSampleCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(scannerVideo, 0, 0, w, h);
  let imageData;
  try {
    imageData = ctx.getImageData(0, 0, w, h);
  } catch {
    return null;
  }
  const found = jsQrFn(imageData.data, w, h, { inversionAttempts: "dontInvert" });
  if (found && found.data) {
    return { rawValue: found.data, format: "qr_code" };
  }
  return null;
}

function scanFrameLoop() {
  if (!scannerRunning || !scannerVideo) return;
  if (!barcodeDetector && !jsQrFn) return;
  const tick = async () => {
    if (!scannerRunning) return;
    try {
      if (scannerVideo.readyState >= 2 && scannerVideo.videoWidth > 0) {
        if (barcodeDetector) {
          const results = await barcodeDetector.detect(scannerVideo);
          if (results && results.length > 0) {
            handleScanResult(results[0]);
            return;
          }
        } else {
          const found = jsQrScanCurrentFrame();
          if (found) {
            handleScanResult(found);
            return;
          }
        }
      }
    } catch {
      // Some browsers throw transient errors while the stream is settling.
      // Just retry on the next frame.
    }
    scannerRafId = requestAnimationFrame(tick);
  };
  scannerRafId = requestAnimationFrame(tick);
}

function formatLabelForScan(format) {
  if (!format) return "";
  return String(format).replace(/_/g, " ").toUpperCase();
}

function isHttpLink(text) {
  if (!text) return false;
  try {
    const u = new URL(text);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function handleScanResult(detected) {
  const value = (detected && detected.rawValue) || "";
  const format = (detected && detected.format) || "";

  // Stop the camera promptly; user can re-start with "Scan again".
  stopScanner({ keepResult: true });

  if (scannerResultText) scannerResultText.textContent = value;
  if (scannerResultFormat) scannerResultFormat.textContent = formatLabelForScan(format);
  if (scannerOpenLink) {
    if (isHttpLink(value)) {
      scannerOpenLink.href = value;
      scannerOpenLink.hidden = false;
    } else {
      scannerOpenLink.removeAttribute("href");
      scannerOpenLink.hidden = true;
    }
  }
  if (scannerResult) scannerResult.classList.remove("is-hidden");
  setScannerStatus(t("scannerStopped"));
  if (value) playScanSuccessBell();

  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try { navigator.vibrate(80); } catch { /* ignore */ }
  }
}

async function onScannerCopy() {
  if (!scannerResultText) return;
  const value = scannerResultText.textContent || "";
  if (!value) return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setScannerStatus(t("scannerCopied"));
  } catch {
    /* swallow — copy is best-effort */
  }
}

if (scannerStartBtn) scannerStartBtn.addEventListener("click", () => { void startScanner(); });
if (scannerStopBtn) scannerStopBtn.addEventListener("click", () => { stopScanner(); });
if (scannerAgainBtn) scannerAgainBtn.addEventListener("click", () => { void startScanner(); });
if (scannerCopyBtn) scannerCopyBtn.addEventListener("click", () => { void onScannerCopy(); });

// Topbar shortcut: jump straight to scanner mode. Dispatch a real
// "change" event so the existing barcodeTypeSelect handler runs (which
// also clears the preview/result state, just like manual selection).
const openScannerBtn = document.getElementById("open-scanner");
if (openScannerBtn) {
  openScannerBtn.addEventListener("click", () => {
    if (barcodeTypeSelect.value === "scanner") return;
    barcodeTypeSelect.value = "scanner";
    barcodeTypeSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

// Free the camera if the user closes / hides the tab while scanning.
window.addEventListener("pagehide", () => stopScanner());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") stopScanner();
});

barcodeTypeSelect.addEventListener("change", () => {
  syncBarcodeTypeUi();
  preview.classList.add("hidden");
  if (encodedEl) encodedEl.textContent = "";
  lastEncodedPayload = null;
  btnDl.disabled = true;
  btnPdf.disabled = true;
});

btnGen.addEventListener("click", () => {
  void onGenerate();
});
btnDl.addEventListener("click", onDownload);
btnPdf.addEventListener("click", () => {
  void onDownloadPdf();
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void onGenerate();
});

if (calTrack) {
  calTrack.addEventListener("pointerdown", onCalibrateTrackPointerDown);
  calTrack.addEventListener("pointermove", onCalibrateTrackPointerMove);
  calTrack.addEventListener("pointerup", onCalibrateTrackPointerUp);
  calTrack.addEventListener("pointercancel", onCalibrateTrackPointerUp);
  calTrack.addEventListener("keydown", onCalibrateTrackKeydown);
}

// Re-apply the cm-accurate preview size whenever the viewport (or the
// preview column inside it) changes its available space. rAF-debounced so
// drag-resizing the window stays smooth.
let resizeRaf = 0;
function schedulePreviewResize() {
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0;
    applyPreviewDisplaySize();
  });
}
window.addEventListener("resize", schedulePreviewResize);
if (typeof ResizeObserver === "function") {
  new ResizeObserver(schedulePreviewResize).observe(preview);
}

initTheme();
initLanguage();
syncCalibrationUi();
syncQrSizeUi();
syncLogoInputs(false);
syncLogoSizeLabel();
syncBarcodeTypeUi();
