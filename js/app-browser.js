const FETCH_TIMEOUT_MS = 18000;
const JSONP_TIMEOUT_MS = 18000;

function readableProviderName(provider) {
  if (provider === "cleanuri") return "CleanURI";
  if (provider === "vgd") return "v.gd";
  return "is.gd";
}

async function shortenWithCleanUri(longUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const body = new URLSearchParams({ url: longUrl });
    const response = await fetch("https://cleanuri.com/api/v1/shorten", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: controller.signal,
    });

    let data = null;
    try {
      data = await response.json();
    } catch (_) {
      // The status text below is more useful than a JSON parse error.
    }

    if (!response.ok) {
      const msg = data && data.error ? data.error : response.statusText;
      throw new Error(msg || "Shortening failed.");
    }
    if (data && data.result_url) {
      return String(data.result_url).trim();
    }
    if (data && data.error) {
      throw new Error(String(data.error));
    }
    throw new Error("Unexpected response from shortening service.");
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Shortening request timed out.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

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
  if (provider === "cleanuri") {
    return shortenWithCleanUri(longUrl);
  }

  const base = provider === "vgd" ? "https://v.gd" : "https://is.gd";
  const cb = `qrLinkShort_cb_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  const url = `${base}/create.php?format=json&url=${encodeURIComponent(longUrl)}&callback=${encodeURIComponent(cb)}`;
  return loadJsonp(url, cb);
}

async function shortenUrlAuto(longUrl) {
  const errors = [];
  for (const provider of ["cleanuri", "isgd", "vgd"]) {
    try {
      return await shortenWithProvider(longUrl, provider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${readableProviderName(provider)}: ${msg}`);
    }
  }
  throw new Error(errors.join(" | "));
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

