/**
 * Loads the locally vendored qrcode package.
 */

const CANDIDATES = [
  "../vendor/qrcode.mjs",
];

/**
 * @param {*} m
 */
function unwrapQrModule(m) {
  if (!m) return null;
  if (typeof m.toCanvas === "function") return m;
  const d = m.default;
  if (d && typeof d.toCanvas === "function") return d;
  return null;
}

let loadPromise = null;

export async function loadQrModule() {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    let lastErr = null;
    for (const url of CANDIDATES) {
      try {
        const mod = await import(url);
        const QR = unwrapQrModule(mod);
        if (QR) return QR;
        lastErr = new Error("QR module loaded but toCanvas was missing.");
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error("Could not load the local QR code library.");
  })().catch((e) => {
    loadPromise = null;
    throw e;
  });

  return loadPromise;
}
