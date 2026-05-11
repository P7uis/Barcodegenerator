import { shortenUrlAuto } from "./shorten.js";
import { renderQrToCanvas } from "./qr-render.js";
import { loadQrModule } from "./qr-load.js";
import { loadJsPdf } from "./pdf-load.js";

const THEME_KEY = "mediacapture-theme";
const LANG_KEY = "mediacapture-lang";
const PRINT_DPI = 300;
const CM_PER_INCH = 2.54;
const PX_PER_CM = PRINT_DPI / CM_PER_INCH;
const MIN_QR_CM = 1;
const MAX_QR_CM = 20;
const MAX_PDF_QR_MM = 200;

const input = document.getElementById("payload");
const sizeInput = document.getElementById("qr-size-cm");
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
      "Uses high error correction. Remote logos require CORS headers for PNG export. If both URL and file are provided, the URL is used.",
    logoUrlLabel: "Logo image URL (https, optional)",
    logoUrlPlaceholder: "https://example.com/logo.png",
    logoFileLabel: "Or local file",
    logoSizeLabel: "Center logo size",
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
    errInvalidSize: "Enter a valid size between 1 and 20 cm.",
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
      "Gebruikt hoge foutcorrectie. Externe logo's vereisen CORS-headers voor PNG-export. Als zowel URL als bestand is ingevuld, wordt de URL gebruikt.",
    logoUrlLabel: "URL van logo-afbeelding (https, optioneel)",
    logoUrlPlaceholder: "https://voorbeeld.nl/logo.png",
    logoFileLabel: "Of lokaal bestand",
    logoSizeLabel: "Grootte van centraal logo",
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
    errInvalidSize: "Vul een geldige grootte in tussen 1 en 20 cm.",
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
      "Verwendet eine hohe Fehlerkorrektur. Externe Logos benoetigen CORS-Header fuer den PNG-Export. Wenn sowohl URL als auch Datei gesetzt sind, wird die URL verwendet.",
    logoUrlLabel: "URL des Logo-Bildes (https, optional)",
    logoUrlPlaceholder: "https://beispiel.de/logo.png",
    logoFileLabel: "Oder lokale Datei",
    logoSizeLabel: "Groesse des zentralen Logos",
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
    errInvalidSize: "Bitte eine gueltige Groesse zwischen 1 und 20 cm eingeben.",
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
}

function getLogoSizeFraction() {
  const pct = Number.parseFloat(String(logoSizeInput.value || "22"));
  const safe = Number.isFinite(pct) ? Math.max(10, Math.min(35, pct)) : 22;
  return safe / 100;
}

function syncLogoSizeLabel() {
  const pct = Math.round(getLogoSizeFraction() * 100);
  logoSizeValue.textContent = `${pct}%`;
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
      logoSizeFraction: getLogoSizeFraction(),
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
syncLogoInputs(false);
syncLogoSizeLabel();
syncModeUi();
