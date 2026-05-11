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

  fillRoundRect(ctx, left, top, outer, outer, outerRadius);
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  fillRoundRect(ctx, left + unit, top + unit, innerCut, innerCut, Math.max(0, outerRadius - unit * 0.45));
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

const THEME_KEY = "mediacapture-theme";
const LANG_KEY = "mediacapture-lang";
const PRINT_DPI = 300;
const CM_PER_INCH = 2.54;
const PX_PER_CM = PRINT_DPI / CM_PER_INCH;
const MIN_QR_CM = 1;
const MAX_QR_CM = 1000;
const QR_SLIDER_MIN_CM = 2;
const QR_SLIDER_MAX_CM = 10;
const MAX_PDF_QR_MM = 200;
const MIN_LOGO_CM = 0.3;
const MAX_LOGO_SIDE_FRACTION = 0.28;
const LOGO_ALPHA_THRESHOLD = 8;

const input = document.getElementById("payload");
const sizeInput = document.getElementById("qr-size-cm");
const sizeSlider = document.getElementById("qr-size-slider");
const sizeValue = document.getElementById("qr-size-value");
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

/** @type {string | null} */
let lastEncodedPayload = null;
let lastQrSizeCm = 4;

/** @type {HTMLImageElement | null} */
let logoImageFromFile = null;

/** @type {"en" | "nl" | "de"} */
let currentLanguage = "en";

