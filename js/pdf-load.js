/**
 * Loads the locally vendored jsPDF package.
 */

const CANDIDATES = [
  "../vendor/jspdf.mjs",
];

/**
 * @param {*} m
 * @returns {any}
 */
function unwrapJsPdfModule(m) {
  if (!m) return null;
  if (typeof m.jsPDF === "function") return m.jsPDF;
  if (m.default && typeof m.default.jsPDF === "function") return m.default.jsPDF;
  if (typeof m.default === "function") return m.default;
  return null;
}

let loadPromise = null;

export async function loadJsPdf() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    let lastErr = null;
    for (const url of CANDIDATES) {
      try {
        const mod = await import(url);
        const jsPDF = unwrapJsPdfModule(mod);
        if (jsPDF) return jsPDF;
        lastErr = new Error("jsPDF module loaded, but constructor was missing.");
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
      }
    }
    throw lastErr || new Error("Could not load the local jsPDF library.");
  })().catch((e) => {
    loadPromise = null;
    throw e;
  });
  return loadPromise;
}
