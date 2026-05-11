/**
 * Client-side URL shortening via is.gd / v.gd JSONP API (no CORS issues).
 * @see https://is.gd/apishorteningreference.php
 */

const JSONP_TIMEOUT_MS = 18000;

function loadJsonp(url, callbackName) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const t = setTimeout(() => {
      cleanup();
      reject(new Error("Shortening request timed out."));
    }, JSONP_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(t);
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
        const msg = data.errormessage || "Shortening failed.";
        reject(new Error(msg));
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

function makeCallbackName() {
  return `qrLinkShort_cb_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * @param {string} longUrl
 * @param {'isgd' | 'vgd'} provider
 * @returns {Promise<string>}
 */
export function shortenWithProvider(longUrl, provider) {
  const base = provider === "vgd" ? "https://v.gd" : "https://is.gd";
  const cb = makeCallbackName();
  const url = `${base}/create.php?format=json&url=${encodeURIComponent(longUrl)}&callback=${encodeURIComponent(cb)}`;
  return loadJsonp(url, cb);
}

/**
 * Try is.gd, then v.gd on failure (rate limits, outages).
 * @param {string} longUrl
 * @returns {Promise<string>}
 */
export async function shortenUrlAuto(longUrl) {
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