const I18N = {
  en: {
    pageTitle: "QR Creator Tool",
    headerTitle: "QR Creator Tool",
    lead:
      "Generate a QR code for a web link or plain text. You can shorten links, upload a center logo, and customize the QR style.",
    languageLabel: "Language",
    themeLabel: "Theme",
    themeAutoAria: "Auto theme",
    themeLightAria: "Light theme",
    themeDarkAria: "Dark theme",
    themeAuto: "Auto",
    themeLight: "Light",
    themeDark: "Dark",
    modeLabel: "Content type",
    modeUrl: "Web link",
    modeText: "Plain text",
    payloadLabelUrl: "Web address",
    payloadPlaceholderUrl: "https://example.com/page",
    payloadLabelText: "Text content",
    payloadPlaceholderText: "Type any text you want to encode",
    shapeLabel: "QR style",
    shapeSquare: "Square",
    shapeRounded: "Rounded",
    shapeDots: "Dots",
    sizeLabel: "QR outer size (cm)",
    shortenLabel: "Shorten link first (is.gd, then v.gd)",
    shortenHint: "Only applies to web links. The URL is sent to is.gd, then v.gd if the first service fails.",
    logoLabel: "Center logo on the QR",
    logoHint:
      "Uses high error correction. QR dots under visible logo pixels are removed. Remote logos require CORS headers for PNG export.",
    logoUrlLabel: "Logo image URL (https, optional)",
    logoUrlPlaceholder: "https://example.com/logo.png",
    logoFileLabel: "Or local file",
    logoSizeLabel: "Center logo max side (cm)",
    generate: "Generate QR",
    working: "Working...",
    download: "Download PNG",
    downloadPdf: "Download A4 PDF",
    hint:
      "If a web address has no scheme, https:// is assumed. QR/PDF libraries are bundled locally; link shortening uses is.gd/v.gd.",
    encodedPrefix: "QR encodes:",
    errEnterAddress: "Enter a web address.",
    errInvalidAddress: "That does not look like a valid http(s) link.",
    errEnterText: "Enter some text to encode.",
    errLogoRead: "Could not read that image file.",
    errLogoUrlInvalid: "Logo URL must be a valid http(s) address.",
    errLogoMissing: "Add a logo URL and/or local logo file, or turn off the logo option.",
    errGenerateFirst: "Generate a QR code first.",
    errDownloadFailed:
      "Download failed (canvas may be tainted). Try a logo file instead of URL, or a CORS-enabled logo URL.",
    errInvalidSize: "Enter a valid size between 1 and 1000 cm.",
    errPdfTooLarge: "For A4 export, choose a size up to 20 cm.",
  },
  nl: {
    pageTitle: "QR Maker Tool",
    headerTitle: "QR Maker Tool",
    lead:
      "Genereer een QR-code voor een weblink of vrije tekst. Je kunt links inkorten, een centraal logo uploaden en de QR-stijl aanpassen.",
    languageLabel: "Taal",
    themeLabel: "Thema",
    themeAutoAria: "Automatisch thema",
    themeLightAria: "Licht thema",
    themeDarkAria: "Donker thema",
    themeAuto: "Auto",
    themeLight: "Licht",
    themeDark: "Donker",
    modeLabel: "Inhoudstype",
    modeUrl: "Weblink",
    modeText: "Tekst",
    payloadLabelUrl: "Webadres",
    payloadPlaceholderUrl: "https://voorbeeld.nl/pagina",
    payloadLabelText: "Tekstinhoud",
    payloadPlaceholderText: "Typ tekst die je wilt coderen",
    shapeLabel: "QR-stijl",
    shapeSquare: "Vierkant",
    shapeRounded: "Afgerond",
    shapeDots: "Punten",
    sizeLabel: "Buitenmaat QR (cm)",
    shortenLabel: "Link eerst inkorten (is.gd, daarna v.gd)",
    shortenHint: "Geldt alleen voor weblinks. De URL wordt naar is.gd gestuurd, daarna naar v.gd als de eerste dienst faalt.",
    logoLabel: "Centraal logo op de QR",
    logoHint:
      "Gebruikt hoge foutcorrectie. QR-punten onder zichtbare logopixels worden verwijderd. Externe logo's vereisen CORS-headers voor PNG-export.",
    logoUrlLabel: "URL van logo-afbeelding (https, optioneel)",
    logoUrlPlaceholder: "https://voorbeeld.nl/logo.png",
    logoFileLabel: "Of lokaal bestand",
    logoSizeLabel: "Maximale logozijde (cm)",
    generate: "Genereer QR",
    working: "Bezig...",
    download: "Download PNG",
    downloadPdf: "Download A4-PDF",
    hint:
      "Als een webadres geen schema heeft, wordt https:// toegevoegd. QR/PDF-bibliotheken zijn lokaal gebundeld; inkorten gebruikt is.gd/v.gd.",
    encodedPrefix: "QR bevat:",
    errEnterAddress: "Vul een webadres in.",
    errInvalidAddress: "Dit lijkt geen geldige http(s)-url.",
    errEnterText: "Vul tekst in om te coderen.",
    errLogoRead: "Kon dit afbeeldingsbestand niet lezen.",
    errLogoUrlInvalid: "De logo-URL moet een geldige http(s)-url zijn.",
    errLogoMissing: "Voeg een logo-URL en/of lokaal logo toe, of zet logo uit.",
    errGenerateFirst: "Genereer eerst een QR-code.",
    errDownloadFailed:
      "Download mislukt (canvas is mogelijk vervuild). Gebruik een lokaal logo of een URL met CORS.",
    errInvalidSize: "Vul een geldige grootte in tussen 1 en 1000 cm.",
    errPdfTooLarge: "Kies voor A4-export een grootte van maximaal 20 cm.",
  },
  de: {
    pageTitle: "QR-Generator",
    headerTitle: "QR-Generator",
    lead:
      "Erstelle einen QR-Code fuer einen Weblink oder freien Text. Du kannst Links kuerzen, ein zentrales Logo hochladen und den QR-Stil anpassen.",
    languageLabel: "Sprache",
    themeLabel: "Design",
    themeAutoAria: "Automatisches Design",
    themeLightAria: "Helles Design",
    themeDarkAria: "Dunkles Design",
    themeAuto: "Auto",
    themeLight: "Hell",
    themeDark: "Dunkel",
    modeLabel: "Inhaltstyp",
    modeUrl: "Weblink",
    modeText: "Text",
    payloadLabelUrl: "Webadresse",
    payloadPlaceholderUrl: "https://beispiel.de/seite",
    payloadLabelText: "Textinhalt",
    payloadPlaceholderText: "Beliebigen Text eingeben",
    shapeLabel: "QR-Stil",
    shapeSquare: "Quadratisch",
    shapeRounded: "Abgerundet",
    shapeDots: "Punkte",
    sizeLabel: "QR-Aussenmass (cm)",
    shortenLabel: "Link zuerst kuerzen (is.gd, dann v.gd)",
    shortenHint: "Gilt nur fuer Weblinks. Die URL wird an is.gd gesendet, danach an v.gd, falls der erste Dienst fehlschlaegt.",
    logoLabel: "Zentrales Logo auf dem QR",
    logoHint:
      "Verwendet eine hohe Fehlerkorrektur. QR-Punkte unter sichtbaren Logo-Pixeln werden entfernt. Externe Logos benoetigen CORS-Header fuer den PNG-Export.",
    logoUrlLabel: "URL des Logo-Bildes (https, optional)",
    logoUrlPlaceholder: "https://beispiel.de/logo.png",
    logoFileLabel: "Oder lokale Datei",
    logoSizeLabel: "Maximale Logo-Seite (cm)",
    generate: "QR erstellen",
    working: "Wird erstellt...",
    download: "PNG herunterladen",
    downloadPdf: "A4-PDF herunterladen",
    hint:
      "Wenn eine Webadresse kein Schema hat, wird https:// angenommen. QR/PDF-Bibliotheken sind lokal gebuendelt; Kuerzen nutzt is.gd/v.gd.",
    encodedPrefix: "QR kodiert:",
    errEnterAddress: "Bitte eine Webadresse eingeben.",
    errInvalidAddress: "Das sieht nicht wie eine gueltige http(s)-URL aus.",
    errEnterText: "Bitte Text zum Kodieren eingeben.",
    errLogoRead: "Die Bilddatei konnte nicht gelesen werden.",
    errLogoUrlInvalid: "Die Logo-URL muss eine gueltige http(s)-Adresse sein.",
    errLogoMissing: "Bitte eine Logo-URL und/oder eine lokale Datei hinzufuegen oder die Logo-Option deaktivieren.",
    errGenerateFirst: "Zuerst einen QR-Code erzeugen.",
    errDownloadFailed:
      "Download fehlgeschlagen (Canvas moeglicherweise \"tainted\"). Verwende eine lokale Datei oder eine CORS-faehige URL.",
    errInvalidSize: "Bitte eine gueltige Groesse zwischen 1 und 1000 cm eingeben.",
    errPdfTooLarge: "Fuer den A4-Export bitte eine Groesse bis maximal 20 cm waehlen.",
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
  modeSelect.disabled = busy;
  shapeSelect.disabled = busy;
  for (const btn of langButtons) btn.disabled = busy;
  for (const btn of themeButtons) btn.disabled = busy;
  syncModeUi();
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

function syncModeUi() {
  const isUrlMode = modeSelect.value === "url";
  const payloadLabel = document.getElementById("payload-label");
  if (payloadLabel) {
    payloadLabel.textContent = isUrlMode ? t("payloadLabelUrl") : t("payloadLabelText");
  }
  input.type = isUrlMode ? "url" : "text";
  input.placeholder = isUrlMode ? t("payloadPlaceholderUrl") : t("payloadPlaceholderText");
  chkShorten.disabled = btnGen.disabled || !isUrlMode;
  if (!isUrlMode) chkShorten.checked = false;
}

function applyTranslations() {
  document.documentElement.lang = currentLanguage;
  document.title = t("pageTitle");
  setText("header-title", t("headerTitle"));
  setText("lead-copy", t("lead"));
  setText("language-label", t("languageLabel"));
  setText("theme-label", t("themeLabel"));
  const autoBtn = document.getElementById("theme-opt-auto");
  const lightBtn = document.getElementById("theme-opt-light");
  const darkBtn = document.getElementById("theme-opt-dark");
  if (autoBtn) autoBtn.setAttribute("aria-label", t("themeAutoAria"));
  if (lightBtn) lightBtn.setAttribute("aria-label", t("themeLightAria"));
  if (darkBtn) darkBtn.setAttribute("aria-label", t("themeDarkAria"));
  setText("mode-label", t("modeLabel"));
  setText("mode-opt-url", t("modeUrl"));
  setText("mode-opt-text", t("modeText"));
  setText("shape-label", t("shapeLabel"));
  setText("shape-opt-square", t("shapeSquare"));
  setText("shape-opt-rounded", t("shapeRounded"));
  setText("shape-opt-dots", t("shapeDots"));
  setText("size-label", t("sizeLabel"));
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
  setText("footer-hint", t("hint"));
  logoUrlInput.placeholder = t("logoUrlPlaceholder");
  paintLanguageButtons();
  paintThemeButtons();
  syncModeUi();
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

modeSelect.addEventListener("change", syncModeUi);
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
  encodedEl.textContent = "";
  preview.classList.add("hidden");
  btnDl.disabled = true;
  btnPdf.disabled = true;

  const mode = modeSelect.value === "text" ? "text" : "url";
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
    if (mode === "url" && chkShorten.checked) {
      payload = await shortenUrlAuto(v.payload);
    }

    const logoForQr = await resolveLogoForRender();
    const selectedShape = shapeSelect.value;
    const moduleShape = selectedShape === "rounded" || selectedShape === "dots" ? selectedShape : "square";
    const QRCode = await loadQrModule();
    const renderPx = Math.max(128, Math.min(4096, Math.round(qrSize.cm * PX_PER_CM)));

    await renderQrToCanvas(canvas, payload, QRCode, {
      width: renderPx,
      margin: 2,
      logoImage: logoForQr,
      logoSizePx: logoForQr ? Math.round(getLogoSizeCm() * PX_PER_CM) : 0,
      moduleShape,
    });

    lastEncodedPayload = payload;
    lastQrSizeCm = qrSize.cm;
    if (mode === "url") {
      encodedEl.innerHTML = `<strong>${escapeHtml(t("encodedPrefix"))}</strong> <a href="${escapeAttr(payload)}" rel="noopener noreferrer" target="_blank">${escapeHtml(payload)}</a>`;
    } else {
      encodedEl.innerHTML = `<strong>${escapeHtml(t("encodedPrefix"))}</strong> ${escapeHtml(payload)}`;
    }
    preview.classList.remove("hidden");
    btnDl.disabled = false;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setError(msg || "Something went wrong.");
  } finally {
    setBusy(false);
  }
}

function onDownload() {
  if (!lastEncodedPayload) {
    setError(t("errGenerateFirst"));
    return;
  }
  try {
    const a = document.createElement("a");
    a.download = "qrcode.png";
    a.href = canvas.toDataURL("image/png");
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
  const qrSizeMm = qrSize.cm * 10;
  if (qrSizeMm > MAX_PDF_QR_MM) {
    setError(t("errPdfTooLarge"));
    return;
  }
  try {
    const jsPDF = await loadJsPdf();
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = 210;
    const pageH = 297;
    const x = (pageW - qrSizeMm) / 2;
    const y = (pageH - qrSizeMm) / 2;
    const img = canvas.toDataURL("image/png");
    pdf.addImage(img, "PNG", x, y, qrSizeMm, qrSizeMm, undefined, "FAST");
    pdf.save("qrcode-a4.pdf");
  } catch {
    setError(t("errDownloadFailed"));
  }
}

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

initTheme();
initLanguage();
syncQrSizeUi();
syncLogoInputs(false);
syncLogoSizeLabel();
syncModeUi();