// One set of vector paths is used by both canvas and SVG exports.
function qrShapePath(shape, x, y, size) {
  const right = x + size, bottom = y + size, midX = x + size / 2, midY = y + size / 2;
  if (shape === "circle" || shape === "dots") {
    const r = size * (shape === "dots" ? .38 : .5);
    return `M${midX - r} ${midY}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;
  }
  if (shape === "diamond") return `M${midX} ${y}L${right} ${midY}L${midX} ${bottom}L${x} ${midY}Z`;
  if (shape === "beveled") {
    const c = size * .22;
    return `M${x + c} ${y}H${right - c}L${right} ${y + c}V${bottom - c}L${right - c} ${bottom}H${x + c}L${x} ${bottom - c}V${y + c}Z`;
  }
  if (shape === "leaf" || shape === "leaf-reverse") {
    return shape === "leaf"
      ? `M${x} ${y}H${midX}Q${right} ${y} ${right} ${midY}V${bottom}H${midX}Q${x} ${bottom} ${x} ${midY}Z`
      : `M${midX} ${y}H${right}V${midY}Q${right} ${bottom} ${midX} ${bottom}H${x}V${midY}Q${x} ${y} ${midX} ${y}Z`;
  }
  if (shape === "dot-grid") {
    let path = "";
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) path += qrShapePath("circle", x + col * size / 3, y + row * size / 3, size * .29);
    return path;
  }
  if (shape === "horizontal" || shape === "vertical") {
    // Body bars fill the long axis and leave a small gap across the short axis.
    const horizontal = shape === "horizontal", gap = size * .14;
    const l = x + (horizontal ? 0 : gap), t = y + (horizontal ? gap : 0);
    const w = size - (horizontal ? 0 : gap * 2), h = size - (horizontal ? gap * 2 : 0), r = Math.min(w, h) / 2;
    return `M${l + r} ${t}H${l + w - r}Q${l + w} ${t} ${l + w} ${t + r}V${t + h - r}Q${l + w} ${t + h} ${l + w - r} ${t + h}H${l + r}Q${l} ${t + h} ${l} ${t + h - r}V${t + r}Q${l} ${t} ${l + r} ${t}Z`;
  }
  if (shape === "horizontal-bars" || shape === "vertical-bars") {
    let path = "";
    for (let i = 0; i < 3; i++) {
      const horizontal = shape === "horizontal-bars";
      const l = x + (horizontal ? 0 : i * size / 3), t = y + (horizontal ? i * size / 3 : 0);
      const w = horizontal ? size : size * .29, h = horizontal ? size * .29 : size;
      path += `M${l} ${t}h${w}v${h}h${-w}Z`;
    }
    return path;
  }
  const r = size * (shape === "extra-rounded" ? .42 : shape === "rounded" ? .24 : 0);
  return `M${x + r} ${y}H${right - r}Q${right} ${y} ${right} ${y + r}V${bottom - r}Q${right} ${bottom} ${right - r} ${bottom}H${x + r}Q${x} ${bottom} ${x} ${bottom - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;
}

function drawModule(ctx, px, py, unit, shape) {
  ctx.fill(new Path2D(qrShapePath(shape, px, py, unit)));
}

function drawFinder(ctx, left, top, unit, finderShape, background, centreShape = "square") {
  ctx.fill(new Path2D(qrShapePath(finderShape, left, top, unit * 7)));
  ctx.save(); ctx.fillStyle = background;
  ctx.fill(new Path2D(qrShapePath(finderShape, left + unit, top + unit, unit * 5)));
  ctx.restore();
  ctx.fill(new Path2D(qrShapePath(centreShape, left + unit * 2, top + unit * 2, unit * 3)));
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

function paintStyledQr(canvasEl, qrData, width, margin, shape, logoImage, logoSidePx, foreground, background, cornerShape = "square", centreShape = "square") {
  const modules = qrData.modules;
  const size = modules.size;
  const fullCount = size + margin * 2;
  const unit = width / fullCount;
  const ctx = canvasEl.getContext("2d");
  if (!ctx) throw new Error("Unable to get 2D canvas context.");

  canvasEl.width = width;
  canvasEl.height = width;
  ctx.clearRect(0, 0, width, width);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, width);
  ctx.fillStyle = foreground;
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

  const finderShape = cornerShape;
  drawFinder(ctx, margin * unit, margin * unit, unit, finderShape, background, centreShape);
  drawFinder(ctx, (margin + size - 7) * unit, margin * unit, unit, finderShape, background, centreShape);
  drawFinder(ctx, margin * unit, (margin + size - 7) * unit, unit, finderShape, background, centreShape);
}

function renderQrToCanvas(canvasEl, text, QRCode, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const logo = options.logoImage && options.logoImage.complete ? options.logoImage : null;
      const qrData = QRCode.create(text, { errorCorrectionLevel: logo ? "H" : (options.errorCorrectionLevel || "M") });
      const logoSidePx = logo ? options.logoSizePx || Math.round((options.width || 256) * 0.22) : 0;
      paintStyledQr(canvasEl, qrData, options.width || 256, Number.isFinite(options.margin) ? options.margin : 4, options.moduleShape || "square", logo, logoSidePx, options.foreground || "#000000", options.background || "#ffffff", options.cornerShape || "square", options.centreShape || "square");
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
const SETTINGS_KEY = "barcode-creator-settings-v2";
const HISTORY_KEY = "barcode-creator-history-v2";
const SCAN_HISTORY_KEY = "barcode-creator-scan-history-v2";
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
const cornerShapeSelect = document.getElementById("corner-shape");
const centreShapeSelect = document.getElementById("centre-shape");
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
const btnSvg = document.getElementById("download-svg");
const btnCopyImage = document.getElementById("copy-image");
const btnShare = document.getElementById("share-code");
const btnSaveRecent = document.getElementById("save-recent");
const btnReset = document.getElementById("reset-app");
const structuredFields = document.getElementById("structured-fields");
const errorCorrectionSelect = document.getElementById("error-correction");
const foregroundInput = document.getElementById("foreground-color");
const backgroundInput = document.getElementById("background-color");
const qualityInfo = document.getElementById("quality-info");
const appStatus = document.getElementById("app-status");
const generationHistoryEl = document.getElementById("generation-history");
const errEl = document.getElementById("error");
const offlineBanner = document.getElementById("offline-banner");
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
const scannerImageBtn = document.getElementById("scanner-image");
const scannerImageFile = document.getElementById("scanner-image-file");
const scannerCopyBtn = document.getElementById("scanner-copy");
const scannerAgainBtn = document.getElementById("scanner-again");
const scannerOpenLink = /** @type {HTMLAnchorElement|null} */ (document.getElementById("scanner-open"));
const scannerResult = document.getElementById("scanner-result");
const scannerResultText = document.getElementById("scanner-result-text");
const scannerResultFormat = document.getElementById("scanner-result-format");
const scannerTorchBtn = document.getElementById("scanner-torch");
const scannerSound = document.getElementById("scanner-sound");
const scannerVibrate = document.getElementById("scanner-vibrate");
const scannerContinuous = document.getElementById("scanner-continuous");
const scanHistoryEl = document.getElementById("scan-history");

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
let scannerMode = false;
const scannerCameraSelect = document.getElementById("scanner-camera");
/** @type {MediaStream|null} */ let scannerStream = null;
/** @type {any} */ let barcodeDetector = null;
let scannerRafId = 0;
let lastScanSignature = "";
let lastScanAt = 0;
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
let lastSvgText = "";
let lastQrMeta = null;
let lastQrSizeCm = 4;
/** Aspect ratio (height / width) of the last successful render. QR = 1.0,
 *  1D barcodes are wider than they are tall. Used for PDF placement. */
let lastCanvasAspect = 1;
let currentBarcodeType = "qr";
let isOffline = typeof navigator !== "undefined" && navigator.onLine === false;

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
    shortenLabel: "Shorten link first (CleanURI, then is.gd/v.gd)",
    shortenHint: "Shorten your link so a smaller QR code works better.",
    shortenHintOffline: "URL shortening is unavailable while offline.",
    offlineNotice:
      "You are working offline. QR and barcode generation still works; URL shortening is unavailable.",
    logoLabel: "Center logo on the QR",
    logoHint:
      "Uses high error correction. QR dots under visible logo pixels are removed. Remote logos require CORS headers for PNG export.",
    logoUrlLabel: "Logo image URL (https, optional)",
    logoUrlPlaceholder: "https://example.com/logo.png",
    logoFileLabel: "Logo from file",
    logoSizeLabel: "Center logo max side (cm)",
    generate: "Generate",
    working: "Working...",
    download: "Download PNG",
    downloadPdf: "Download A4 PDF",
    hint:
      "If a web address has no scheme, https:// is assumed. QR / barcode / PDF libraries are bundled locally; link shortening uses CleanURI first, then is.gd/v.gd.",
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
    scannerImage: "Choose image",
    scannerImageLoading: "Reading image...",
    scannerImageMissing: "No code found. Try a clearer image. This browser may only support QR codes.",
    scannerImageError: "Could not read this image.",
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
    shortenLabel: "Link eerst inkorten (CleanURI, daarna is.gd/v.gd)",
    shortenHint: "Laat je Link inkorten zodat een kleinere QR code beter werkt.",
    shortenHintOffline: "Links inkorten is niet beschikbaar terwijl je offline werkt.",
    offlineNotice:
      "Je werkt offline. QR- en barcodegeneratie blijft werken; links inkorten is niet beschikbaar.",
    logoLabel: "Centraal logo op de QR",
    logoHint:
      "Gebruikt hoge foutcorrectie. QR-punten onder zichtbare logopixels worden verwijderd. Externe logo's vereisen CORS-headers voor PNG-export.",
    logoUrlLabel: "URL van logo-afbeelding (https, optioneel)",
    logoUrlPlaceholder: "https://voorbeeld.nl/logo.png",
    logoFileLabel: "Logo uit bestand",
    logoSizeLabel: "Maximale logozijde (cm)",
    generate: "Genereer",
    working: "Bezig...",
    download: "Download PNG",
    downloadPdf: "Download A4-PDF",
    hint:
      "Als een webadres geen schema heeft, wordt https:// toegevoegd. QR-/barcode-/PDF-bibliotheken zijn lokaal gebundeld; inkorten gebruikt eerst CleanURI, daarna is.gd/v.gd.",
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
    scannerImage: "Afbeelding kiezen",
    scannerImageLoading: "Afbeelding lezen...",
    scannerImageMissing: "Geen code gevonden. Probeer een scherpere afbeelding. Deze browser ondersteunt mogelijk alleen QR-codes.",
    scannerImageError: "Kon deze afbeelding niet lezen.",
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
    shortenLabel: "Link zuerst kuerzen (CleanURI, dann is.gd/v.gd)",
    shortenHint: "Kuerze deinen Link, damit ein kleinerer QR-Code besser funktioniert.",
    shortenHintOffline: "URL-Kuerzung ist offline nicht verfuegbar.",
    offlineNotice:
      "Du arbeitest offline. QR- und Barcode-Erstellung funktioniert weiter; URL-Kuerzung ist nicht verfuegbar.",
    logoLabel: "Zentrales Logo auf dem QR",
    logoHint:
      "Verwendet eine hohe Fehlerkorrektur. QR-Punkte unter sichtbaren Logo-Pixeln werden entfernt. Externe Logos benoetigen CORS-Header fuer den PNG-Export.",
    logoUrlLabel: "URL des Logo-Bildes (https, optional)",
    logoUrlPlaceholder: "https://beispiel.de/logo.png",
    logoFileLabel: "Logo aus Datei",
    logoSizeLabel: "Maximale Logo-Seite (cm)",
    generate: "Erstellen",
    working: "Wird erstellt...",
    download: "PNG herunterladen",
    downloadPdf: "A4-PDF herunterladen",
    hint:
      "Wenn eine Webadresse kein Schema hat, wird https:// angenommen. QR-, Barcode- und PDF-Bibliotheken sind lokal gebuendelt; Kuerzen nutzt zuerst CleanURI, dann is.gd/v.gd.",
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
    scannerImage: "Bild auswaehlen",
    scannerImageLoading: "Bild wird gelesen...",
    scannerImageMissing: "Kein Code gefunden. Dieser Browser unterstuetzt moeglicherweise nur QR-Codes.",
    scannerImageError: "Dieses Bild konnte nicht gelesen werden.",
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

Object.assign(I18N.en, {
  shapeLabel: "Dot shape",
  lead: "Create a QR code or barcode. Add a logo, choose a style, and download your code for print or digital use.",
  logoHint: "Uses high error correction to keep the code readable. Upload a logo file for the most reliable export.",
  errDownloadFailed: "Download failed. If you used an online logo, try uploading the image as a file instead.",
});
Object.assign(I18N.nl, {
  shapeLabel: "Vorm van de blokjes",
  pageTitle: "Barcodegenerator", headerTitle: "Barcodegenerator",
  lead: "Maak een QR-code of barcode. Voeg een logo toe, kies een stijl en download je code voor drukwerk of digitaal gebruik.",
  shortenHint: "Een kortere link levert een eenvoudigere QR-code op die vaak makkelijker te scannen is.",
  logoLabel: "Logo in het midden van de QR-code",
  logoHint: "Gebruikt hoge foutcorrectie om de code leesbaar te houden. Upload een logobestand voor de betrouwbaarste export.",
  logoSizeLabel: "Maximale breedte of hoogte van het logo (cm)",
  generate: "Maken", download: "PNG downloaden", downloadPdf: "A4-PDF downloaden",
  scannerCopy: "Kopiëren", scannerOpenLink: "Link openen", scannerStart: "Scannen starten", scannerStop: "Stoppen",
  scannerLoadingFallback: "QR-scanner laden…",
  scannerScanningQrOnly: "Zoeken naar QR-codes… Voor andere barcodes heb je een browser met ingebouwde barcodeherkenning nodig.",
  scannerPermissionDenied: "Geen toegang tot de camera. Geef toestemming in de browserinstellingen en probeer het opnieuw.",
  errDownloadFailed: "Downloaden is mislukt. Heb je een online logo gebruikt? Upload de afbeelding dan als bestand en probeer het opnieuw.",
});
Object.assign(I18N.de, {
  shapeLabel: "Form der Module",
  lead: "Erstelle einen QR-Code oder Barcode. Füge ein Logo hinzu, wähle einen Stil und lade deinen Code für den Druck oder die digitale Nutzung herunter.",
  sizeLabel: "Außenmaß (cm)",
  calibrateHint: "Lege den linken Rand des Balkens bei 0 auf einem Lineal an und ziehe den rechten Rand genau auf 5 cm. Die Einstellung wird für deinen nächsten Besuch gespeichert.",
  shortenLabel: "Link zuerst kürzen (CleanURI, dann is.gd/v.gd)",
  shortenHint: "Ein kürzerer Link ergibt einen einfacheren QR-Code, der sich oft leichter scannen lässt.",
  shortenHintOffline: "Links können offline nicht gekürzt werden.",
  offlineNotice: "Du bist offline. QR-Codes und Barcodes lassen sich weiterhin erstellen; das Kürzen von Links ist nicht verfügbar.",
  logoLabel: "Logo in der Mitte des QR-Codes",
  logoHint: "Verwendet eine hohe Fehlerkorrektur, damit der Code lesbar bleibt. Lade für einen zuverlässigen Export eine Logodatei hoch.",
  logoSizeLabel: "Maximale Breite oder Höhe des Logos (cm)",
  hint: "Fehlt bei einer Webadresse das Protokoll, wird https:// ergänzt. Codes und PDF-Dateien werden lokal erstellt. Beim Kürzen wird der Link an CleanURI und gegebenenfalls an is.gd oder v.gd gesendet.",
  errInvalidAddress: "Bitte gib einen gültigen Link mit http:// oder https:// ein.",
  errEnterBarcodeValue: "Bitte gib einen Wert für den Barcode ein.",
  errInvalidBarcodeValue: "Dieser Wert ist für den gewählten Barcode-Typ ungültig.",
  errLogoUrlInvalid: "Bitte gib eine gültige Logo-Adresse mit http:// oder https:// ein.",
  errLogoMissing: "Bitte lade eine Logodatei hoch, gib eine Bildadresse ein oder deaktiviere die Logo-Option.",
  errDownloadFailed: "Der Download ist fehlgeschlagen. Falls du ein Online-Logo verwendet hast, lade das Bild stattdessen als Datei hoch.",
  errInvalidSize: "Bitte gib eine gültige Größe zwischen 1 und 1000 cm ein.",
  errPdfTooLarge: "Wähle für den A4-Export eine Größe von höchstens 20 cm.",
  scannerImage: "Bild auswählen", scannerOpenLink: "Link öffnen",
  scannerImageMissing: "Kein Code gefunden. Versuche es mit einem schärferen Bild. Dieser Browser unterstützt möglicherweise nur QR-Codes.",
  scannerLoadingFallback: "QR-Scanner wird geladen…",
  scannerScanningQrOnly: "Suche nach QR-Codes… Für andere Barcodes ist ein Browser mit integrierter Barcode-Erkennung erforderlich.",
  scannerNotSupported: "Dein Browser unterstützt das Scannen von Barcodes nicht. Versuche es mit einem anderen Browser.",
  scannerNeedsHttps: "Der Kamerazugriff erfordert eine HTTPS-Seite oder localhost. Öffne diese App über einen Webserver statt als lokale Datei.",
  scannerNoCamera: "Auf diesem Gerät wurde keine Kamera gefunden.",
});

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
    if (btnSvg) btnSvg.disabled = !lastEncodedPayload;
  }
  input.disabled = busy;
  sizeInput.disabled = busy;
  sizeSlider.disabled = busy;
  chkLogo.disabled = busy;
  barcodeTypeSelect.disabled = busy;
  modeSelect.disabled = busy;
  shapeSelect.disabled = busy;
  cornerShapeSelect.disabled = busy;
  centreShapeSelect.disabled = busy;
  document.querySelectorAll(".shape-picker-toggle").forEach((button) => { button.disabled = busy; });
  for (const btn of langButtons) btn.disabled = busy;
  for (const btn of themeButtons) btn.disabled = busy;
  syncBarcodeTypeUi();
  syncLogoInputs(busy);
  btnGen.textContent = busy ? t("working") : t("generate");
}

function syncOfflineUi() {
  if (offlineBanner) {
    offlineBanner.textContent = t("offlineNotice");
    offlineBanner.classList.toggle("is-hidden", !isOffline);
  }
  setText("shorten-hint", isOffline ? t("shortenHintOffline") : t("shortenHint"));
  const shortenRow = chkShorten ? chkShorten.closest(".option-row") : null;
  if (shortenRow) {
    shortenRow.classList.toggle("is-unavailable", isOffline);
  }
}

function syncShortenAvailability() {
  const selected = barcodeTypeSelect.value;
  const def = BARCODE_TYPES[selected] || BARCODE_TYPES.qr;
  const isQr = selected !== "scanner" && def.kind === "qr";
  const isUrlMode = modeSelect.value === "url";
  const showShortening = !scannerMode && isQr && isUrlMode;
  chkShorten.closest(".option-row").classList.toggle("is-hidden", !showShortening);
  document.getElementById("shorten-hint").classList.toggle("is-hidden", !showShortening);
  chkShorten.disabled = btnGen.disabled || !isQr || !isUrlMode || isOffline;
  if (!isQr || !isUrlMode || isOffline) chkShorten.checked = false;
  syncOfflineUi();
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
  const isScanner = scannerMode;
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
    el.classList.toggle("is-hidden", isScanner || (el.classList.contains("qr-only") && !isQr));
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
    const isStructured = Boolean(STRUCTURED_SCHEMAS[modeSelect.value]);
    const payloadField = input.closest(".field");
    if (payloadField) payloadField.classList.toggle("is-hidden", isStructured);
    if (payloadLabel) {
      payloadLabel.textContent = isUrlMode ? t("payloadLabelUrl") : t("payloadLabelText");
    }
    input.type = isUrlMode ? "url" : "text";
    input.placeholder = isUrlMode ? t("payloadPlaceholderUrl") : t("payloadPlaceholderText");
    renderStructuredFields();
  } else {
    const payloadField = input.closest(".field");
    if (payloadField) payloadField.classList.remove("is-hidden");
    if (payloadLabel) payloadLabel.textContent = t("payloadLabelBarcode");
    input.type = "text";
    input.placeholder = def.placeholder || "";
  }
  syncShortenAvailability();
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
  setText("shorten-hint", isOffline ? t("shortenHintOffline") : t("shortenHint"));
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
  setText("scanner-image", t("scannerImage"));
  setText("scanner-copy", t("scannerCopy"));
  setText("scanner-again", t("scannerScanAgain"));
  if (scannerOpenLink) scannerOpenLink.textContent = t("scannerOpenLink");
  logoUrlInput.placeholder = t("logoUrlPlaceholder");
  paintLanguageButtons();
  paintThemeButtons();
  syncBarcodeTypeUi();
  if (window.refreshUiTranslations) window.refreshUiTranslations();
}

function updateOnlineState() {
  isOffline = typeof navigator !== "undefined" && navigator.onLine === false;
  syncShortenAvailability();
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

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // Installability is a progressive enhancement; the app still runs.
    });
  });
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

const STRUCTURED_SCHEMAS = {
  wifi: [["ssid", "Network name", "text"], ["password", "Wi-Fi password", "text"], ["security", "Network security", "select"], ["hidden", "My network is hidden", "checkbox"]],
  vcard: [["name", "Full name", "text"], ["organisation", "Organisation", "text"], ["phone", "Phone", "tel"], ["email", "Email", "email"], ["website", "Website", "url"]],
  email: [["to", "Recipient", "email"], ["subject", "Subject", "text"], ["body", "Message", "text"]],
  phone: [["phone", "Phone number", "tel"]],
  sms: [["phone", "Phone number", "tel"], ["message", "Message", "text"]],
  event: [["title", "Event title", "text"], ["start", "Start", "datetime-local"], ["end", "End", "datetime-local"], ["location", "Location", "text"]],
  location: [["latitude", "Latitude", "number"], ["longitude", "Longitude", "number"]],
};

function structuredValue(name) {
  const el = structuredFields && structuredFields.querySelector(`[data-structured="${name}"]`);
  if (el && el.type === "checkbox") return String(el.checked);
  return el ? String(el.value || "").trim() : "";
}

function escapeWifi(value) { return String(value).replace(/([\\;,:"])/g, "\\$1"); }
function escapeVcard(value) { return String(value).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1"); }
function compactDate(value) { return value ? value.replace(/[-:]/g, "").replace("T", "T") + "00" : ""; }

function buildStructuredPayload(mode) {
  if (mode === "wifi") {
    const security = structuredValue("security") || "WPA";
    const password = security === "nopass" ? "" : structuredValue("password");
    return `WIFI:T:${escapeWifi(security)};S:${escapeWifi(structuredValue("ssid"))};P:${escapeWifi(password)};H:${structuredValue("hidden") === "true" ? "true" : "false"};;`;
  }
  if (mode === "vcard") return ["BEGIN:VCARD", "VERSION:3.0", `FN:${escapeVcard(structuredValue("name"))}`, `ORG:${escapeVcard(structuredValue("organisation"))}`, `TEL:${escapeVcard(structuredValue("phone"))}`, `EMAIL:${escapeVcard(structuredValue("email"))}`, `URL:${escapeVcard(structuredValue("website"))}`, "END:VCARD"].filter((line) => !/:$/.test(line)).join("\n");
  if (mode === "email") return `mailto:${encodeURIComponent(structuredValue("to"))}?subject=${encodeURIComponent(structuredValue("subject"))}&body=${encodeURIComponent(structuredValue("body"))}`;
  if (mode === "phone") return `tel:${structuredValue("phone")}`;
  if (mode === "sms") return `sms:${structuredValue("phone")}?body=${encodeURIComponent(structuredValue("message"))}`;
  if (mode === "event") return ["BEGIN:VEVENT", `SUMMARY:${escapeVcard(structuredValue("title"))}`, `DTSTART:${compactDate(structuredValue("start"))}`, `DTEND:${compactDate(structuredValue("end"))}`, `LOCATION:${escapeVcard(structuredValue("location"))}`, "END:VEVENT"].filter((line) => !/:$/.test(line)).join("\n");
  if (mode === "location") return `geo:${structuredValue("latitude")},${structuredValue("longitude")}`;
  return "";
}

function renderStructuredFields() {
  if (!structuredFields) return;
  const schema = STRUCTURED_SCHEMAS[modeSelect.value];
  structuredFields.classList.toggle("is-hidden", !schema);
  // Busy-state and translation updates also sync the UI. Keep the existing
  // inputs (including their values and focus) unless the content type changes.
  if (structuredFields.dataset.mode === modeSelect.value) return;
  structuredFields.dataset.mode = modeSelect.value;
  structuredFields.innerHTML = schema ? schema.map(([name, label, type]) => {
    if (type === "select") return `<div class="field"><label for="structured-${name}">${escapeHtml(label)}</label><select id="structured-${name}" data-structured="${name}" aria-describedby="wifi-security-help"><option value="WPA">Password protected (WPA / WPA2)</option><option value="WEP">Older network (WEP)</option><option value="nopass">No password (open network)</option></select><small id="wifi-security-help">Most home and school networks use the first option. Check your router settings if unsure.</small></div>`;
    if (type === "checkbox") return `<div class="field"><label class="wifi-hidden-label" for="structured-${name}"><input id="structured-${name}" data-structured="${name}" type="checkbox" aria-describedby="wifi-hidden-help"> ${escapeHtml(label)}</label><small id="wifi-hidden-help">Leave unchecked unless your network is deliberately hidden from the Wi-Fi list.</small></div>`;
    return `<div class="field"><label for="structured-${name}">${escapeHtml(label)}</label><input id="structured-${name}" data-structured="${name}" type="${type}" ${type === "number" ? 'step="any"' : ""}></div>`;
  }).join("") : "";
  structuredFields.querySelectorAll("input, select").forEach((el) => el.addEventListener("input", () => { syncWifiPassword(); scheduleLivePreview(); }));
  syncWifiPassword();
  if (modeSelect.value === "location") initLocationMap();
}

// Web Mercator coordinates match OpenStreetMap's standard 256px tiles.
function mapProject(latitude, longitude, zoom) {
  const scale = 256 * Math.pow(2, zoom);
  const lat = Math.max(-85.05112878, Math.min(85.05112878, latitude)) * Math.PI / 180;
  return { x: (longitude + 180) / 360 * scale, y: (1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 * scale };
}
function mapUnproject(x, y, zoom) {
  const scale = 256 * Math.pow(2, zoom);
  return { latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / scale))) * 180 / Math.PI, longitude: ((x / scale * 360) % 360 + 360) % 360 - 180 };
}

function initLocationMap() {
  const wrapper = document.createElement("div");
  wrapper.className = "location-map-picker";
  wrapper.innerHTML = '<p>Click or tap to place a pin. Drag to move the map.</p><div class="location-map" tabindex="0" role="application" aria-label="Location picker. Arrow keys move the map, Enter places a pin at the centre."><div class="map-tiles"></div><span class="map-pin" hidden aria-label="Selected location">📍</span><div class="map-buttons"><button type="button" data-map-zoom="1" aria-label="Zoom in">+</button><button type="button" data-map-zoom="-1" aria-label="Zoom out">−</button></div><a class="map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></div><div class="actions"><button type="button" class="btn-secondary map-locate">Use my location</button></div><small class="map-message" role="status">Map needs an internet connection. You can also enter coordinates above.</small>';
  structuredFields.appendChild(wrapper);
  const map = wrapper.querySelector(".location-map");
  const tiles = wrapper.querySelector(".map-tiles");
  const pin = wrapper.querySelector(".map-pin");
  const message = wrapper.querySelector(".map-message");
  const latInput = structuredFields.querySelector('[data-structured="latitude"]');
  const lngInput = structuredFields.querySelector('[data-structured="longitude"]');
  latInput.min = "-90"; latInput.max = "90"; lngInput.min = "-180"; lngInput.max = "180";
  let zoom = 2;
  let centre = { latitude: 20, longitude: 0 };
  let selected = null;
  let dragging = null;
  function draw() {
    const width = map.clientWidth, height = map.clientHeight;
    if (!width || !height) return;
    const p = mapProject(centre.latitude, centre.longitude, zoom);
    const left = p.x - width / 2, top = p.y - height / 2;
    const count = Math.pow(2, zoom);
    tiles.replaceChildren();
    for (let y = Math.floor(top / 256); y <= Math.floor((top + height) / 256); y++) {
      if (y < 0 || y >= count) continue;
      for (let x = Math.floor(left / 256); x <= Math.floor((left + width) / 256); x++) {
        const img = document.createElement("img");
        img.alt = ""; img.draggable = false; img.referrerPolicy = "strict-origin-when-cross-origin";
        img.src = `https://tile.openstreetmap.org/${zoom}/${((x % count) + count) % count}/${y}.png`;
        img.style.left = `${x * 256 - left}px`; img.style.top = `${y * 256 - top}px`;
        img.onerror = () => { message.textContent = "Map unavailable. Enter coordinates above or try again when online."; };
        tiles.appendChild(img);
      }
    }
    pin.hidden = !selected;
    if (selected) {
      const point = mapProject(selected.latitude, selected.longitude, zoom);
      let dx = point.x - p.x; const world = 256 * count;
      if (dx > world / 2) dx -= world; if (dx < -world / 2) dx += world;
      pin.style.left = `${width / 2 + dx}px`; pin.style.top = `${point.y - top}px`;
    }
  }
  function choose(point) {
    selected = point; latInput.value = point.latitude.toFixed(6); lngInput.value = point.longitude.toFixed(6);
    message.textContent = `Pin placed at ${latInput.value}, ${lngInput.value}.`; draw(); scheduleLivePreview();
  }
  map.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || dragging || e.target.closest("button, a")) return;
    dragging = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, centre: mapProject(centre.latitude, centre.longitude, zoom) };
    map.setPointerCapture(e.pointerId);
  });
  map.addEventListener("pointermove", (e) => {
    if (!dragging || dragging.id !== e.pointerId) return;
    const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
    if (Math.hypot(dx, dy) > 5) dragging.moved = true;
    if (!dragging.moved) return;
    map.classList.add("is-dragging");
    tiles.style.transform = `translate(${dx}px, ${dy}px)`;
    pin.style.marginLeft = `${dx}px`; pin.style.marginTop = `${dy}px`;
  });
  function finishDrag(e, cancelled = false) {
    if (!dragging || dragging.id !== e.pointerId) return;
    const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
    if (!cancelled && (dragging.moved || Math.hypot(dx, dy) > 5)) centre = mapUnproject(dragging.centre.x - dx, Math.max(0, Math.min(256 * Math.pow(2, zoom), dragging.centre.y - dy)), zoom);
    else if (!cancelled) { const rect = map.getBoundingClientRect(); choose(mapUnproject(dragging.centre.x + e.clientX - rect.left - rect.width / 2, dragging.centre.y + e.clientY - rect.top - rect.height / 2, zoom)); }
    dragging = null;
    tiles.style.transform = ""; pin.style.marginLeft = ""; pin.style.marginTop = "";
    map.classList.remove("is-dragging");
    if (map.hasPointerCapture(e.pointerId)) map.releasePointerCapture(e.pointerId);
    draw();
  }
  map.addEventListener("pointerup", (e) => {
    finishDrag(e);
  });
  map.addEventListener("pointercancel", (e) => finishDrag(e, true));
  map.addEventListener("lostpointercapture", (e) => finishDrag(e, true));
  wrapper.querySelectorAll("[data-map-zoom]").forEach((button) => button.addEventListener("click", () => {
    if (selected) centre = { ...selected };
    zoom = Math.max(1, Math.min(19, zoom + Number(button.dataset.mapZoom)));
    draw();
  }));
  map.addEventListener("keydown", (e) => {
    if (e.target !== map) return;
    const moves = { ArrowLeft: [-100, 0], ArrowRight: [100, 0], ArrowUp: [0, -100], ArrowDown: [0, 100] };
    if (e.key === "Enter") { e.preventDefault(); choose(centre); }
    if (moves[e.key]) { e.preventDefault(); const p = mapProject(centre.latitude, centre.longitude, zoom); centre = mapUnproject(p.x + moves[e.key][0], Math.max(0, Math.min(256 * Math.pow(2, zoom), p.y + moves[e.key][1])), zoom); draw(); }
  });
  function fromInputs() {
    const latitude = Number(latInput.value), longitude = Number(lngInput.value);
    if (!latInput.value || !lngInput.value || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return;
    selected = { latitude, longitude }; centre = selected; draw();
  }
  latInput.addEventListener("input", fromInputs); lngInput.addEventListener("input", fromInputs);
  const locate = wrapper.querySelector(".map-locate");
  locate.disabled = !navigator.geolocation;
  locate.addEventListener("click", () => {
    message.textContent = "Finding your location…";
    navigator.geolocation.getCurrentPosition((position) => { centre = { latitude: position.coords.latitude, longitude: position.coords.longitude }; zoom = 16; choose(centre); }, () => { message.textContent = "Could not get your location. Place a pin or enter coordinates instead."; }, { timeout: 15000 });
  });
  const observer = new ResizeObserver(() => { if (!map.isConnected) observer.disconnect(); else draw(); });
  observer.observe(map); requestAnimationFrame(draw);
}

function syncWifiPassword() {
  if (modeSelect.value !== "wifi") return;
  const password = structuredFields.querySelector('[data-structured="password"]');
  if (!password) return;
  const open = structuredValue("security") === "nopass";
  password.disabled = open;
  password.closest(".field").classList.toggle("is-hidden", open);
}

function shapeThumbnail(shape, kind) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 9 9"); svg.setAttribute("aria-hidden", "true");
  let path = "";
  if (kind === "frame") {
    path = qrShapePath(shape, 1, 1, 7) + qrShapePath(shape, 2, 2, 5);
  } else if (kind === "centre") path = qrShapePath(shape, 1.5, 1.5, 6);
  else {
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) path += qrShapePath(shape, 1 + x * 2.4, 1 + y * 2.4, 2);
  }
  const element = document.createElementNS("http://www.w3.org/2000/svg", "path");
  element.setAttribute("d", path); element.setAttribute("fill", "currentColor");
  if (kind === "frame") element.setAttribute("fill-rule", "evenodd");
  svg.appendChild(element); return svg;
}

function initShapePickers() {
  const names = { square: "Square", rounded: "Rounded", dots: "Dots", circle: "Circular", "extra-rounded": "Extra rounded", diamond: "Diamond", beveled: "Cut corners", leaf: "Leaf", "leaf-reverse": "Reverse leaf", horizontal: "Horizontal bars", vertical: "Vertical bars", "dot-grid": "Nine dots", "horizontal-bars": "Three horizontal bars", "vertical-bars": "Three vertical bars" };
  for (const [select, kind] of [[shapeSelect, "body"], [cornerShapeSelect, "frame"], [centreShapeSelect, "centre"]]) {
    const picker = document.createElement("div"); picker.className = "shape-picker";
    const button = document.createElement("button"); button.type = "button"; button.className = "shape-picker-toggle";
    button.id = `${select.id}-picker`; button.setAttribute("aria-haspopup", "listbox"); button.setAttribute("aria-expanded", "false");
    const label = document.querySelector(`label[for="${select.id}"]`);
    label.htmlFor = button.id; label.id ||= `${select.id}-label`;
    const menu = document.createElement("div"); menu.className = "shape-menu"; menu.id = `${select.id}-choices`;
    menu.setAttribute("role", "listbox"); menu.setAttribute("aria-labelledby", label.id); menu.setAttribute("popover", "auto");
    button.setAttribute("aria-controls", menu.id);
    const nativePopover = typeof menu.showPopover === "function";
    if (!nativePopover) menu.hidden = true;
    let open = false;
    const choices = [];
    function close(focus = false) {
      if (nativePopover && menu.matches(":popover-open")) menu.hidePopover();
      else if (!nativePopover) menu.hidden = true;
      open = false; button.setAttribute("aria-expanded", "false"); if (focus) button.focus();
    }
    function refresh() {
      const name = document.createElement("span"); name.textContent = names[select.value] || "Square";
      button.replaceChildren(name, shapeThumbnail(select.value, kind));
      choices.forEach((choice) => choice.setAttribute("aria-selected", String(choice.dataset.value === select.value)));
      if (window.refreshUiTranslations) window.refreshUiTranslations();
    }
    for (const option of select.options) {
      const choice = document.createElement("button"); choice.type = "button"; choice.className = "shape-option";
      choice.setAttribute("role", "option"); choice.tabIndex = -1; choice.dataset.value = option.value;
      const text = document.createElement("span"); text.textContent = names[option.value];
      choice.append(text, shapeThumbnail(option.value, kind));
      choice.addEventListener("click", () => {
        if (select.disabled) return;
        select.value = option.value; refresh(); close(true); select.dispatchEvent(new Event("input", { bubbles: true }));
      });
      menu.appendChild(choice); choices.push(choice);
    }
    function show() {
      if (select.disabled) return;
      const rect = button.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 268))}px`;
      menu.style.width = `${Math.max(250, Math.min(rect.width, window.innerWidth - 16))}px`;
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const height = Math.min(360, Math.max(below, above));
      menu.style.maxHeight = `${height}px`;
      menu.style.top = below >= Math.min(260, above) ? `${rect.bottom + 4}px` : `${Math.max(8, rect.top - height - 4)}px`;
      if (nativePopover) menu.showPopover(); else menu.hidden = false;
      open = true; button.setAttribute("aria-expanded", "true");
      (choices.find((choice) => choice.dataset.value === select.value) || choices[0]).focus();
    }
    button.addEventListener("click", () => { if (open) close(); else show(); });
    button.addEventListener("keydown", (e) => { if (["ArrowDown", "ArrowUp"].includes(e.key)) { e.preventDefault(); show(); } });
    menu.addEventListener("keydown", (e) => {
      let index = choices.indexOf(document.activeElement);
      if (e.key === "Escape") { e.preventDefault(); close(true); }
      else if (e.key === "Tab") close();
      else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
        e.preventDefault(); index = e.key === "Home" ? 0 : e.key === "End" ? choices.length - 1 : (index + (e.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length;
        choices[index].focus();
      }
    });
    menu.addEventListener("toggle", (event) => { open = event.newState === "open"; button.setAttribute("aria-expanded", String(open)); });
    document.addEventListener("pointerdown", (event) => { if (open && !menu.contains(event.target) && !button.contains(event.target)) close(); });
    window.addEventListener("resize", () => close());
    select.hidden = true; select.after(picker); picker.append(button); document.body.append(menu);
    select.addEventListener("change", refresh); picker.addEventListener("refresh-shape", refresh);
    refresh();
  }
}

function selectedEcc(hasLogo) {
  if (hasLogo) return "H";
  const value = errorCorrectionSelect ? errorCorrectionSelect.value : "auto";
  return /^(L|M|Q|H)$/.test(value) ? value : "M";
}

function colourContrast(a, b) {
  const lum = (hex) => { const parts = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4)); return .2126 * parts[0] + .7152 * parts[1] + .0722 * parts[2]; };
  const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

function makeQrSvg(qrData, margin, foreground, background, shape = "square", cornerShape = "square", centreShape = "square") {
  const size = qrData.modules.size;
  const total = size + margin * 2;
  let content = "";
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    if (!isDark(qrData.modules, x, y) || isInFinder(x, y, size)) continue;
    content += `<path d="${qrShapePath(shape, x + margin, y + margin, 1)}" fill="${foreground}"/>`;
  }
  for (const [x, y] of [[margin, margin], [margin + size - 7, margin], [margin, margin + size - 7]]) {
    for (const [offset, width, style, colour] of [[0, 7, cornerShape, foreground], [1, 5, cornerShape, background], [2, 3, centreShape, foreground]]) {
      content += `<path d="${qrShapePath(style, x + offset, y + offset, width)}" fill="${colour}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}"><rect width="100%" height="100%" fill="${background}"/>${content}</svg>`;
}

function announce(message) { if (appStatus) appStatus.textContent = message; }
function storageRead(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } }
function storageWrite(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } }

function renderHistory() {
  if (!generationHistoryEl) return;
  const items = storageRead(HISTORY_KEY, []);
  generationHistoryEl.innerHTML = items.length ? items.map((item, i) => `<div class="history-item"><button type="button" class="btn-secondary" data-history="${i}">${escapeHtml(item.type.toUpperCase())}: ${escapeHtml(item.payload)}</button><small>${new Date(item.time).toLocaleDateString()}</small></div>`).join("") : "<small>No recent codes yet.</small>";
  generationHistoryEl.querySelectorAll("[data-history]").forEach((btn) => btn.addEventListener("click", () => { const item = items[Number(btn.dataset.history)]; barcodeTypeSelect.value = item.type; syncBarcodeTypeUi(); input.value = item.payload; void onGenerate(); }));
}

function rememberGeneration(payload, type = currentBarcodeType) {
  const items = storageRead(HISTORY_KEY, []).filter((item) => item.payload !== payload);
  items.unshift({ payload, type, time: Date.now() });
  storageWrite(HISTORY_KEY, items.slice(0, 10)); renderHistory();
}

function persistSettings() {
  storageWrite(SETTINGS_KEY, { barcodeType: barcodeTypeSelect.value, mode: modeSelect.value, shape: shapeSelect.value, cornerShape: cornerShapeSelect.value, centreShape: centreShapeSelect.value, size: sizeInput.value, ecc: errorCorrectionSelect.value, foreground: foregroundInput.value, background: backgroundInput.value });
}

function restoreSettings() {
  const s = storageRead(SETTINGS_KEY, {});
  if (s.barcodeType && BARCODE_TYPES[s.barcodeType]) barcodeTypeSelect.value = s.barcodeType;
  if (s.mode) modeSelect.value = s.mode;
  if (s.shape) shapeSelect.value = s.shape;
  if (s.cornerShape) cornerShapeSelect.value = s.cornerShape;
  if (s.centreShape) centreShapeSelect.value = s.centreShape;
  if (s.size) sizeInput.value = s.size;
  if (s.ecc) errorCorrectionSelect.value = s.ecc;
  if (s.foreground) foregroundInput.value = s.foreground;
  if (s.background) backgroundInput.value = s.background;
}

let livePreviewTimer = 0;
function markPreviewStale() {
  btnSaveRecent.disabled = true;
  btnCopyImage.disabled = true;
  btnShare.disabled = true;
  if (!lastEncodedPayload) return;
  if (qualityInfo) { qualityInfo.textContent = "Settings changed — preview is updating…"; qualityInfo.dataset.tone = "warning"; }
  btnDl.disabled = true; btnPdf.disabled = true; if (btnSvg) btnSvg.disabled = true;
}
function scheduleLivePreview() {
  persistSettings(); markPreviewStale(); clearTimeout(livePreviewTimer);
  livePreviewTimer = setTimeout(() => { if ((input.value || "").trim() || STRUCTURED_SCHEMAS[modeSelect.value]) void onGenerate({ silentEmpty: true }); }, 450);
}

async function onGenerate(options = {}) {
  btnSaveRecent.disabled = true;
  setError("");
  lastEncodedPayload = null;
  if (encodedEl) encodedEl.textContent = "";
  preview.classList.add("hidden");
  btnDl.disabled = true;
  btnPdf.disabled = true;
  if (btnSvg) btnSvg.disabled = true;
  if (btnCopyImage) btnCopyImage.disabled = true;
  if (btnShare) btnShare.disabled = true;

  const def = BARCODE_TYPES[currentBarcodeType] || BARCODE_TYPES.qr;
  const isQr = def.kind === "qr";

  const selectedMode = modeSelect.value;
  const structuredPayload = isQr && STRUCTURED_SCHEMAS[selectedMode] ? buildStructuredPayload(selectedMode) : "";
  const mode = isQr ? (selectedMode === "text" || STRUCTURED_SCHEMAS[selectedMode] ? "text" : "url") : "barcode";
  const v = validateAndNormalize(structuredPayload || input.value, mode);
  if (!v.ok) {
    if (options.silentEmpty) return;
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
        let accepted = false;
        try { accepted = localStorage.getItem("barcode-creator-shortener-consent") === "yes"; } catch { /* ignore */ }
        if (!accepted) {
          accepted = confirm(window.localizeUi("Shortening sends this URL to CleanURI and may fall back to is.gd or v.gd. Do not shorten private or sensitive links. Continue?"));
          if (!accepted) throw new Error("URL shortening cancelled.");
          try { localStorage.setItem("barcode-creator-shortener-consent", "yes"); } catch { /* ignore */ }
        }
        payload = await shortenUrlAuto(v.payload);
      }
      const logoForQr = await resolveLogoForRender();
      const selectedShape = shapeSelect.value;
      const moduleShape = selectedShape || "square";
      const QRCode = await loadQrModule();
      const ecc = selectedEcc(Boolean(logoForQr));
      const margin = 4;
      const foreground = foregroundInput.value;
      const background = backgroundInput.value;
      const qrData = QRCode.create(payload, { errorCorrectionLevel: ecc });

      await renderQrToCanvas(canvas, payload, QRCode, {
        // margin: 0 means the bitmap === the visible QR pattern. The chosen
        // "outer size" therefore equals what the user actually measures with
        // a ruler. The surrounding paper / screen background still provides
        // the scan-quiet-zone in practice.
        width: renderPx,
        margin,
        logoImage: logoForQr,
        logoSizePx: logoForQr ? Math.round(getLogoSizeCm() * PX_PER_CM) : 0,
        moduleShape,
        cornerShape: cornerShapeSelect.value,
        centreShape: centreShapeSelect.value,
        errorCorrectionLevel: ecc,
        foreground,
        background,
      });
      lastSvgText = makeQrSvg(qrData, margin, foreground, background, moduleShape, cornerShapeSelect.value, centreShapeSelect.value);
      const moduleMm = (qrSize.cm * 10) / (qrData.modules.size + margin * 2);
      lastQrMeta = { modules: qrData.modules.size, margin, ecc, moduleMm, contrast: colourContrast(foreground, background) };
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
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      JsBarcode(svg, payload, { format: def.jsbFormat, displayValue: true, margin: 10, background: backgroundInput.value, lineColor: foregroundInput.value });
      lastSvgText = new XMLSerializer().serializeToString(svg);
      lastQrMeta = null;
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
    if (btnSvg) btnSvg.disabled = false;
    if (btnCopyImage) btnCopyImage.disabled = !(navigator.clipboard && globalThis.ClipboardItem);
    if (btnShare) btnShare.disabled = typeof navigator.share !== "function";
    if (qualityInfo) {
      if (lastQrMeta) {
        const warnings = [];
        if (lastQrMeta.moduleMm < .4) warnings.push("modules may be too small for reliable print scanning");
        if (lastQrMeta.margin < 4) warnings.push("use a 4-module quiet zone");
        if (lastQrMeta.contrast < 4.5) warnings.push("increase colour contrast");
        qualityInfo.textContent = `QR ${lastQrMeta.modules}×${lastQrMeta.modules} modules · ${lastQrMeta.moduleMm.toFixed(2)} mm/module · ECC ${lastQrMeta.ecc} · quiet zone ${lastQrMeta.margin}. ${warnings.length ? "Warning: " + warnings.join("; ") + "." : "Good scan profile."}`;
        qualityInfo.dataset.tone = warnings.length ? "warning" : "good";
      } else {
        qualityInfo.textContent = `Barcode rendered at ${qrSize.cm} cm. Validate the printed result with a representative scanner.`;
        qualityInfo.dataset.tone = "good";
      }
    }
    btnSaveRecent.disabled = false;
    persistSettings();
    announce("Code generated and ready to download.");
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
    rememberGeneration(lastEncodedPayload);
    announce("PNG downloaded.");
  } catch {
    setError(t("errDownloadFailed"));
  }
}

function downloadTextFile(text, type, filename) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function onDownloadSvg() {
  if (!lastEncodedPayload || !lastSvgText) return setError(t("errGenerateFirst"));
  downloadTextFile(lastSvgText, "image/svg+xml", `${downloadBaseName()}.svg`);
  rememberGeneration(lastEncodedPayload);
  announce("SVG downloaded.");
}

async function onCopyImage() {
  if (!lastEncodedPayload || !navigator.clipboard || !globalThis.ClipboardItem) return;
  const savedPayload = lastEncodedPayload, savedType = currentBarcodeType;
  try {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    rememberGeneration(savedPayload, savedType);
    announce("Image copied to clipboard.");
  } catch { setError("Could not copy the image in this browser."); }
}

async function onShareCode() {
  if (!lastEncodedPayload || typeof navigator.share !== "function") return;
  const savedPayload = lastEncodedPayload, savedType = currentBarcodeType;
  try {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const file = new File([blob], `${downloadBaseName()}.png`, { type: "image/png" });
    const data = { title: "Barcode Creator Tool", text: lastEncodedPayload, files: [file] };
    if (navigator.canShare && !navigator.canShare({ files: [file] })) delete data.files;
    await navigator.share(data);
    rememberGeneration(savedPayload, savedType);
  } catch (err) { if (!err || err.name !== "AbortError") setError("Sharing failed."); }
}

function resetApp() {
  if (!confirm(window.localizeUi("Reset all generator settings and local history?"))) return;
  btnSaveRecent.disabled = true;
  try { localStorage.removeItem(SETTINGS_KEY); localStorage.removeItem(HISTORY_KEY); localStorage.removeItem(SCAN_HISTORY_KEY); } catch { /* ignore */ }
  input.value = ""; shapeSelect.value = "square"; cornerShapeSelect.value = "square"; centreShapeSelect.value = "square";
  document.querySelectorAll(".shape-picker").forEach((picker) => picker.dispatchEvent(new Event("refresh-shape")));
  // Rebuild the current category to clear its fields and map pin without
  // changing the user's selected barcode type or content category.
  delete structuredFields.dataset.mode;
  sizeInput.value = "4"; sizeSlider.value = "4"; errorCorrectionSelect.value = "auto";
  foregroundInput.value = "#000000"; backgroundInput.value = "#ffffff"; chkLogo.checked = false; chkShorten.checked = false;
  lastEncodedPayload = null; lastSvgText = ""; preview.classList.add("hidden"); setError("");
  renderStructuredFields(); syncQrSizeUi(); syncLogoInputs(false); syncBarcodeTypeUi(); renderHistory(); renderScanHistory(); persistSettings(); announce("Settings reset.");
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
    rememberGeneration(lastEncodedPayload);
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
      video: scannerCameraSelect && scannerCameraSelect.value
        ? { deviceId: { exact: scannerCameraSelect.value } }
        : { facingMode: { ideal: "environment" } },
      audio: false,
    });
    await refreshCameraList();
    const videoTrack = scannerStream.getVideoTracks()[0];
    const capabilities = videoTrack && typeof videoTrack.getCapabilities === "function" ? videoTrack.getCapabilities() : {};
    if (scannerTorchBtn) scannerTorchBtn.hidden = !capabilities.torch;
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

  const signature = `${format}:${value}`;
  if (signature === lastScanSignature && Date.now() - lastScanAt < 1800) return;
  lastScanSignature = signature; lastScanAt = Date.now();
  if (!scannerContinuous || !scannerContinuous.checked) stopScanner({ keepResult: true });

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
  if (value && (!scannerSound || scannerSound.checked)) playScanSuccessBell();
  if (value) rememberScan(value, format);

  if ((!scannerVibrate || scannerVibrate.checked) && typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try { navigator.vibrate(80); } catch { /* ignore */ }
  }
}

function rememberScan(value, format) {
  const items = storageRead(SCAN_HISTORY_KEY, []).filter((item) => item.value !== value);
  items.unshift({ value, format, time: Date.now() }); storageWrite(SCAN_HISTORY_KEY, items.slice(0, 25)); renderScanHistory();
}

function renderScanHistory() {
  if (!scanHistoryEl) return;
  const items = storageRead(SCAN_HISTORY_KEY, []);
  scanHistoryEl.innerHTML = items.length ? items.map((item, i) => `<div class="history-item"><button type="button" class="btn-secondary" data-scan-history="${i}">${escapeHtml(item.value)}</button><small>${escapeHtml(formatLabelForScan(item.format))}</small></div>`).join("") : "<small>No scans yet.</small>";
  scanHistoryEl.querySelectorAll("[data-scan-history]").forEach((btn) => btn.addEventListener("click", () => { const item = items[Number(btn.dataset.scanHistory)]; barcodeTypeSelect.value = "qr"; modeSelect.value = isHttpLink(item.value) ? "url" : "text"; input.value = item.value; syncBarcodeTypeUi(); void onGenerate(); }));
}

async function toggleTorch() {
  const track = scannerStream && scannerStream.getVideoTracks()[0]; if (!track) return;
  const active = scannerTorchBtn.dataset.active === "true";
  try { await track.applyConstraints({ advanced: [{ torch: !active }] }); scannerTorchBtn.dataset.active = String(!active); scannerTorchBtn.textContent = !active ? "Torch off" : "Torch"; } catch { setScannerStatus("Torch is unavailable on this camera.", "error"); }
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

async function scanImageFile(file) {
  if (!file) return;
  stopScanner();
  primeScanSuccessBell();
  scannerImageBtn.disabled = true;
  if (scannerStartBtn) scannerStartBtn.disabled = true;
  setScannerStatus(t("scannerImageLoading"));
  const imageUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();
    let detected = null;
    const Detector = getBarcodeDetectorClass();
    if (Detector) {
      try {
        const detector = new Detector({ formats: await getSupportedScanFormats(Detector) });
        detected = (await detector.detect(image))[0] || null;
      } catch { /* Try the local QR decoder. */ }
    }
    if (!detected) {
      await loadJsQrLib();
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = jsQrFn(pixels.data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" });
      if (found && found.data) detected = { rawValue: found.data, format: "qr_code" };
    }
    if (detected) handleScanResult(detected);
    else setScannerStatus(t("scannerImageMissing"), "error");
  } catch {
    setScannerStatus(t("scannerImageError"), "error");
  } finally {
    URL.revokeObjectURL(imageUrl);
    scannerImageBtn.disabled = false;
    if (scannerStartBtn) scannerStartBtn.disabled = false;
    scannerImageFile.value = "";
  }
}

if (scannerImageBtn && scannerImageFile) {
  scannerImageBtn.addEventListener("click", () => scannerImageFile.click());
  scannerImageFile.addEventListener("change", () => { void scanImageFile(scannerImageFile.files[0]); });
}
if (scannerStartBtn) scannerStartBtn.addEventListener("click", () => { void startScanner(); });
if (scannerStopBtn) scannerStopBtn.addEventListener("click", () => { stopScanner(); });
if (scannerAgainBtn) scannerAgainBtn.addEventListener("click", () => { void startScanner(); });
if (scannerCopyBtn) scannerCopyBtn.addEventListener("click", () => { void onScannerCopy(); });
if (scannerTorchBtn) scannerTorchBtn.addEventListener("click", () => { void toggleTorch(); });
if (scannerOpenLink) scannerOpenLink.addEventListener("click", (event) => {
  const href = scannerOpenLink.href;
  if (!href) return;
  const host = new URL(href).hostname;
  if (!confirm(window.localizeUi(`Open ${host}?\n\n${href}`))) event.preventDefault();
});

// Topbar shortcut: jump straight to scanner mode. Dispatch a real
// "change" event so the existing barcodeTypeSelect handler runs (which
// also clears the preview/result state, just like manual selection).
const openScannerBtn = document.getElementById("open-scanner");
if (openScannerBtn) {
  openScannerBtn.addEventListener("click", () => {
    if (scannerMode) return;
    scannerMode = true;
    syncBarcodeTypeUi();
    void refreshCameraList();
  });
}

document.getElementById("open-generator").addEventListener("click", () => {
  scannerMode = false;
  syncBarcodeTypeUi();
  document.getElementById("open-scanner").focus();
});

async function refreshCameraList() {
  if (!scannerCameraSelect || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput");
    const selected = scannerCameraSelect.value;
    scannerCameraSelect.replaceChildren(new Option(window.localizeUi("Default camera"), ""));
    devices.forEach((device, index) => {
      if (device.deviceId) scannerCameraSelect.add(new Option(device.label || `${window.localizeUi("Camera")} ${index + 1}`, device.deviceId));
    });
    if ([...scannerCameraSelect.options].some((option) => option.value === selected)) scannerCameraSelect.value = selected;
  } catch { /* Camera permission is requested only when the user starts scanning. */ }
}

scannerCameraSelect.addEventListener("change", () => {
  const restart = scannerRunning;
  stopScanner({ keepResult: true });
  if (restart) void startScanner();
});
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", () => { if (scannerMode) void refreshCameraList(); });
}

// Free the camera if the user closes / hides the tab while scanning.
window.addEventListener("pagehide", () => stopScanner());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") stopScanner();
});

barcodeTypeSelect.addEventListener("change", () => {
  btnSaveRecent.disabled = true;
  btnSvg.disabled = true;
  btnCopyImage.disabled = true;
  btnShare.disabled = true;
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
if (btnSvg) btnSvg.addEventListener("click", onDownloadSvg);
if (btnCopyImage) btnCopyImage.addEventListener("click", () => { void onCopyImage(); });
if (btnShare) btnShare.addEventListener("click", () => { void onShareCode(); });
btnSaveRecent.addEventListener("click", () => {
  if (!lastEncodedPayload || btnSaveRecent.disabled) return;
  rememberGeneration(lastEncodedPayload);
  announce("Saved to Recents.");
});
if (btnReset) btnReset.addEventListener("click", resetApp);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void onGenerate();
});

[input, sizeInput, sizeSlider, shapeSelect, errorCorrectionSelect, foregroundInput, backgroundInput, logoSizeInput, logoUrlInput].filter(Boolean).forEach((el) => el.addEventListener("input", scheduleLivePreview));
cornerShapeSelect.addEventListener("input", scheduleLivePreview);
centreShapeSelect.addEventListener("input", scheduleLivePreview);
[chkLogo, chkShorten].filter(Boolean).forEach((el) => el.addEventListener("change", scheduleLivePreview));
modeSelect.addEventListener("change", () => { renderStructuredFields(); syncBarcodeTypeUi(); scheduleLivePreview(); });

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

window.addEventListener("online", updateOnlineState);
window.addEventListener("offline", updateOnlineState);
registerServiceWorker();
initTheme();
initLanguage();
restoreSettings();
initShapePickers();
syncCalibrationUi();
syncQrSizeUi();
syncLogoInputs(false);
syncLogoSizeLabel();
syncBarcodeTypeUi();
renderStructuredFields();
renderHistory();
renderScanHistory();
